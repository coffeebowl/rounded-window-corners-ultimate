/** @file Provides various utility functions used within signal handling code. */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';

import {boxShadowCss} from '../utils/box_shadow.js';
import {APP_SHADOWS, SHADOW_PADDING} from '../utils/constants.js';
import {readFile} from '../utils/file.js';
import {logDebug, logError} from '../utils/log.js';
import {getPref} from '../utils/settings.js';

/** @typedef {import('../utils/types.js').RoundedWindowActor} RoundedWindowActor */

/**
 * Get the actor that rounded corners should be applied to.
 * In Wayland, the effect is applied to WindowActor, but in X11, it is applied
 * to WindowActor.first_child.
 *
 * @param {RoundedWindowActor} actor - The window actor to unwrap.
 * @returns {import('gi://Clutter').default.Actor | null} The correct actor that the effect should be applied to.
 */
export function unwrapActor(actor) {
    const type = actor.metaWindow.get_client_type();
    return type === Meta.WindowClientType.X11 ? actor.get_first_child() : actor;
}

/**
 * Get the correct rounded corner setting for a window (custom settings if a
 * window has custom overrides, global settings otherwise).
 *
 * @param {import('gi://Meta').default.Window} win - The window to get the settings for.
 * @returns {import('../utils/types.js').RoundedCornerSettings} The matching settings object.
 */
export function getRoundedCornersCfg(win) {
    const globalCfg = getPref('global-rounded-corner-settings');
    const customCfgList = getPref('custom-rounded-corner-settings');

    if (
        win.wmClass === null ||
        !customCfgList[win.wmClass] ||
        !customCfgList[win.wmClass].enabled
    ) {
        return globalCfg;
    }

    return customCfgList[win.wmClass];
}

/**
 * Compute outer bounds for rounded corners of a window.
 *
 * @param {RoundedWindowActor} actor - The window actor to compute the bounds for.
 * @param {number[]} offsets - The content offsets `[x, y, width, height]` of the window actor.
 * @returns {import('../utils/types.js').Bounds}
 */
export function computeBounds(actor, [x, y, width, height]) {
    const bounds = {
        x1: x + 1,
        y1: y + 1,
        x2: x + actor.width + width,
        y2: y + actor.height + height,
    };

    // Kitty draws its window decoration by itself, so we need to manually
    // clip its shadow and recompute the outer bounds for it.
    if (
        getPref('tweak-kitty-terminal') &&
        actor.metaWindow.get_client_type() === Meta.WindowClientType.WAYLAND &&
        actor.metaWindow.wmClass === 'kitty'
    ) {
        const [x1, y1, x2, y2] = APP_SHADOWS.kitty;
        bounds.x1 += x1;
        bounds.y1 += y1;
        bounds.x2 -= x2;
        bounds.y2 -= y2;
    }

    return bounds;
}

/**
 * Compute the offset of actual window contents from the entire window buffer.
 *
 * @param {import('gi://Meta').default.Window} window - The window to compute the offset for.
 * @returns {number[]} The content offsets of the window (x, y, width, height).
 */
export function computeWindowContentsOffset(window) {
    const bufferRect = window.get_buffer_rect();
    const frameRect = window.get_frame_rect();
    return [
        frameRect.x - bufferRect.x,
        frameRect.y - bufferRect.y,
        frameRect.width - bufferRect.width,
        frameRect.height - bufferRect.height,
    ];
}

/**
 * Compute the offset of the shadow actor for a window.
 *
 * @param {number[]} offsets - The content offsets `[x, y, width, height]` of the window actor.
 * @returns {number[]}
 */
export function computeShadowActorOffset([
    offsetX,
    offsetY,
    offsetWidth,
    offsetHeight,
]) {
    return [
        offsetX - SHADOW_PADDING,
        offsetY - SHADOW_PADDING,
        2 * SHADOW_PADDING + offsetWidth,
        2 * SHADOW_PADDING + offsetHeight,
    ];
}

/**
 * Update the CSS style of a shadow actor.
 *
 * @param {import('gi://Meta').default.Window} win - The window to update the style for.
 * @param {import('gi://St').default.Bin} actor - The shadow actor to update the style for.
 * @param {import('../utils/types.js').RoundedCornerSettings} cfg - The rounded corner settings of the window.
 * @param {import('../utils/types.js').BoxShadow} shadow - The shadow settings for the window.
 */
export function updateShadowActorStyle(win, actor, cfg, shadow) {
    const {left, right, top, bottom} = cfg.padding;

    // Increase the border radius when smoothing is on, using the window's
    // own settings so the shadow matches custom corners.
    const adjustedBorderRadius = cfg.borderRadius * (1.0 + cfg.smoothing);

    actor.style = `padding: ${SHADOW_PADDING}px;`;

    const child = actor.firstChild;

    const hideShadowForMaximizedFullscreen =
        !getPref('keep-shadow-for-maximized-fullscreen') &&
        (win.maximizedHorizontally ||
            win.maximizedVertically ||
            win.fullscreen);

    const newChildStyle = hideShadowForMaximizedFullscreen
        ? 'opacity: 0;'
        : `background: white;
               border-radius: ${adjustedBorderRadius}px;
               ${boxShadowCss(shadow)};
               margin: ${top}px
                       ${right}px
                       ${bottom}px
                       ${left}px;`;

    // Only update style and queue a redraw when the style actually changed.
    if (child.style !== newChildStyle) {
        child.style = newChildStyle;
        child.queue_redraw();
    }
}

/**
 * @typedef {object} AppInfo
 * @property {'LibHandy' | 'LibAdwaita' | 'Other'} type - The toolkit the app
 *   is built with, as far as it matters for skipping.
 * @property {boolean} chromium - Whether the app is Chromium or Electron.
 */

/**
 * Check whether the app type has to be known before deciding about the
 * effect. Only the skip settings depend on it.
 *
 * @returns {boolean}
 */
export function needsAppType() {
    return getPref('skip-libadwaita-app') || getPref('skip-libhandy-app');
}

/**
 * Check whether a window should have rounded corners.
 *
 * @param {import('gi://Meta').default.Window} win - The window to check.
 * @param {AppInfo | null} app - What the app is built with, or null if that
 *   is not known yet. Windows are left alone until it is known, if a skip
 *   setting needs it.
 * @returns {boolean} Whether the window should have rounded corners.
 */
export function shouldEnableEffect(win, app) {
    // Skip rounded corners for the DING (Desktop Icons NG) extension.
    //
    // https://extensions.gnome.org/extension/2087/desktop-icons-ng-ding/
    if (win.gtkApplicationId === 'com.rastersoft.ding') {
        return false;
    }

    // Skip blacklisted applications.
    if (win.wmClass === null) {
        return false;
    }
    // handles blacklist / whitelist
    const isException = getPref('blacklist').includes(win.wmClass);
    const enableExceptions = getPref('whitelist');
    if (isException !== enableExceptions) {
        return false;
    }

    // Only apply the effect to normal windows (skip menus, tooltips, etc.)
    if (
        win.windowType !== Meta.WindowType.NORMAL &&
        win.windowType !== Meta.WindowType.DIALOG &&
        win.windowType !== Meta.WindowType.MODAL_DIALOG
    ) {
        return false;
    }

    // Skip libhandy/libadwaita applications according to settings.
    if (needsAppType()) {
        if (app === null) return false;
        if (
            getPref('skip-libadwaita-app') &&
            app.type === 'LibAdwaita' &&
            !isException
        ) {
            return false;
        }
        if (
            getPref('skip-libhandy-app') &&
            app.type === 'LibHandy' &&
            !isException
        ) {
            return false;
        }
    }

    // Skip maximized/fullscreen windows according to settings.
    const maximized = win.maximizedHorizontally || win.maximizedVertically;
    const fullscreen = win.fullscreen;
    const cfg = getRoundedCornersCfg(win);
    return (
        !(maximized || fullscreen) ||
        (maximized && !fullscreen && cfg.keepRoundedCorners.maximized) ||
        (fullscreen && cfg.keepRoundedCorners.fullscreen)
    );
}

/**
 * Find out what an app is built with by reading /proc/{pid}/maps once.
 *
 * Errors for processes that cannot be read (other users, sandboxes) or that
 * already exited are expected and only logged in debug mode.
 *
 * @param {import('gi://Meta').default.Window} win - The window to check.
 * @returns {Promise<AppInfo>}
 */
export async function detectApp(win) {
    /** @type {AppInfo} */
    const fallback = {type: 'Other', chromium: false};
    const pid = win.get_pid();
    if (pid <= 0) return fallback;

    let contents;
    try {
        contents = await readFile(`/proc/${pid}/maps`);
    } catch (e) {
        if (
            e instanceof GLib.Error &&
            (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.PERMISSION_DENIED) ||
                e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
        ) {
            logDebug(() => `Cannot read /proc maps for ${win.wmClass}`);
        } else {
            logError(e);
        }
        return fallback;
    }

    /** @type {AppInfo['type']} */
    let type = 'Other';
    if (contents.includes('libhandy-1.so')) type = 'LibHandy';
    else if (contents.includes('libadwaita-1.so')) type = 'LibAdwaita';
    const chromium = contents.includes('/dev/shm/.org.chromium.Chromium');

    logDebug(() => `${win.wmClass}: ${type}, chromium: ${chromium}`);
    return {type, chromium};
}
