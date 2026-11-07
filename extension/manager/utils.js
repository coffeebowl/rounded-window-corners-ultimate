/** @file Provides various utility functions used within signal handling code. */

import Cogl from 'gi://Cogl';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import St from 'gi://St';

import {BORDER} from '../utils/config.js';
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
 * Compute outer bounds for rounded corners of a window: its frame, in the
 * coordinates of the actor that has the effect, which start at the buffer.
 *
 * The actor can be larger than the buffer. libdecor (SDL, Blender), winit
 * (Alacritty) and kitty draw their decorations in subsurfaces that reach
 * past the buffer, and the actor grows to the right and bottom by that
 * much.
 *
 * @param {import('gi://Meta').default.Window} win - The window.
 * @returns {import('../utils/types.js').Bounds}
 */
export function computeBounds(win) {
    const buffer = win.get_buffer_rect();
    const frame = win.get_frame_rect();
    const x1 = frame.x - buffer.x;
    const y1 = frame.y - buffer.y;
    return {x1, y1, x2: x1 + frame.width, y2: y1 + frame.height};
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

    // Mutter keeps the maximized state of a window that goes fullscreen.
    if (win.fullscreen) return false;

    // Maximized and tiled windows stay square and only get the focus
    // border, also when they cover a monitor without the top bar.
    if (isMaximized(win)) return focusBorderWidth() > 0;

    // Borderless windows in monitor size count as fullscreen.
    return !coversMonitor(win);
}

/**
 * Check whether a window is maximized or tiled. Mutter reports tiling to
 * the left or right as maximized vertically.
 *
 * @param {import('gi://Meta').default.Window} win - The window to check.
 * @returns {boolean}
 */
export function isMaximized(win) {
    return win.maximizedHorizontally || win.maximizedVertically;
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
