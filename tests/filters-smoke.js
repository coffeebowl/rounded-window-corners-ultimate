// Automation script for tests/run-smoke.sh: the texture filters of the
// offscreen texture, see extension/effect/texture_filters.js. Needs
// RWC_SMOKE_MONITOR=1920x1080, the only size here with 150 % and 200 %.
//
// At 200 %, overview previews are scaled down and need linear filtering,
// although each texel of the texture is twice as large as a logical pixel.
// At 150 %, a small clone next to a window must not change how the window
// itself is painted, neither while it is shown nor after it is gone.

import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

import {setScale} from './display.js';
import {ok as check} from './harness.js';
import {
    afterNextPaint,
    loadExtension,
    maxDifference,
    plainBackground,
    screenshot,
    waitFor,
} from './session.js';

/**
 * Open test windows and wait until all of them have the effect.
 *
 * @param {Map<object, object>} states - Window states of the extension.
 * @param {number} count
 * @returns {Promise<object[]>} Their window states.
 */
async function openWindows(states, count) {
    for (let i = 0; i < count; i++)
        await Scripting.createTestWindow({width: 400, height: 300});
    await Scripting.waitTestWindows();
    const withEffect = () => [...states.values()].filter(s => s.effect);
    await waitFor(() => withEffect().length === count);
    return withEffect();
}

/**
 * @param {object} state - A window state with the effect.
 * @returns {number} The minification filter of its offscreen texture.
 */
function minFilter(state) {
    return state.effect.get_pipeline()?.get_layer_filters(0)[0];
}

export async function run() {
    if (!(await setScale(2))) {
        print('RWC_SKIP texture filters need a 1920x1080 monitor');
        print('RWC_SMOKE_PASS');
        return;
    }
    plainBackground('#c0c0c0');
    const {extension, states} = await loadExtension();
    extension.enable();
    Main.overview.hide();

    // Two windows on one workspace, so the overview shows no workspace
    // thumbnails, and the last paint of each window is its preview.
    let windows = await openWindows(states, 2);
    check(windows.length === 2, 'Two test windows with the effect');
    windows[0].win.move_frame(false, 40, 60);
    windows[1].win.move_frame(false, 480, 120);
    await waitFor(() => !Main.overview.animationInProgress);

    Main.overview.show();
    await waitFor(
        () => Main.overview.visible && !Main.overview.animationInProgress,
    );
    await afterNextPaint(() => {});
    for (const state of windows) {
        check(
            minFilter(state) === Cogl.PipelineFilter.LINEAR,
            `A preview at 200 % has to be filtered linearly (${minFilter(state)})`,
        );
    }
    Main.overview.hide();
    await waitFor(
        () => !Main.overview.visible && !Main.overview.animationInProgress,
    );
    await Scripting.destroyTestWindows();
    await waitFor(() => states.size === 0);

    // A clone at a tenth of the size, like a dock preview, is painted
    // from a mipmap. At 150 % the texture is larger than the window on
    // screen, so the window itself would show the mipmap.
    check(await setScale(1.5), '150 % is supported');
    windows = await openWindows(states, 1);
    const [state] = windows;
    check(state, 'A test window with the effect');
    state.win.move_frame(false, 330, 100);
    Main.activateWindow(state.win);
    await waitFor(
        () =>
            state.effect.shadowFocus === 1 &&
            state.actor.opacity === 255 &&
            state.actor.scaleX === 1 &&
            state.actor.scaleY === 1,
    );
    await afterNextPaint(() => {});

    const frame = state.win.get_frame_rect();
    const area = {
        x: frame.x - 30,
        y: frame.y - 30,
        width: frame.width + 60,
        height: frame.height + 60,
    };
    const alone = await screenshot(area);
    const differenceTo = image =>
        maxDifference(
            alone,
            [0, 0],
            image,
            [0, 0],
            alone.get_width(),
            alone.get_height(),
        );

    const clone = new Clutter.Clone({
        source: state.actor,
        x: 4,
        y: 40,
        scale_x: 0.1,
        scale_y: 0.1,
    });
    const painted = afterNextPaint(() => minFilter(state));
    Main.layoutManager.uiGroup.add_child(clone);
    check(
        (await painted) === Cogl.PipelineFilter.LINEAR_MIPMAP_LINEAR,
        'A clone at 10 % has to be painted from a mipmap',
    );
    const withClone = differenceTo(await screenshot(area));
    check(
        withClone === 0,
        `A small clone changed the window (difference ${withClone})`,
    );

    const gone = afterNextPaint(() => {});
    clone.destroy();
    await gone;
    const afterClone = differenceTo(await screenshot(area));
    check(
        afterClone === 0,
        `A small clone changed the window after it was gone (difference ${afterClone})`,
    );

    extension.disable();
    await Scripting.destroyTestWindows();
    print('RWC_SMOKE_PASS');
}
