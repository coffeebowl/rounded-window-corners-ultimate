/** @file Provides various utility functions used within signal handling code. */

import Cogl from 'gi://Cogl';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';

import {APP_SHADOWS, SHADOW_PADDING} from '../utils/constants.js';
import {findInFile} from '../utils/file.js';
import {logDebug, logError} from '../utils/log.js';
import {shadowImage} from '../utils/shadow_files.js';
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
 * The shadow is a pre-rendered image drawn as a 9-slice border image
 * around the window, see utils/shadow_texture.js. The image reaches
 * SHADOW_PADDING beyond the window box, so the inner actor fills the whole
 * shadow actor apart from the window's corner padding.
 *
 * @param {import('gi://Meta').default.Window} win - The window to update the style for.
 * @param {import('gi://St').default.Bin} actor - The shadow actor to update the style for.
 * @param {import('../utils/types.js').RoundedCornerSettings} cfg - The rounded corner settings of the window.
 * @param {import('../utils/types.js').BoxShadow} shadow - The shadow settings for the window.
 * @returns {boolean} Whether the shadow should be hidden, for maximized and
 *   fullscreen windows.
 */
export function updateShadowActorStyle(win, actor, cfg, shadow) {
    const {left, right, top, bottom} = cfg.padding;
    const actorStyle = `padding: ${top}px ${right}px ${bottom}px ${left}px;`;
    if (actor.style !== actorStyle) actor.style = actorStyle;

    // Increase the border radius when smoothing is on, using the window's
    // own settings so the shadow matches custom corners.
    const image = shadowImage({
        radius: cfg.borderRadius * (1.0 + cfg.smoothing),
        blur: shadow.blurOffset,
        spread: shadow.spreadRadius,
        offsetX: shadow.horizontalOffset,
        offsetY: shadow.verticalOffset,
        opacity: shadow.opacity,
    });
    const childStyle = `border-image: url("${image.uri}") ${image.slice};`;
    const child = actor.firstChild;
    if (child.style !== childStyle) child.style = childStyle;

    return (
        !getPref('keep-shadow-for-maximized-fullscreen') &&
        (win.maximizedHorizontally ||
            win.maximizedVertically ||
            coversMonitor(win))
    );
}

/**
 * Check whether a window covers its whole monitor: fullscreen windows, and
 * borderless windows in monitor size that do not report fullscreen, as
 * games often do. Mutter's `is_monitor_sized()` only covers override
 * redirect windows and windows the size of the whole screen.
 *
 * @param {import('gi://Meta').default.Window} win - The window to check.
 * @returns {boolean}
 */
export function coversMonitor(win) {
    if (win.fullscreen) return true;

    const monitor = win.get_monitor();
    if (monitor < 0) return false;

    const frame = win.get_frame_rect();
    const area = global.display.get_monitor_geometry(monitor);
    return (
        frame.x <= area.x &&
        frame.y <= area.y &&
        frame.x + frame.width >= area.x + area.width &&
        frame.y + frame.height >= area.y + area.height
    );
}

/**
 * Get the monitor a window lies on completely.
 *
 * @param {import('gi://Meta').default.Window} win - The window to check.
 * @returns {number | null} The monitor index, or null if the window spans
 *   several monitors or lies outside of all.
 */
export function monitorContaining(win) {
    const monitor = win.get_monitor();
    if (monitor < 0) return null;

    const frame = win.get_frame_rect();
    const area = global.display.get_monitor_geometry(monitor);
    const inside =
        frame.x >= area.x &&
        frame.y >= area.y &&
        frame.x + frame.width <= area.x + area.width &&
        frame.y + frame.height <= area.y + area.height;
    return inside ? monitor : null;
}

/**
 * Check whether nothing behind a window actor can show through it: the
 * actor is fully opaque and not scaled or moved by an animation, and the client's buffer has no
 * alpha channel. Mutter does not export the opaque region, so buffers with
 * alpha (most GTK apps, transparent terminals) never count as opaque. Games
 * usually render without alpha.
 *
 * @param {import('gi://Meta').default.WindowActor} actor - The window actor.
 * @returns {boolean}
 */
export function isOpaque(actor) {
    if (
        actor.opacity < 255 ||
        actor.scaleX !== 1 ||
        actor.scaleY !== 1 ||
        actor.translationX !== 0 ||
        actor.translationY !== 0
    )
        return false;

    const texture = actor.get_texture()?.get_texture();
    if (!texture?.is_simple()) return false;

    return (
        texture.get_plane(0).get_components() === Cogl.TextureComponents.RGB
    );
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

    // Skip maximized/fullscreen windows according to settings. Borderless
    // windows in monitor size count as fullscreen.
    const maximized = win.maximizedHorizontally || win.maximizedVertically;
    const fullscreen = coversMonitor(win);
    const cfg = getRoundedCornersCfg(win);
    return (
        !(maximized || fullscreen) ||
        (maximized && !fullscreen && cfg.keepRoundedCorners.maximized) ||
        (fullscreen && cfg.keepRoundedCorners.fullscreen)
    );
}

/**
 * Window classes of games: Steam/Proton, Wine (Lutris, Heroic, ...) and
 * gamescope. Games are never libadwaita or Chromium apps, so their
 * /proc/<pid>/maps, which can be megabytes for Wine, is not read at all.
 */
const GAME_CLASSES = [/^steam_app_\d+$/, /\.exe$/i, /^gamescope$/i];

/**
 * Check whether a window belongs to a game, judging by its window class.
 *
 * @param {import('gi://Meta').default.Window} win - The window to check.
 * @returns {boolean}
 */
export function isGame(win) {
    const wmClass = win.wmClass ?? '';
    return GAME_CLASSES.some(pattern => pattern.test(wmClass));
}

/** Markers in /proc/<pid>/maps and what they mean. */
const MAPS_MARKERS = new Map([
    ['libhandy-1.so', {type: 'LibHandy', chromium: false}],
    ['libadwaita-1.so', {type: 'LibAdwaita', chromium: false}],
    ['/dev/shm/.org.chromium.Chromium', {type: 'Other', chromium: true}],
]);

/** @type {AppInfo} */
const OTHER_APP = Object.freeze({type: 'Other', chromium: false});

/**
 * Detection results per process, shared by all windows of the process.
 *
 * @type {Map<number, {promise: Promise<AppInfo>, users: number}>}
 */
const appsByPid = new Map();

/**
 * Find out what an app is built with. Windows of the same process share one
 * read of /proc/<pid>/maps, which stops at the first marker. Call
 * {@link releaseApp} with the same PID when the window goes away.
 *
 * Errors for processes that cannot be read (other users, sandboxes) or that
 * already exited are expected and only logged in debug mode.
 *
 * @param {import('gi://Meta').default.Window} win - The window to check.
 * @param {number} pid - Its process ID, greater than 0.
 * @returns {Promise<AppInfo>}
 */
export function detectApp(win, pid) {
    let entry = appsByPid.get(pid);
    if (!entry) {
        entry = {promise: readAppInfo(win, pid), users: 0};
        appsByPid.set(pid, entry);
    }
    entry.users++;
    return entry.promise;
}

/**
 * Drop a window's claim on the detection result of its process. The result
 * is forgotten when the last window of the process is gone, since the PID
 * can be reused.
 *
 * @param {number} pid - The PID passed to {@link detectApp}.
 */
export function releaseApp(pid) {
    const entry = appsByPid.get(pid);
    if (entry && --entry.users <= 0) appsByPid.delete(pid);
}

/**
 * Read /proc/<pid>/maps once and look for the toolkit markers.
 *
 * @param {import('gi://Meta').default.Window} win - A window of the process, for logging.
 * @param {number} pid - The process ID.
 * @returns {Promise<AppInfo>}
 */
async function readAppInfo(win, pid) {
    let marker;
    try {
        marker = await findInFile(`/proc/${pid}/maps`, [...MAPS_MARKERS.keys()]);
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
        return OTHER_APP;
    }

    const app = (marker && MAPS_MARKERS.get(marker)) || OTHER_APP;
    logDebug(() => `${win.wmClass}: ${app.type}, chromium: ${app.chromium}`);
    return app;
}
