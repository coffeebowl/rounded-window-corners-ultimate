/** @file Provides various utility functions used within signal handling code. */

import Cogl from 'gi://Cogl';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import St from 'gi://St';

import {
    BORDER,
    FOCUSED_SHADOW,
    RADIUS,
    UNFOCUSED_SHADOW,
} from '../utils/config.js';
import {SHADOW_PADDING} from '../utils/constants.js';
import {findInFile} from '../utils/file.js';
import {logDebug, logError} from '../utils/log.js';
import {focusBorderWidth} from '../utils/settings.js';

/**
 * Get the actor that rounded corners should be applied to: the child of the
 * window actor that holds the window contents. For Wayland clients that is
 * the surface container with the main surface and its subsurfaces, for
 * XWayland clients the surface actor.
 *
 * The effect is an offscreen effect, so everything inside its actor is
 * painted into its own framebuffer first. Other extensions put actors into
 * the window actor, for example Blur my Shell a blur actor below the
 * contents. On the window actor itself, the effect would capture that blur
 * actor, which then has nothing behind it to blur.
 *
 * The surface types are not introspectable, so they are matched by their
 * type name. This also skips the black background that Mutter puts behind
 * fullscreen windows smaller than the monitor.
 *
 * Based on kem-a/rounded-window-corners.
 *
 * @param {Meta.WindowActor} actor - The window actor to unwrap.
 * @returns {import('gi://Clutter').default.Actor | null} The actor to apply
 *   the effect to, or null if the window contents do not exist yet.
 */
export function unwrapActor(actor) {
    for (const child of actor.get_children()) {
        if (GObject.type_name(child.constructor.$gtype).startsWith('MetaSurface'))
            return child;
    }
    return null;
}

/** Shadow styles, created once so shadow actors can compare them. */
const FOCUSED_STYLE = Object.freeze({radius: RADIUS, layers: FOCUSED_SHADOW});
const UNFOCUSED_STYLE = Object.freeze({radius: RADIUS, layers: UNFOCUSED_SHADOW});

/**
 * Get the shadow for a window.
 *
 * @param {import('gi://Meta').default.Window} win - The window.
 * @returns {import('../utils/shadow_texture.js').ShadowStyle}
 */
export function getShadowCfg(win) {
    return win.appears_focused ? FOCUSED_STYLE : UNFOCUSED_STYLE;
}

/**
 * The accent color last read, kept while it stays the same, so all
 * windows share one border object.
 *
 * @type {import('../utils/types.js').Border | null}
 */
let accentBorder = null;

/**
 * Get the border for a window: the focus border in the system's accent
 * color for the focused window if it is on, the thin libadwaita line
 * otherwise. The focus border lies inside the window where the line would
 * be, so the line is not missed.
 *
 * @param {import('gi://Meta').default.Window} win - The window.
 * @returns {import('../utils/types.js').Border}
 */
export function getBorder(win) {
    const width = focusBorderWidth();
    if (width <= 0 || !win.appears_focused) return BORDER;

    // St maps the accent-color setting to a color and keeps it in the
    // theme context (update_accent_colors in st-theme-context.c).
    const [accent] = St.ThemeContext.get_for_stage(global.stage)
        .get_accent_color();
    const color = [accent.red, accent.green, accent.blue, accent.alpha]
        .map(c => c / 255);
    if (
        accentBorder?.width !== width ||
        accentBorder.color.some((c, i) => c !== color[i])
    )
        accentBorder = Object.freeze({width, color: Object.freeze(color)});
    return accentBorder;
}

/**
 * Compute outer bounds for rounded corners of a window, in the coordinates
 * of the actor that has the effect.
 *
 * @param {import('gi://Clutter').default.Actor} target - The actor with the
 *   effect, see {@link unwrapActor}. Its size is the buffer size.
 * @param {number[]} offsets - The content offsets `[x, y, width, height]` of the window.
 * @returns {import('../utils/types.js').Bounds}
 */
export function computeBounds(target, [x, y, width, height]) {
    return {
        x1: x,
        y1: y,
        x2: x + target.width + width,
        y2: y + target.height + height,
    };
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
 * Show the right shadow on a shadow actor.
 *
 * @param {import('gi://Meta').default.Window} win - The window to update the shadow for.
 * @param {import('../effect/shadow_actor.js').ShadowActor} actor - Its shadow actor.
 * @param {import('../utils/shadow_texture.js').ShadowStyle} style - The shadow of the window.
 * @returns {boolean} Whether the shadow should be hidden, for maximized and
 *   fullscreen windows.
 */
export function updateShadowActorStyle(win, actor, style) {
    actor.setStyle(style);

    return (
        win.maximizedHorizontally ||
        win.maximizedVertically ||
        coversMonitor(win)
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
 * @property {boolean} libadwaita - Whether the app uses libadwaita, which
 *   draws corners, line and shadow itself.
 * @property {boolean} chromium - Whether the app is Chromium or Electron.
 */

/**
 * Check whether a window should have rounded corners.
 *
 * @param {import('gi://Meta').default.Window} win - The window to check.
 * @param {AppInfo | null} app - What the app is built with, or null if that
 *   is not known yet. Windows are left alone until it is known.
 * @returns {boolean} Whether the window should have rounded corners.
 */
export function shouldEnableEffect(win, app) {
    // Skip rounded corners for the DING (Desktop Icons NG) extension.
    //
    // https://extensions.gnome.org/extension/2087/desktop-icons-ng-ding/
    if (win.gtkApplicationId === 'com.rastersoft.ding') {
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

    // libadwaita apps draw corners, line and shadow themselves (libadwaita
    // 1.10). They only get the effect for the focus border, which then
    // draws nothing else, see event_handlers.js.
    if (app === null || (app.libadwaita && focusBorderWidth() <= 0))
        return false;

    // Maximized and fullscreen windows stay square. Borderless windows in
    // monitor size count as fullscreen.
    return !(
        win.maximizedHorizontally ||
        win.maximizedVertically ||
        coversMonitor(win)
    );
}

/** Markers in /proc/<pid>/maps and what they mean. */
const MAPS_MARKERS = new Map([
    ['libadwaita-1.so', Object.freeze({libadwaita: true, chromium: false})],
    [
        '/dev/shm/.org.chromium.Chromium',
        Object.freeze({libadwaita: false, chromium: true}),
    ],
]);

/** @type {AppInfo} */
export const OTHER_APP = Object.freeze({libadwaita: false, chromium: false});

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
    logDebug(() => `${win.wmClass}: libadwaita: ${app.libadwaita}, chromium: ${app.chromium}`);
    return app;
}
