/**
 * @file The window shadow as CSS box-shadow layers: how far it reaches
 * beyond the window, and the shadow between the focused and the unfocused
 * look. The shader in effect/shader/rounded_corners.frag draws it.
 *
 * This module has no imports, so it can be unit tested with `gjs -m`.
 */

/**
 * How far a Gaussian reaches before it can be neglected, in sigmas. At 3,
 * what is left is below half a level of 8 bits for the alphas here. The
 * shader cuts off at the same distance.
 */
export const GAUSS_REACH = 3;

/**
 * How far a layer reaches beyond the window box: its spread plus the reach
 * of its blur, whose sigma is half the blur radius, as in CSS.
 *
 * @param {import('./types.js').ShadowLayer} layer
 * @returns {number}
 */
export function layerReach(layer) {
    return Math.max(0, layer.spread + (Math.max(0, layer.blur) / 2) * GAUSS_REACH);
}

/**
 * How much room a shadow needs on every side of the window, in whole
 * pixels, for every look it can have.
 *
 * @param {...(readonly import('./types.js').ShadowLayer[])} looks - The
 *   layers of each look.
 * @returns {number}
 */
export function shadowRoom(...looks) {
    const reach = Math.max(0, ...looks.flat().map(layerReach));
    // One more pixel for the antialiased edge.
    return Math.ceil(reach) + 1;
}

/**
 * Interpolate between two looks layer by layer, as a CSS transition of
 * box-shadow does. Both need the same number of layers; libadwaita pads
 * the unfocused shadow with a transparent layer for this.
 *
 * @param {readonly import('./types.js').ShadowLayer[]} from - At 0.
 * @param {readonly import('./types.js').ShadowLayer[]} to - At 1.
 * @param {number} t - How far from `from` to `to`, from 0 to 1.
 * @returns {import('./types.js').ShadowLayer[]}
 */
export function mixShadows(from, to, t) {
    if (from.length !== to.length)
        throw new Error('Shadows to mix need the same number of layers');
    const mix = (a, b) => a + (b - a) * t;
    return from.map((a, i) => ({
        blur: mix(a.blur, to[i].blur),
        spread: mix(a.spread, to[i].spread),
        alpha: mix(a.alpha, to[i].alpha),
    }));
}
