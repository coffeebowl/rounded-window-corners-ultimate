/**
 * @file The actor that draws a window's shadow: a pre-rendered image (see
 * utils/shadow_texture.js), 9-sliced around the window, so the shadow costs
 * no offscreen copy of the window.
 *
 * St's border-image cannot be used for this. St loads the image scaled by
 * ceil(scale) but takes the slice widths as texels of the scaled texture
 * (st_theme_node_paint_sliced_border_image in GNOME Shell 51). Above 100 %
 * the visible slices then show only the outer, almost empty part of the
 * image, and the shadow itself ends up stretched below the window.
 */

import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';

import {SHADOW_PADDING} from '../utils/constants.js';
import {renderShadow} from '../utils/shadow_texture.js';

/** Duration of the cross-fade on focus changes, as libadwaita's. */
const FADE_MS = 200;

/**
 * Textures by style and image scale, shared by all windows while the
 * extension is enabled.
 *
 * @type {Map<object, Map<number, ShadowTexture>>}
 */
const textures = new Map();

/**
 * @typedef {object} ShadowTexture
 * @property {Cogl.Texture} texture
 * @property {number} size - Width and height in texels.
 * @property {number} margin - How far it reaches beyond the window, in texels.
 * @property {number} slice - Width of the border slices in texels.
 */

/** Drop all textures, when the extension is disabled. */
export function clearShadowTextures() {
    textures.clear();
}

/**
 * Get the texture for a style at an image scale, rendering it first.
 *
 * @param {Clutter.Actor} actor - Any actor on the stage, for the context.
 * @param {import('../utils/shadow_texture.js').ShadowStyle} style
 * @param {number} scale - Image pixels per window pixel, a whole number.
 * @returns {ShadowTexture}
 */
function shadowTexture(actor, style, scale) {
    let byScale = textures.get(style);
    if (!byScale) {
        byScale = new Map();
        textures.set(style, byScale);
    }
    let entry = byScale.get(scale);
    if (!entry) {
        const image = renderShadow(style, scale);
        const context = actor.get_context().get_backend().get_cogl_context();
        const texture = Cogl.Texture2D.new_from_data(
            context,
            image.size,
            image.size,
            Cogl.PixelFormat.RGBA_8888_PRE,
            image.size * 4,
            image.pixels,
        );
        entry = {
            texture,
            size: image.size,
            margin: image.margin,
            slice: image.slice,
        };
        byScale.set(scale, entry);
    }
    return entry;
}

export const ShadowActor = GObject.registerClass(
    {
        GTypeName: 'RwcUltimateShadowActor',
        Properties: {
            // How far the cross-fade to the current style has come.
            fade: GObject.ParamSpec.double(
                'fade',
                null,
                null,
                GObject.ParamFlags.READWRITE,
                0,
                1,
                1,
            ),
        },
    },
    class ShadowActor extends Clutter.Actor {
        /** @type {import('../utils/shadow_texture.js').ShadowStyle | null} */
        #style = null;

        /** @type {import('../utils/shadow_texture.js').ShadowStyle | null} */
        #previous = null;

        #fade = 1;

        constructor(params) {
            super(params);
            // Moving to a monitor with another scale needs another texture.
            this.connect('resource-scale-changed', () => this.queue_redraw());
        }

        get fade() {
            return this.#fade;
        }

        set fade(value) {
            if (value === this.#fade) return;
            this.#fade = value;
            this.notify('fade');
            this.queue_redraw();
        }

        /**
         * Show a style. A change while the shadow is shown cross-fades.
         *
         * @param {import('../utils/shadow_texture.js').ShadowStyle} style -
         *   The style, compared by identity, so pass the same object for
         *   the same look.
         */
        setStyle(style) {
            if (style === this.#style) return;

            this.remove_transition('fade');
            if (this.#style && this.mapped) {
                this.#previous = this.#style;
                this.#fade = 0;
                this.ease_property('fade', 1, {
                    duration: FADE_MS,
                    mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
                    onStopped: () => {
                        this.#previous = null;
                        this.queue_redraw();
                    },
                });
            } else {
                this.#previous = null;
                this.#fade = 1;
            }
            this.#style = style;
            this.queue_redraw();
        }

        vfunc_paint_node(root, _paintContext) {
            // Image pixels per window pixel: 2 from 125 % on, so the shadow
            // stays sharp there.
            const scale = Math.max(1, Math.ceil(this.get_resource_scale()));
            const opacity = this.get_paint_opacity() / 255;
            if (this.#previous)
                this.#paintStyle(root, this.#previous, scale, opacity * (1 - this.#fade));
            this.#paintStyle(
                root,
                this.#style,
                scale,
                this.#previous ? opacity * this.#fade : opacity,
            );
        }

        /**
         * Add the nine slices of a style. The middle one lies under the
         * window and is transparent, so it is left out.
         *
         * @param {Clutter.PaintNode} root
         * @param {import('../utils/shadow_texture.js').ShadowStyle | null} style
         * @param {number} scale
         * @param {number} alpha
         */
        #paintStyle(root, style, scale, alpha) {
            if (!style || alpha <= 0) return;

            const {texture, size, margin, slice} = shadowTexture(this, style, scale);
            const color = new Cogl.Color();
            // Premultiplied, like the texture.
            color.init_from_4f(alpha, alpha, alpha, alpha);
            const node = Clutter.TextureNode.new(
                texture,
                color,
                Clutter.ScalingFilter.LINEAR,
                Clutter.ScalingFilter.LINEAR,
            );
            root.add_child(node);

            // The image reaches `margin` beyond the window, the actor
            // SHADOW_PADDING. Slices in actor pixels:
            const box = this.get_allocation_box();
            const width = box.get_width();
            const height = box.get_height();
            const offset = SHADOW_PADDING - margin / scale;
            const s = slice / scale;
            // On windows too small for both slices, they meet in the middle.
            const edges = length => {
                const mid = length / 2;
                return [
                    offset,
                    Math.min(offset + s, mid),
                    Math.max(length - offset - s, mid),
                    length - offset,
                ];
            };
            const xs = edges(width);
            const ys = edges(height);
            // The middle column and row of the image are stretched.
            const t = [0, slice / size, (slice + 1) / size, 1];
            for (let row = 0; row < 3; row++) {
                for (let col = 0; col < 3; col++) {
                    if (row === 1 && col === 1) continue;
                    const rect = new Clutter.ActorBox({
                        x1: xs[col],
                        y1: ys[row],
                        x2: xs[col + 1],
                        y2: ys[row + 1],
                    });
                    node.add_texture_rectangle(rect, t[col], t[row], t[col + 1], t[row + 1]);
                }
            }
        }
    },
);
