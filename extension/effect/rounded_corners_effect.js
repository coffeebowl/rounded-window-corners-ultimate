/** @file Binds the actual corner rounding shader to the windows. */

import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';

import {readShader} from '../utils/file.js';
import {getPref} from '../utils/settings.js';
import {updateTextureFilters} from './texture_filters.js';

const [declarations, code] = await readShader(
    import.meta.url,
    'shader/rounded_corners.frag',
);

/**
 * Enlarge a range of the actor the way Clutter does for the offscreen
 * texture (`_clutter_actor_box_enlarge_for_effects` in Clutter 51): round
 * the length and pad it by 3 pixels, so its size does not depend on
 * sub-pixel positions. This puts up to 2 pixels before the start.
 *
 * @param {number} start - Start of the painted range.
 * @param {number} end - End of the painted range.
 * @returns {[number, number]} Start and length of the texture.
 */
function enlargeForEffects(start, end) {
    const length = Math.round(end - start) + 3;
    return [Math.ceil(end + 0.75) - length, length];
}

export const RoundedCornersEffect = GObject.registerClass(
    {GTypeName: 'RwcUltimateRoundedCornersEffect'},
    class Effect extends Clutter.ShaderEffect {
        /**
         * Last values sent to the shader, by uniform name. Clutter resolves
         * uniforms by name on every call, so unchanged values are skipped.
         *
         * @type {Map<string, number[]>}
         */
        #lastUniforms = new Map();

        /**
         * The snippet is created once per class and shared by all instances,
         * so all windows use the same shader program.
         *
         * @returns {Cogl.Snippet}
         */
        vfunc_get_static_snippet() {
            return Cogl.Snippet.new(
                Cogl.SnippetHook.FRAGMENT,
                declarations,
                code,
            );
        }

        /**
         * Called whenever Clutter fills the offscreen texture again, after the
         * window changed. Find out where the texture lies in the actor, the
         * same way Clutter does right after this.
         *
         * Clutter does not make the texture as large as the actor: it pads it
         * and positions it by the actor's paint volume, which can be a third
         * of a pixel larger than the actor at fractional scales. The shader
         * needs this to map texture coordinates to window coordinates;
         * otherwise corners and borders move by up to 2 pixels.
         *
         * @param {Clutter.PaintNode} node
         * @param {Clutter.PaintContext} paintContext
         * @returns {boolean}
         */
        vfunc_pre_paint(node, paintContext) {
            const volume = this.actor.get_paint_volume();
            let x, y, width, height;
            if (volume) {
                const origin = volume.get_origin();
                [x, width] = enlargeForEffects(
                    origin.x,
                    origin.x + volume.get_width(),
                );
                [y, height] = enlargeForEffects(
                    origin.y,
                    origin.y + volume.get_height(),
                );
            } else {
                // Clutter falls back to the allocation, in parent coordinates.
                const box = this.actor.get_allocation_box();
                [x, width] = enlargeForEffects(box.x1, box.x2);
                [y, height] = enlargeForEffects(box.y1, box.y2);
                x -= box.x1;
                y -= box.y1;
            }
            // Clutter casts the start to an integer.
            this.#setUniform('textureRect', [
                Math.trunc(x),
                Math.trunc(y),
                width,
                height,
            ]);
            return super.vfunc_pre_paint(node, paintContext);
        }

        /**
         * Keep the window sharp when it is painted scaled down, for example
         * as a preview in the overview. See texture_filters.js.
         *
         * @param {Clutter.PaintNode} node
         * @param {Clutter.PaintContext} paintContext
         */
        vfunc_paint_target(node, paintContext) {
            updateTextureFilters(this, paintContext);
            super.vfunc_paint_target(node, paintContext);
        }

        /**
         * Update uniforms of the shader.
         * For more information, see the comments in the shader file.
         *
         * @param {import('../utils/types.js').RoundedCornerSettings} config - Rounded corners configuration
         * @param {import('../utils/types.js').Bounds} windowBounds - Bounds of the window without padding
         */
        updateUniforms(config, windowBounds) {
            const borderWidth = getPref('border-width');
            const borderColor = config.borderColor;

            const outerRadius = config.borderRadius;
            const {padding, smoothing} = config;

            const bounds = [
                windowBounds.x1 + padding.left,
                windowBounds.y1 + padding.top,
                windowBounds.x2 - padding.right,
                windowBounds.y2 - padding.bottom,
            ];

            const borderedAreaBounds = [
                bounds[0] + borderWidth,
                bounds[1] + borderWidth,
                bounds[2] - borderWidth,
                bounds[3] - borderWidth,
            ];

            let borderedAreaRadius = outerRadius - borderWidth;
            if (borderedAreaRadius < 0.001) {
                borderedAreaRadius = 0.0;
            }

            // This is needed for squircle corners
            let exponent = smoothing * 10 + 2;
            let radius = outerRadius * 0.5 * exponent;
            // The corner circles start at `bounds + radius`, so the radius
            // can be at most half of the shorter side.
            const maxRadius = Math.max(
                0,
                Math.min(bounds[2] - bounds[0], bounds[3] - bounds[1]) / 2,
            );
            if (radius > maxRadius) {
                exponent *= maxRadius / radius;
                radius = maxRadius;
            }
            borderedAreaRadius *= outerRadius > 0 ? radius / outerRadius : 0;

            const uniforms = {
                bounds,
                clipRadius: [radius],
                borderWidth: [borderWidth],
                borderColor,
                borderedAreaBounds,
                borderedAreaClipRadius: [borderedAreaRadius],
                exponent: [exponent],
            };
            for (const [name, values] of Object.entries(uniforms))
                this.#setUniform(name, values);
        }

        /**
         * Send a uniform to the shader if its value changed. Outside of a
         * paint, Clutter then queues a repaint of the effect by itself
         * (clutter_shader_effect_add_uniform in Clutter 51), which only
         * paints the offscreen texture again.
         *
         * @param {string} name - Name of the uniform in the shader.
         * @param {number[]} values - The components of the uniform.
         */
        #setUniform(name, values) {
            const prev = this.#lastUniforms.get(name);
            if (
                prev &&
                prev.length === values.length &&
                prev.every((v, i) => v === values[i])
            )
                return;

            // Store a copy, borderColor comes from a mutable settings object.
            this.#lastUniforms.set(name, [...values]);
            this.set_uniform_float(name, values.length, values);
        }
    },
);
