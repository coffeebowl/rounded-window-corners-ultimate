/**
 * @file Renders the image for a window shadow, to be drawn as a 9-slice
 * border image around the window.
 *
 * The shadow follows CSS box-shadow as GTK draws it for libadwaita windows
 * (gskgpuboxshadow.glsl in GTK 4.24): every layer is the window's rounded
 * box, grown by the spread with the corner radius grown alike, blurred
 * with a Gaussian of sigma = blur / 2. Layers are painted over each other.
 * Like CSS, the shadow is not drawn inside the window box.
 *
 * This module has no imports, so it can be unit tested with `gjs -m`.
 */

/**
 * One layer of a box-shadow, always black and centered on the window.
 *
 * @typedef {object} ShadowLayer
 * @property {number} blur - CSS blur radius.
 * @property {number} spread - CSS spread radius, may be negative.
 * @property {number} alpha - Opacity from 0 to 1.
 */

/**
 * @typedef {object} ShadowStyle
 * @property {number} radius - Corner radius of the window box.
 * @property {readonly ShadowLayer[]} layers - Layers, the top one first, as
 *   in CSS. All are black, so the order does not change the result.
 */

/**
 * @typedef {object} ShadowImage
 * @property {number} width - Image width in pixels.
 * @property {number} height - Image height in pixels.
 * @property {Uint8Array} pixels - RGBA rows, not premultiplied.
 * @property {number} margin - How far the image reaches beyond the window
 *   box on every side.
 * @property {number} slice - Width of each border slice. The middle row and
 *   column are one pixel and get stretched.
 */

/** Samples per axis for anti-aliased coverage. */
const SUPERSAMPLING = 4;

/**
 * How far a Gaussian reaches before it can be neglected, in sigmas. At 3,
 * what is left is below half a level of 8 bits for the alphas here.
 */
const GAUSS_REACH = 3;

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
 * Blur a single-channel image in place with a Gaussian, treating pixels
 * outside the image as 0.
 *
 * @param {Float32Array} data - The image, row by row.
 * @param {number} width
 * @param {number} height
 * @param {number} sigma
 */
function gaussianBlur(data, width, height, sigma) {
    if (sigma <= 0) return;

    const reach = Math.ceil(sigma * GAUSS_REACH);
    const kernel = new Float32Array(reach * 2 + 1);
    let sum = 0;
    for (let i = -reach; i <= reach; i++) {
        kernel[i + reach] = Math.exp(-(i * i) / (2 * sigma * sigma));
        sum += kernel[i + reach];
    }
    for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;

    const tmp = new Float32Array(data.length);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let v = 0;
            for (let k = -reach; k <= reach; k++) {
                const xx = x + k;
                if (xx >= 0 && xx < width) v += data[y * width + xx] * kernel[k + reach];
            }
            tmp[y * width + x] = v;
        }
    }
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let v = 0;
            for (let k = -reach; k <= reach; k++) {
                const yy = y + k;
                if (yy >= 0 && yy < height) v += tmp[yy * width + x] * kernel[k + reach];
            }
            data[y * width + x] = v;
        }
    }
}

/**
 * How far a layer reaches beyond the window box.
 *
 * @param {ShadowLayer} layer
 * @returns {number}
 */
function layerReach(layer) {
    return Math.max(0, layer.spread + (Math.max(0, layer.blur) / 2) * GAUSS_REACH);
}

/**
 * Work out the image layout for a style.
 *
 * @param {ShadowStyle} style - How the shadow looks.
 * @param {number} [margin] - How far the image reaches beyond the window
 *   box. The shadow is cut off there. By default just as far as the
 *   shadow reaches.
 * @returns {{margin: number, corner: number, slice: number, size: number}}
 *   `corner` is how far from a box corner the shadow still differs from the
 *   straight edges.
 */
export function shadowLayout(style, margin) {
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
    const m = margin ?? Math.ceil(reach) + 1;
    const corner = Math.ceil(inward) + 2;
    return {margin: m, corner, slice: m + corner, size: (m + corner) * 2 + 1};
}

/**
 * Render the alpha of one layer.
 *
 * @param {ShadowLayer} layer
 * @param {number} radius - Corner radius of the window box.
 * @param {{x1: number, y1: number, x2: number, y2: number}} box - The window box.
 * @param {number} size - Size of the square output image.
 * @returns {Float32Array}
 */
function renderLayer(layer, radius, box, size) {
    const {spread} = layer;
    const out = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            out[y * size + x] = roundedRectCoverage(
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
    gaussianBlur(out, size, size, Math.max(0, layer.blur) / 2);
    return out;
}

/**
 * Render the shadow image for a style.
 *
 * @param {ShadowStyle} style - How the shadow looks.
 * @param {number} [fixedMargin] - See {@link shadowLayout}.
 * @returns {ShadowImage}
 */
export function renderShadow(style, fixedMargin) {
    const radius = Math.max(0, style.radius);
    const {margin, corner, size} = shadowLayout(style, fixedMargin);

    const side = corner * 2 + 1;
    const box = {x1: margin, y1: margin, x2: margin + side, y2: margin + side};

    // Black layers over each other: what shows through all of them is the
    // product of their transparencies.
    const clear = new Float32Array(size * size).fill(1);
    for (const layer of style.layers) {
        const alpha = Math.min(Math.max(layer.alpha, 0), 1);
        if (alpha <= 0) continue;
        const shape = renderLayer(layer, radius, box, size);
        for (let i = 0; i < clear.length; i++) clear[i] *= 1 - shape[i] * alpha;
    }

    // The shadow reaches this far under the window, so it still lies below
    // the window's antialiased edge. Further in it is transparent, which
    // keeps it out of translucent windows.
    const inset = 1;

    const pixels = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const i = y * size + x;
            const inside = roundedRectCoverage(
                x,
                y,
                box.x1 + inset,
                box.y1 + inset,
                box.x2 - inset,
                box.y2 - inset,
                Math.max(radius - inset, 0),
            );
            pixels[i * 4 + 3] = Math.round((1 - clear[i]) * (1 - inside) * 255);
        }
    }

    return {width: size, height: size, pixels, margin, slice: margin + corner};
}

/**
 * A short, stable hash of a shadow style, for file names.
 *
 * @param {ShadowStyle} style
 * @returns {string}
 */
export function shadowKey(style) {
    const text = JSON.stringify([
        4, // Bump when the rendering changes.
        style.radius,
        style.layers.map(l => [l.blur, l.spread, l.alpha]),
    ]);
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
}
