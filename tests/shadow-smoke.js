// Automation script for tests/run-smoke.sh: the shader draws the shadow
// like the reference renderer in shadow_reference.js, the overview shows
// it around the previews, and a window that first shows at 150 % has it
// too. Needs a 1920x1080 monitor.

import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

import {FOCUSED_SHADOW, RADIUS} from '../extension/utils/config.js';
import {setScale} from './display.js';
import {ok as check} from './harness.js';
import {loadExtension, plainBackground, screenshot, waitFor} from './session.js';
import {renderShadow} from './shadow_reference.js';

/**
 * Read the red value of pixels in a screenshot.
 *
 * @param {import('gi://GdkPixbuf').default.Pixbuf} image
 * @param {number} scale - Physical pixels per stage pixel.
 * @returns {(x: number, y: number) => number} The value at a stage point.
 */
function sampler(image, scale) {
    const pixels = image.get_pixels();
    const stride = image.get_rowstride();
    const channels = image.get_n_channels();
    return (x, y) =>
        pixels[Math.round(y * scale) * stride + Math.round(x * scale) * channels];
}

/**
 * Read the red value of pixels along a row of a screenshot.
 *
 * @param {import('gi://GdkPixbuf').default.Pixbuf} image
 * @param {number} y - The row, in stage pixels.
 * @param {number} scale - Physical pixels per stage pixel.
 * @returns {(x: number) => number} The value at a stage x.
 */
function row(image, y, scale) {
    const at = sampler(image, scale);
    return x => at(x, y);
}

/**
 * How far a pixel's middle lies outside the rounded window box, negative
 * inside.
 *
 * @param {number} x - Pixel column, from the box's left edge.
 * @param {number} y - Pixel row, from the box's top edge.
 * @param {number} radius - Corner radius.
 * @returns {number}
 */
function outsideTopLeft(x, y, radius) {
    const px = x + 0.5;
    const py = y + 0.5;
    if (px < radius && py < radius)
        return Math.hypot(radius - px, radius - py) - radius;
    return Math.max(-px, -py);
}

/**
 * Find the clones that show an actor, for example window previews.
 *
 * @param {Clutter.Actor} parent - Where to look.
 * @param {Clutter.Actor} source - The actor that is cloned.
 * @returns {Clutter.Clone[]}
 */
function findClones(parent, source) {
    return parent.get_children().flatMap(child =>
        child instanceof Clutter.Clone && child.source === source
            ? [child]
            : findClones(child, source),
    );
}

export async function run() {
    plainBackground('#c0c0c0');
    const {extension, states} = await loadExtension();
    extension.enable();
    Main.overview.hide();

    await Scripting.createTestWindow({width: 400, height: 300});
    await Scripting.waitTestWindows();
    await Scripting.sleep(600);
    const [actor] = global.get_window_actors();
    const win = actor.metaWindow;
    win.move_frame(false, 200, 200);
    Main.activateWindow(win);
    await Scripting.sleep(1000);
    const focused = await waitFor(() => {
        const state = states.get(actor);
        return state?.room?.enabled && state.effect.shadowFocus === 1;
    });
    check(focused, 'The window has the focused shadow');

    // Around the top left corner, along both edges and through the corner,
    // the shader's shadow has the alphas of the reference image, apart
    // from rounding. The top left quarter of the image reaches from the
    // corner to where the edges are straight. Pixels the window covers,
    // even partly, are left out.
    let frame = win.get_frame_rect();
    const pixel = sampler(await screenshot(), 1);
    const ground = pixel(frame.x - 60, frame.y + frame.height / 2);
    const reference = renderShadow({radius: RADIUS, layers: FOCUSED_SHADOW});
    const quarter = Math.floor(reference.size / 2) + 1;
    const worst = {x: 0, y: 0, diff: 0};
    for (let ry = 0; ry < quarter; ry++) {
        for (let rx = 0; rx < quarter; rx++) {
            const x = rx - reference.margin;
            const y = ry - reference.margin;
            if (outsideTopLeft(x, y, RADIUS) < 0.5) continue;
            const alpha = reference.pixels[(ry * reference.size + rx) * 4 + 3] / 255;
            const diff = Math.abs(pixel(frame.x + x, frame.y + y) - ground * (1 - alpha));
            if (diff > worst.diff) Object.assign(worst, {x, y, diff});
        }
    }
    print(`RWC_SMOKE shadow: at most ${worst.diff.toFixed(1)} levels off the reference`);
    check(
        worst.diff <= 2,
        `The shadow is ${worst.diff.toFixed(1)} levels off the reference at ` +
            `${worst.x}, ${worst.y} from the window corner`,
    );
    let at;

    // The previews in the overview are clones of the window, shadow
    // included. The largest shown clone is the preview, smaller ones are in
    // the workspace thumbnails. Wait until the preview stops moving.
    Main.overview.show();
    const width = c => c.get_transformed_size()[0];
    let last = '';
    const clone = await waitFor(() => {
        if (Main.overview.animationInProgress) return null;
        const [found] = findClones(Main.layoutManager.overviewGroup, actor)
            .filter(c => c.mapped)
            .sort((a, b) => width(b) - width(a));
        const place = `${found?.get_transformed_position()}`;
        const settled = place === last;
        last = place;
        return settled ? found : null;
    });
    check(clone, 'The overview shows a clone of the window');
    if (clone) {
        const [x, y] = clone.get_transformed_position();
        const scale = width(clone) / actor.width;
        const left = x + (frame.x - actor.x) * scale;
        at = row(await screenshot(), y + (frame.y - actor.y + frame.height / 2) * scale, 1);
        const overviewGround = at(left - 60 * scale);
        for (const d of [2, 4]) {
            const value = at(left - d);
            check(
                value < overviewGround - 3,
                `No shadow ${d} px left of the preview (${value} on ${overviewGround})`,
            );
        }
    }
    Main.overview.hide();
    await Scripting.sleep(1000);
    extension.disable();
    await Scripting.destroyTestWindows();

    // A window that first shows at 150 %. Physical pixels, 1.5 per window
    // pixel.
    if (!(await setScale(1.5))) {
        print('RWC_SKIP 150 % needs a larger virtual monitor');
        print('RWC_SMOKE_PASS');
        return;
    }
    extension.enable();
    await Scripting.createTestWindow({width: 400, height: 300});
    await Scripting.waitTestWindows();
    await Scripting.sleep(600);
    const [scaled] = global.get_window_actors().map(a => a.metaWindow);
    scaled.move_frame(false, 200, 200);
    Main.activateWindow(scaled);
    await Scripting.sleep(1000);

    frame = scaled.get_frame_rect();
    at = row(await screenshot(), frame.y + frame.height / 2, 1.5);
    const scaledGround = at(frame.x - 60);
    for (const d of [2, 5, 10]) {
        const value = at(frame.x - d);
        check(
            value < scaledGround - 3,
            `No shadow ${d} px left of the window at 150 % (${value} on ${scaledGround})`,
        );
    }

    extension.disable();
    await Scripting.destroyTestWindows();
    print('RWC_SMOKE_PASS');
}
