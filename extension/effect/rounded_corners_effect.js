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

            // The actor can still have no size right after it was created.
            const pixelStep = [
                1 / Math.max(1, this.actor.get_width()),
                1 / Math.max(1, this.actor.get_height()),
            ];

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

            let changed = false;
            changed = this.#setUniform('bounds', bounds) || changed;
            changed = this.#setUniform('clipRadius', [radius]) || changed;
            changed = this.#setUniform('borderWidth', [borderWidth]) || changed;
            changed = this.#setUniform('borderColor', borderColor) || changed;
            changed =
                this.#setUniform('borderedAreaBounds', borderedAreaBounds) ||
                changed;
            changed =
                this.#setUniform('borderedAreaClipRadius', [
                    borderedAreaRadius,
                ]) || changed;
            changed = this.#setUniform('pixelStep', pixelStep) || changed;
            changed = this.#setUniform('exponent', [exponent]) || changed;

            if (changed) {
                this.queue_repaint();
            }
        }

        /**
         * Send a uniform to the shader if its value changed.
         *
         * @param {string} name - Name of the uniform in the shader.
         * @param {number[]} values - The components of the uniform.
         * @returns {boolean} Whether the value was sent.
         */
        #setUniform(name, values) {
            const prev = this.#lastUniforms.get(name);
            if (
                prev &&
                prev.length === values.length &&
                prev.every((v, i) => v === values[i])
            ) {
                return false;
            }

            // Store a copy, borderColor comes from a mutable settings object.
            this.#lastUniforms.set(name, [...values]);
            this.set_uniform_float(name, values.length, values);
            return true;
        }
    },
);
