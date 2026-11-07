/**
 * @file Fixed values for how windows look, after `window.csd` in libadwaita
 * 1.10 (gtk.css). They are the same in light and dark style.
 * tests/adwaita.test.js compares them with the installed libadwaita.
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
 * The ring around every window, `0 0 0 1px rgb(0 0 0 / 5%)`, part of the
 * shadow. It separates windows from a background of the same color.
 *
 * @type {import('./shadow_texture.js').ShadowLayer}
 */
const RING = Object.freeze({blur: 0, spread: 1, alpha: 0.05});

/**
 * Shadow of the focused window, `window.csd`:
 * `0 0 14px 5px rgb(0 0 0 / 15%), 0 0 5px 2px rgb(0 0 0 / 10%)` and the ring.
 *
 * @type {readonly import('./shadow_texture.js').ShadowLayer[]}
 */
export const FOCUSED_SHADOW = Object.freeze([
    Object.freeze({blur: 14, spread: 5, alpha: 0.15}),
    Object.freeze({blur: 5, spread: 2, alpha: 0.1}),
    RING,
]);

/**
 * Shadow of unfocused windows, `window.csd:backdrop`:
 * `0 0 10px 5px rgb(0 0 0 / 8%)` and the ring.
 *
 * @type {readonly import('./shadow_texture.js').ShadowLayer[]}
 */
export const UNFOCUSED_SHADOW = Object.freeze([
    Object.freeze({blur: 10, spread: 5, alpha: 0.08}),
    RING,
]);
