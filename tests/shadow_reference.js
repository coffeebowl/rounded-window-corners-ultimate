/**
 * @file Renders a window shadow the slow and plain way, as reference for
 * the shader in extension/effect/shader/rounded_corners.frag: covers
 * pixels with the rounded box and blurs them with a Gaussian kernel.
 *
 * The shadow follows CSS box-shadow as GTK draws it for libadwaita windows
 * (gskgpuboxshadow.glsl in GTK 4.24): every layer is the window's rounded
 * box, grown by the spread with the corner radius grown alike, blurred
 * with a Gaussian of sigma = blur / 2. Layers are painted over each other.
 * Like CSS, the shadow is not drawn inside the window box.
 *
 * The image is symmetric, so only its top left quarter is computed and
 * then mirrored. It has no Shell imports, so tests run it with `gjs -m`,
 * and smoke tests compare the shader's shadow with it.
 */

import {GAUSS_REACH, layerReach} from '../extension/utils/shadow.js';

/** @typedef {import('../extension/utils/types.js').ShadowLayer} ShadowLayer */

/**
 * @typedef {object} ShadowStyle
 * @property {number} radius - Corner radius of the window box.
 * @property {readonly ShadowLayer[]} layers - Layers, the top one first, as
 *   in CSS. All are black, so the order does not change the result.
 */

/**
 * @typedef {object} ShadowImage
 * @property {number} size - Width and height in pixels.
 * @property {Uint8Array} pixels - RGBA rows. The shadow is black, so they
 *   are the same premultiplied or not.
 * @property {number} margin - How far the image reaches beyond the window
 *   box on every side, in pixels.
 * @property {number} slice - Width of each border slice in pixels: the
 *   image is a corner, a one pixel wide middle and the mirrored corner.
 */

/** Samples per axis for anti-aliased coverage. */
const SUPERSAMPLING = 4;

/**
 * Coverage of a pixel by a rounded rectangle, from 0 to 1.
 *
 * @param {number} px - Pixel column.
 * @param {number} py - Pixel row.
 * @param {number} x1 - Left edge.
 * @param {number} y1 - Top edge.
 * @param {number} x2 - Right edge.
 * @param {number} y2 - Bottom edge.
 * @param {number} r - Corner radius.
 * @returns {number}
 */
function roundedRectCoverage(px, py, x1, y1, x2, y2, r) {
    // Most pixels lie clearly outside, or inside away from the corners.
    if (px + 1 <= x1 || px >= x2 || py + 1 <= y1 || py >= y2) return 0;
    if (
        px >= x1 &&
        px + 1 <= x2 &&
        py >= y1 &&
        py + 1 <= y2 &&
        ((px >= x1 + r && px + 1 <= x2 - r) ||
            (py >= y1 + r && py + 1 <= y2 - r))
    )
        return 1;

    let inside = 0;
    for (let sy = 0; sy < SUPERSAMPLING; sy++) {
        const y = py + (sy + 0.5) / SUPERSAMPLING;
        for (let sx = 0; sx < SUPERSAMPLING; sx++) {
            const x = px + (sx + 0.5) / SUPERSAMPLING;
            if (x < x1 || x > x2 || y < y1 || y > y2) continue;

            // Distance into a corner square, if the sample is in one.
            const cx = x < x1 + r ? x1 + r : x > x2 - r ? x2 - r : x;
            const cy = y < y1 + r ? y1 + r : y > y2 - r ? y2 - r : y;
            const dx = x - cx;
            const dy = y - cy;
            if (dx * dx + dy * dy <= r * r) inside++;
        }
    }
    return inside / (SUPERSAMPLING * SUPERSAMPLING);
}

/**
 * Blur the top left quarter of a symmetric image in place with a Gaussian.
 * Beyond the middle row and column the image is mirrored, beyond the outer
 * edges it is 0.
 *
 * @param {Float32Array} data - The quarter, `q` by `q`, row by row. Row and
 *   column `q - 1` are the middle of the image.
 * @param {number} q
 * @param {number} sigma
 */
function blurQuarter(data, q, sigma) {
    if (sigma <= 0) return;

    const reach = Math.ceil(sigma * GAUSS_REACH);
    const kernel = new Float32Array(reach * 2 + 1);
    let sum = 0;
    for (let i = -reach; i <= reach; i++) {
        kernel[i + reach] = Math.exp(-(i * i) / (2 * sigma * sigma));
        sum += kernel[i + reach];
    }
    for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;

    const mid = q - 1;
    /** Index in the quarter for a position along one axis, or -1. */
    const fold = i => (i < 0 ? -1 : i > mid ? (2 * mid - i >= 0 ? 2 * mid - i : -1) : i);

    const tmp = new Float32Array(data.length);
    for (let y = 0; y < q; y++) {
        for (let x = 0; x < q; x++) {
            let v = 0;
            for (let k = -reach; k <= reach; k++) {
                const xx = fold(x + k);
                if (xx >= 0) v += data[y * q + xx] * kernel[k + reach];
            }
            tmp[y * q + x] = v;
        }
    }
    for (let y = 0; y < q; y++) {
        for (let x = 0; x < q; x++) {
            let v = 0;
            for (let k = -reach; k <= reach; k++) {
                const yy = fold(y + k);
                if (yy >= 0) v += tmp[yy * q + x] * kernel[k + reach];
            }
            data[y * q + x] = v;
        }
    }
}

/**
 * Scale a style, for an image with more pixels per window pixel.
 *
 * @param {ShadowStyle} style
 * @param {number} scale
 * @returns {ShadowStyle}
 */
function scaleStyle(style, scale) {
    return {
        radius: style.radius * scale,
        layers: style.layers.map(l => ({
            blur: l.blur * scale,
            spread: l.spread * scale,
            alpha: l.alpha,
        })),
    };
}

/**
 * Work out the image layout for a style: the image reaches as far beyond
 * the window box as the shadow.
 *
 * @param {ShadowStyle} style - How the shadow looks.
 * @returns {{margin: number, corner: number, slice: number, size: number}}
 *   `corner` is how far from a box corner the shadow still differs from the
 *   straight edges.
 */
export function shadowLayout(style) {
    const radius = Math.max(0, style.radius);
    let reach = 0;
    let inward = 0;
    for (const layer of style.layers) {
        reach = Math.max(reach, layerReach(layer));
        // How far along the edges the rounded corner of the layer and its
        // blur reach.
        const blur = (Math.max(0, layer.blur) / 2) * GAUSS_REACH;
        inward = Math.max(inward, radius + Math.max(layer.spread, 0) + blur);
    }
    const m = Math.ceil(reach) + 1;
    const corner = Math.ceil(inward) + 2;
    return {margin: m, corner, slice: m + corner, size: (m + corner) * 2 + 1};
}

/**
 * Render the alpha of one layer, top left quarter only.
 *
 * @param {ShadowLayer} layer
 * @param {number} radius - Corner radius of the window box.
 * @param {{x1: number, y1: number, x2: number, y2: number}} box - The window box.
 * @param {number} q - Size of the quarter.
 * @returns {Float32Array}
 */
function renderLayer(layer, radius, box, q) {
    const {spread} = layer;
    const out = new Float32Array(q * q);
    for (let y = 0; y < q; y++) {
        for (let x = 0; x < q; x++) {
            out[y * q + x] = roundedRectCoverage(
                x,
                y,
                box.x1 - spread,
                box.y1 - spread,
                box.x2 + spread,
                box.y2 + spread,
                Math.max(radius + spread, 0),
            );
        }
    }
    blurQuarter(out, q, Math.max(0, layer.blur) / 2);
    return out;
}

/**
 * Render the shadow image for a style.
 *
 * @param {ShadowStyle} style - How the shadow looks, in window pixels.
 * @param {number} [scale] - Image pixels per window pixel, for example 2
 *   for a sharp shadow at 200 %.
 * @returns {ShadowImage}
 */
export function renderShadow(style, scale = 1) {
    const scaled = scaleStyle(style, scale);
    const radius = Math.max(0, scaled.radius);
    const {margin, corner, slice, size} = shadowLayout(scaled);

    const side = corner * 2 + 1;
    const box = {x1: margin, y1: margin, x2: margin + side, y2: margin + side};
    const q = slice + 1;

    // Black layers over each other: what shows through all of them is the
    // product of their transparencies.
    const clear = new Float32Array(q * q).fill(1);
    for (const layer of scaled.layers) {
        const alpha = Math.min(Math.max(layer.alpha, 0), 1);
        if (alpha <= 0) continue;
        const shape = renderLayer(layer, radius, box, q);
        for (let i = 0; i < clear.length; i++) clear[i] *= 1 - shape[i] * alpha;
    }

    // The shadow reaches one window pixel under the window, so it still
    // lies below the window's antialiased edge. Further in it is
    // transparent, which keeps it out of translucent windows.
    const inset = scale;

    const quarter = new Uint8Array(q * q);
    for (let y = 0; y < q; y++) {
        for (let x = 0; x < q; x++) {
            const i = y * q + x;
            const inside = roundedRectCoverage(
                x,
                y,
                box.x1 + inset,
                box.y1 + inset,
                box.x2 - inset,
                box.y2 - inset,
                Math.max(radius - inset, 0),
            );
            quarter[i] = Math.round((1 - clear[i]) * (1 - inside) * 255);
        }
    }

    const pixels = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
        const qy = Math.min(y, size - 1 - y);
        for (let x = 0; x < size; x++) {
            const qx = Math.min(x, size - 1 - x);
            pixels[(y * size + x) * 4 + 3] = quarter[qy * q + qx];
        }
    }

    return {size, pixels, margin, slice};
}
