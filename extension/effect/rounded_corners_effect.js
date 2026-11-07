/**
 * @file Binds the actual corner rounding shader to the windows, and makes
 * room around them for the shadow it draws.
 */

import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';

import {
    FOCUSED_SHADOW,
    SHADOW_TRANSITION_MS,
    UNFOCUSED_SHADOW,
} from '../utils/config.js';
import {readShader} from '../utils/file.js';
import {mixShadows, shadowRoom} from '../utils/shadow.js';
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

/** Room for the shadow on every side of the window, in pixels. */
const SHADOW_ROOM = shadowRoom(FOCUSED_SHADOW, UNFOCUSED_SHADOW);

/**
 * Makes room for the shadow: grows the paint volume of the window contents
 * on every side. The offscreen texture of the rounded corners effect
 * follows the paint volume of the effects before it, so this effect has to
 * be added first. Disabled, it makes no room.
 */
export const ShadowRoomEffect = GObject.registerClass(
    {GTypeName: 'RwcUltimateShadowRoomEffect'},
    class ShadowRoomEffect extends Clutter.Effect {
        /**
         * @param {Clutter.PaintVolume} volume
         * @returns {boolean}
         */
        vfunc_modify_paint_volume(volume) {
            // Clutter asks disabled effects too.
            if (!this.enabled) return true;

            const origin = volume.get_origin();
            volume.union_box(
                new Clutter.ActorBox({
                    x1: origin.x - SHADOW_ROOM,
                    y1: origin.y - SHADOW_ROOM,
                    x2: origin.x + volume.get_width() + SHADOW_ROOM,
                    y2: origin.y + volume.get_height() + SHADOW_ROOM,
                }),
            );
            return true;
        }
    },
);

export const RoundedCornersEffect = GObject.registerClass(
    {
        GTypeName: 'RwcUltimateRoundedCornersEffect',
        Properties: {
            // Between the unfocused shadow at 0 and the focused one at 1.
            'shadow-focus': GObject.ParamSpec.double(
                'shadow-focus',
                null,
                null,
                GObject.ParamFlags.READWRITE,
                0,
                1,
                1,
            ),
        },
    },
    class Effect extends Clutter.ShaderEffect {
        /**
         * Last values sent to the shader, by uniform name. Clutter resolves
         * uniforms by name on every call, so unchanged values are skipped.
         *
         * @type {Map<string, number[]>}
         */
        #lastUniforms = new Map();

        /** Whether the shadow is drawn. */
        #shadow = false;

        #shadowFocus = 1;

        /**
         * Whether the shadow shows or heads for the focused look, null
         * before the first look.
         *
         * @type {boolean | null}
         */
        #focused = null;

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

        get shadowFocus() {
            return this.#shadowFocus;
        }

        set shadowFocus(value) {
            if (value === this.#shadowFocus) return;
            this.#shadowFocus = value;
            this.notify('shadow-focus');
            this.#updateShadowUniforms();
        }

        /**
         * Show or hide the shadow, and follow the window's focus. Losing
         * the focus blends to the unfocused shadow, as libadwaita does.
         *
         * @param {boolean} shown - Whether to draw the shadow.
         * @param {boolean} focused - Whether the window has the focus.
         */
        setShadow(shown, focused) {
            this.#shadow = shown;
            if (focused !== this.#focused) {
                // The first look and gaining the focus apply at once.
                const blend = !focused && this.#focused !== null;
                this.#focused = focused;
                this.actor.ease_property(
                    `@effects.${this.name}.shadow-focus`,
                    focused ? 1 : 0,
                    {
                        duration: blend ? SHADOW_TRANSITION_MS : 0,
                        mode: Clutter.AnimationMode.EASE_OUT,
                    },
                );
            }
            this.#updateShadowUniforms();
        }

        /** Send the shadow layers for the current focus to the shader. */
        #updateShadowUniforms() {
            const layers = mixShadows(
                UNFOCUSED_SHADOW,
                FOCUSED_SHADOW,
                this.#shadowFocus,
            );
            layers.forEach(({blur, spread, alpha}, i) => {
                const shown = this.#shadow ? alpha : 0;
                this.#setUniform(`shadow${i}`, [blur, spread, shown]);
            });
        }

        /**
         * Update uniforms of the shader.
         * For more information, see the comments in the shader file.
         *
         * @param {import('../utils/types.js').Bounds} windowBounds - Bounds of the window
         * @param {import('../utils/types.js').Border} border - The border inside the window edge
         * @param {boolean} clip - Whether to cut off everything outside the
         *   rounded window, or only draw the border
         * @param {number} cornerRadius - Radius of the corners, 0 for square
         */
        updateUniforms(windowBounds, border, clip, cornerRadius) {
            const bounds = [
                windowBounds.x1,
                windowBounds.y1,
                windowBounds.x2,
                windowBounds.y2,
            ];
            const {width} = border;
            const borderedAreaBounds = [
                bounds[0] + width,
                bounds[1] + width,
                bounds[2] - width,
                bounds[3] - width,
            ];

            // The corner circles start at `bounds + radius`, so the radius
            // can be at most half of the shorter side.
            const maxRadius = Math.max(
                0,
                Math.min(bounds[2] - bounds[0], bounds[3] - bounds[1]) / 2,
            );
            const radius = Math.min(cornerRadius, maxRadius);
            // The inner edge of the border keeps the same distance from the
            // outer one along the curve.
            const borderedAreaRadius = Math.max(radius - width, 0);

            const uniforms = {
                bounds,
                clipRadius: [radius],
                borderWidth: [width],
                borderColor: border.color,
                borderedAreaBounds,
                borderedAreaClipRadius: [borderedAreaRadius],
                clipToWindow: [clip ? 1 : 0],
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

            this.#lastUniforms.set(name, values);
            this.set_uniform_float(name, values.length, values);
        }
    },
);
