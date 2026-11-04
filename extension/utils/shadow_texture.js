/**
 * @file Renders the image for a window shadow, to be drawn as a 9-slice
 * border image around the window.
 *
 * The image reproduces what the extension used to draw per window with an
 * offscreen effect: a white rounded box with a CSS box-shadow, where the
 * clip shader (formerly clip_shadow.frag) turned the white box transparent.
 * Rendering it once per shadow style saves an offscreen framebuffer of the
 * window's size per window.
 *
 * St's box-shadow, which this follows (st-private.c, clutter-blur.c in
 * GNOME 51): the shape's alpha is saturated to 1 wherever it is above 0,
 * then blurred with a Gaussian of sigma = blur / 2, and multiplied with the
 * shadow color's alpha.
 *
 * This module has no imports, so it can be unit tested with `gjs -m`.
 */

/**
 * @typedef {object} ShadowStyle
 * @property {number} radius - Corner radius of the window box.
 * @property {number} blur - CSS blur radius.
 * @property {number} spread - CSS spread radius, may be negative.
 * @property {number} offsetX - Horizontal offset.
 * @property {number} offsetY - Vertical offset.
 * @property {number} opacity - Shadow opacity from 0 to 100.
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

    const reach = Math.ceil(sigma * 3);
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
 * @param {number} edge0
 * @param {number} edge1
 * @param {number} x
 * @returns {number}
 */
function smoothstep(edge0, edge1, x) {
    const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
    return t * t * (3 - 2 * t);
}

/**
 * Work out the image layout for a style.
 *
 * @param {ShadowStyle} style - How the shadow looks.
 * @param {number} [margin] - How far the image reaches beyond the window
 *   box. The shadow is cut off there, like the shadow actor's padding used
 *   to cut it off. By default just as far as the shadow reaches.
 * @returns {{margin: number, corner: number, slice: number, size: number}}
 *   `corner` is how far from a box corner the shadow still differs from the
 *   straight edges.
 */
export function shadowLayout(style, margin) {
    const radius = Math.max(0, style.radius);
    const blur = Math.max(0, style.blur);
    const spread = style.spread;
    const offset = Math.max(Math.abs(style.offsetX), Math.abs(style.offsetY));

    const reach = Math.max(0, Math.ceil(blur + spread + offset) + 1);
    const m = margin ?? reach;
    const corner = Math.ceil(radius + Math.max(spread, 0) + blur + offset) + 2;
    return {margin: m, corner, slice: m + corner, size: (m + corner) * 2 + 1};
}

/**
 * Sample a single-channel image with bilinear filtering, 0 outside.
 *
 * @param {Float32Array} data
 * @param {number} width
 * @param {number} height
 * @param {number} x - Position in texels, texel centers at .5.
 * @param {number} y
 * @returns {number}
 */
function sampleBilinear(data, width, height, x, y) {
    const fx = x - 0.5;
    const fy = y - 0.5;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = fx - ix;
    const ty = fy - iy;
    // Clamp to the edge, like a texture sampled with CLAMP_TO_EDGE.
    const at = (xx, yy) => {
        const cx = Math.min(Math.max(xx, 0), width - 1);
        const cy = Math.min(Math.max(yy, 0), height - 1);
        return data[cy * width + cx];
    };
    return (
        at(ix, iy) * (1 - tx) * (1 - ty) +
        at(ix + 1, iy) * tx * (1 - ty) +
        at(ix, iy + 1) * (1 - tx) * ty +
        at(ix + 1, iy + 1) * tx * ty
    );
}

/**
 * Map an output coordinate of a 9-sliced shadow to a texture coordinate
 * between 0 and 1, along one axis.
 *
 * @param {number} pos - Output position.
 * @param {number} start - Start of the shadow box.
 * @param {number} first - End of the first slice.
 * @param {number} last - Start of the last slice.
 * @param {number} end - End of the shadow box.
 * @param {number} sFirst - Texture coordinate of the first slice's end.
 * @param {number} sLast - Texture coordinate of the last slice's start.
 * @returns {number | null} The texture coordinate, or null outside.
 */
function sliceMap(pos, start, first, last, end, sFirst, sLast) {
    if (pos < start || pos >= end) return null;
    if (pos < first) return ((pos - start) / (first - start)) * sFirst;
    if (pos < last)
        return sFirst + ((pos - first) / Math.max(last - first, 1e-6)) * (sLast - sFirst);
    return sLast + ((pos - last) / (end - last)) * (1 - sLast);
}

/**
 * Compute the alpha of St's box-shadow for a rounded box, the way St 51
 * paints it for a widget larger than its minimum shadow size
 * (st_theme_node_prerender_shadow, _st_create_shadow_pipeline and
 * st_theme_node_paint_sliced_shadow):
 *
 * 1. The silhouette is drawn at the minimum size, 2 * radius + 2 * blur + 1.
 * 2. Its alpha is saturated and it is blurred into a texture with a margin
 *    of `blur` pixels, sigma = blur / 2.
 * 3. That texture is 9-sliced onto the box grown by the spread. The slice
 *    math assumes a margin of ceil(0.75 * blur) * 2, so the outer falloff is
 *    stretched; the spread scales the slices.
 *
 * @param {{x1: number, y1: number, x2: number, y2: number}} box - The box.
 * @param {number} radius
 * @param {number} blur
 * @param {number} spread
 * @param {number} offsetX
 * @param {number} offsetY
 * @param {number} size - Size of the square output image.
 * @returns {Float32Array} Shadow alpha before the color's opacity.
 */
function stBoxShadow(box, radius, blur, spread, offsetX, offsetY, size) {
    // 1. and 2.: the blurred minimum-size texture.
    const center = blur > 0 ? 2 * blur + 1 : 1;
    const minSize = 2 * radius + center;
    const sampling = Math.ceil(blur);
    const texSize = Math.ceil(minSize) + 2 * sampling;
    const texture = new Float32Array(texSize * texSize);
    for (let y = 0; y < texSize; y++) {
        for (let x = 0; x < texSize; x++) {
            const coverage = roundedRectCoverage(
                x,
                y,
                sampling,
                sampling,
                sampling + minSize,
                sampling + minSize,
                radius,
            );
            texture[y * texSize + x] = coverage > 0 ? 1 : 0;
        }
    }
    gaussianBlur(texture, texSize, texSize, blur / 2);

    // 3.: the slice geometry.
    const blurRadius = blur === 0 ? 0 : Math.ceil((1.5 * blur) / 2) * 2;
    const assumedSize = minSize + 2 * blurRadius;
    const sliceIn = blurRadius + blur + radius;
    const sFirst = sliceIn / assumedSize;
    const sLast = 1 - sFirst;

    /**
     * @param {number} lo - Box start.
     * @param {number} hi - Box end.
     * @param {number} offset
     */
    const axis = (lo, hi, offset) => {
        const start = lo + offset - blurRadius - spread;
        const length = hi - lo + 2 * blurRadius;
        const factor = (length + 2 * spread) / length;
        const end = start + length + 2 * spread;
        return {
            start,
            end,
            first: start + sliceIn * factor,
            last: end - sliceIn * factor,
        };
    };
    const ax = axis(box.x1, box.x2, offsetX);
    const ay = axis(box.y1, box.y2, offsetY);

    const out = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
        const v = sliceMap(y + 0.5, ay.start, ay.first, ay.last, ay.end, sFirst, sLast);
        if (v === null) continue;
        for (let x = 0; x < size; x++) {
            const u = sliceMap(x + 0.5, ax.start, ax.first, ax.last, ax.end, sFirst, sLast);
            if (u === null) continue;
            out[y * size + x] = sampleBilinear(
                texture,
                texSize,
                texSize,
                u * texSize,
                v * texSize,
            );
        }
    }
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
    const blur = Math.max(0, style.blur);
    const spread = style.spread;
    const {margin, corner, size} = shadowLayout(style, fixedMargin);

    const box = corner * 2 + 1;
    const x1 = margin;
    const y1 = margin;
    const x2 = margin + box;
    const y2 = margin + box;

    const shadow = stBoxShadow(
        {x1, y1, x2, y2},
        radius,
        blur,
        spread,
        style.offsetX,
        style.offsetY,
        size,
    );

    const alpha = Math.min(Math.max(style.opacity / 100, 0), 1);
    const pixels = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const i = y * size + x;
            const a = shadow[i] * alpha;
            const c = roundedRectCoverage(x, y, x1, y1, x2, y2, radius);

            // White box over the black shadow, premultiplied, then the old
            // clip shader: color *= (1 - smoothstep(0.4, 1, gray)) * alpha.
            const blendedAlpha = c + a * (1 - c);
            const factor = (1 - smoothstep(0.4, 1, c)) * blendedAlpha;
            const outAlpha = blendedAlpha * factor;
            const outGray = outAlpha > 0 ? (c * factor) / outAlpha : 0;

            pixels[i * 4] = Math.round(outGray * 255);
            pixels[i * 4 + 1] = Math.round(outGray * 255);
            pixels[i * 4 + 2] = Math.round(outGray * 255);
            pixels[i * 4 + 3] = Math.round(Math.min(outAlpha, 1) * 255);
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
        2, // Bump when the rendering changes.
        style.radius,
        style.blur,
        style.spread,
        style.offsetX,
        style.offsetY,
        style.opacity,
    ]);
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
}
