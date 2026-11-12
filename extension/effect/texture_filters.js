/**
 * @file Picks the texture filters for the offscreen texture of the rounded
 * corners effect.
 *
 * The effect is a `Clutter.OffscreenEffect`: the window is rendered into an
 * offscreen texture at full size, and that texture is painted in its place.
 * At integer scales Clutter sets that texture's filters to NEAREST whenever
 * it fills the texture again (`ensure_pipeline_filter_for_scale` in
 * clutter-offscreen-effect.c, GNOME 51), assuming a 1:1 texel to pixel
 * ratio. When the window is painted scaled down, above all as a preview in
 * the overview, point sampling turns its contents into speckles.
 *
 * A filter set here stays until Clutter fills the texture again, also for
 * the following paints from the cached texture. So once a smaller clone
 * changed it, the next paint in place has to put it back.
 *
 * Windows without the effect do not have this problem, because Mutter picks
 * filters for window textures by how the window is actually painted. This
 * does the same for the offscreen texture. Together with turning off the
 * window texture's mipmaps while the effect is on, it replaces the old
 * LinearFilterEffect, which added a second offscreen pass per preview.
 *
 * Ported from flexagoon/rounded-window-corners pull request #170, with a
 * fast path: windows painted in place need no measuring at all.
 */

import Cogl from 'gi://Cogl';
import Graphene from 'gi://Graphene';

/**
 * Below this scale so much of the texture is thrown away that mipmaps are
 * needed to avoid aliasing, for example in the workspace thumbnails. Above
 * it plain linear filtering is sharper.
 */
const MIPMAP_SCALE_THRESHOLD = 0.25;

/**
 * Scale at which a texture counts as not scaled down. Projecting the pixel
 * corners is not exact, so 1:1 can come out a hair below 1.
 */
const UNSCALED = 0.999;

/** Corners of one logical pixel, allocated once. */
const ORIGIN = Graphene.Vec4.alloc().init(0, 0, 0, 1);
const PIXEL_RIGHT = Graphene.Vec4.alloc().init(1, 0, 0, 1);
const PIXEL_DOWN = Graphene.Vec4.alloc().init(0, 1, 0, 1);

/**
 * Project a point onto the framebuffer being painted.
 *
 * @param {Graphene.Vec4} point
 * @param {Graphene.Matrix} transform - Modelview times projection.
 * @param {number[]} viewport - `[x, y, width, height]`.
 * @returns {[number, number]} Position in pixels.
 */
function project(point, transform, viewport) {
    const projected = transform.transform_vec4(point);
    const w = projected.get_w();
    return [
        (projected.get_x() / w / 2 + 0.5) * viewport[2] + viewport[0],
        (projected.get_y() / w / 2 + 0.5) * viewport[3] + viewport[1],
    ];
}

/**
 * Measure how large one logical pixel of the actor is on screen, like
 * Mutter's `meta_actor_painting_untransformed()`. Unlike the actor's own
 * transform, this includes being painted as part of a clone.
 *
 * The texture has one texel per physical pixel, but Clutter only scales it
 * down by the resource scale in a paint node of its own, after this runs
 * (`clutter_offscreen_effect_paint_texture`).
 *
 * @param {import('gi://Clutter').default.PaintContext} paintContext
 * @returns {number} The smaller of its width and height in pixels.
 */
function measurePixelScale(paintContext) {
    const framebuffer = paintContext.get_framebuffer();
    const transform = framebuffer
        .get_modelview_matrix()
        .multiply(framebuffer.get_projection_matrix());
    const viewport = framebuffer.get_viewport4fv();

    const [ox, oy] = project(ORIGIN, transform, viewport);
    const [rx, ry] = project(PIXEL_RIGHT, transform, viewport);
    const [dx, dy] = project(PIXEL_DOWN, transform, viewport);
    return Math.min(Math.hypot(rx - ox, ry - oy), Math.hypot(dx - ox, dy - oy));
}

/**
 * Set the filters of the effect's offscreen texture for this paint.
 *
 * @param {import('gi://Clutter').default.OffscreenEffect} effect
 * @param {import('gi://Clutter').default.PaintContext} paintContext
 * @param {boolean} changed - What the last call returned, false at first.
 * @returns {boolean} Whether the minification filter now differs from
 *   Clutter's choice, and a paint in place has to put it back.
 */
export function updateTextureFilters(effect, paintContext, changed) {
    const actor = effect.actor;
    // The effect sits on the surface inside the window actor, but
    // animations scale the window actor.
    const windowActor = actor.get_parent();
    const inPlace =
        !actor.is_in_clone_paint() &&
        windowActor?.scaleX === 1 &&
        windowActor.scaleY === 1;

    // Fast path: painted in place, at its own size. Clutter's choice is
    // right then, and most paints are like this.
    if (inPlace && !changed) return false;

    const pipeline = effect.get_pipeline();
    if (!pipeline) return false;

    // The magnification filter is only used when the texture is painted
    // larger, and Clutter's choice for it is fine. It is also what the
    // minification filter goes back to when nothing is scaled down.
    const [, magFilter] = pipeline.get_layer_filters(0);

    let minFilter = magFilter;
    if (!inPlace) {
        // How large one texel is on screen.
        const scale =
            measurePixelScale(paintContext) / actor.get_resource_scale();
        if (scale < MIPMAP_SCALE_THRESHOLD)
            minFilter = Cogl.PipelineFilter.LINEAR_MIPMAP_LINEAR;
        else if (scale < UNSCALED) minFilter = Cogl.PipelineFilter.LINEAR;
    }

    pipeline.set_layer_filters(0, minFilter, magFilter);
    return minFilter !== magFilter;
}
