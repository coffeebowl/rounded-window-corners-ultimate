/**
 * @file Fixed values for how windows look, after `window.csd` in libadwaita
 * 1.10 (gtk.css). They are the same in light and dark style.
 */

/** Corner radius in pixels, as libadwaita windows have it. */
export const RADIUS = 15;

/**
 * The thin line along the window edge, drawn over the contents: libadwaita's
 * `outline: 1px solid rgb(255 255 255 / 7%)` with `outline-offset: -1px`.
 * It only shows over dark contents.
 *
 * @type {import('./types.js').Border}
 */
export const BORDER = Object.freeze({
    width: 1,
    color: Object.freeze([1, 1, 1, 0.07]),
});

/**
 * Shadow of the focused window.
 *
 * @type {import('./types.js').BoxShadow}
 */
export const FOCUSED_SHADOW = Object.freeze({
    horizontalOffset: 0,
    verticalOffset: 4,
    blurOffset: 28,
    spreadRadius: 4,
    opacity: 60,
});

/**
 * Shadow of unfocused windows.
 *
 * @type {import('./types.js').BoxShadow}
 */
export const UNFOCUSED_SHADOW = Object.freeze({
    horizontalOffset: 0,
    verticalOffset: 2,
    blurOffset: 12,
    spreadRadius: -1,
    opacity: 65,
});
