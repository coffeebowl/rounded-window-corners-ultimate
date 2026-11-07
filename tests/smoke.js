// Automation script for tests/run-smoke.sh. Runs inside a private headless
// GNOME Shell 51 session, never inside the running desktop.
//
// Based on tests/gnome51-smoke.mjs from a1c7e0/rounded-window-corners.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

import {ok as check} from './harness.js';
import {loadExtension} from './session.js';

/** Window states of the loaded extension, set in run(). */
let states;

/** @returns {Meta.WindowActor[]} Window actors that have the effect. */
function roundedActors() {
    return global.get_window_actors().filter(a => states.get(a)?.effect);
}

/** @returns {number} Actors in the window group that are not windows. */
function otherActors() {
    return global.window_group
        .get_children()
        .filter(child => !(child instanceof Meta.WindowActor)).length;
}

/**
 * Save a screenshot of the whole stage, if a path was given.
 *
 * @param {string} path
 */
async function screenshot(path) {
    const file = Gio.File.new_for_path(path);
    const stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
    const shooter = new Shell.Screenshot();
    await shooter.screenshot_area(0, 0, 1280, 720, stream);
    stream.close(null);
}

export async function run() {
    let extension;
    ({extension, states} = await loadExtension());

    const othersBefore = otherActors();
    extension.enable();

    await Scripting.createTestWindow({width: 640, height: 480});
    await Scripting.createTestWindow({width: 400, height: 300});
    await Scripting.waitTestWindows();
    await Scripting.sleep(700);

    // Largest window first, so screenshots are comparable between runs.
    let actors = roundedActors().sort((a, b) => b.width - a.width);
    check(actors.length >= 2, 'Expected rounded effects on two test windows');

    // The shadow is drawn by the effect, in room made before it.
    for (const actor of actors) {
        const {effectActor, effect, room} = states.get(actor);
        const [first, second] = effectActor.get_effects();
        check(
            first === room && second === effect && room.enabled,
            'The room for the shadow has to come before the effect',
        );
    }
    if (GLib.getenv('RWC_TEST_BACKEND') === 'x11') {
        check(
            actors.every(
                a =>
                    a.metaWindow.get_client_type() ===
                    Meta.WindowClientType.X11,
            ),
            'Expected XWayland test windows',
        );
    }

    // The session starts in the overview, leave it for the screenshot.
    Main.overview.hide();
    await Scripting.sleep(600);

    // Place the windows side by side for the screenshot.
    actors[0].metaWindow.move_frame(false, 40, 60);
    actors[1].metaWindow.move_frame(false, 760, 60);
    await Scripting.sleep(500);
    const shot = GLib.getenv('RWC_TEST_SCREENSHOT');
    if (shot) await screenshot(shot);

    Main.overview.show();
    await Scripting.sleep(600);
    Main.overview.hide();
    await Scripting.sleep(600);

    const workspace = global.workspace_manager.get_active_workspace();
    const next = global.workspace_manager.get_workspace_by_index(
        workspace.index() + 1,
    );
    if (next) {
        // Switch with a minimized window, which gets an invisible clone.
        actors[1].metaWindow.minimize();
        await Scripting.sleep(350);
        Main.wm.actionMoveWorkspace(next);
        await Scripting.sleep(650);
        Main.wm.actionMoveWorkspace(workspace);
        await Scripting.sleep(650);
        actors[1].metaWindow.unminimize();
        await Scripting.sleep(350);
    }

    const window = actors[0].metaWindow;
    const state = states.get(actors[0]);

    // Losing the focus blends the shadow, gaining it switches at once.
    Main.activateWindow(actors[1].metaWindow);
    await Scripting.sleep(50);
    check(
        state.effect.shadowFocus > 0 && state.effect.shadowFocus < 1,
        `Losing the focus has to blend the shadow (${state.effect.shadowFocus})`,
    );
    await Scripting.sleep(300);
    check(state.effect.shadowFocus === 0, 'The shadow has to end unfocused');
    Main.activateWindow(window);
    await Scripting.sleep(50);
    check(state.effect.shadowFocus === 1, 'Gaining the focus switches at once');

    // Count painted frames to check that a window updates at most once per
    // frame, however many signals a resize emits.
    let frames = 0;
    const paintId = global.stage.connect('after-paint', () => frames++);
    const countUpdates = async (what, action) => {
        const startFlushes = state.flushes;
        const startFrames = frames;
        action();
        await Scripting.sleep(400);
        const flushes = state.flushes - startFlushes;
        const painted = frames - startFrames;
        print(`RWC_SMOKE ${what}: ${flushes} updates in ${painted} frames`);
        check(flushes > 0, `${what}: no update`);
        check(
            flushes <= painted + 1,
            `${what}: ${flushes} updates in ${painted} frames`,
        );
    };

    await countUpdates('resize burst', () => {
        for (let i = 0; i < 20; i++)
            window.move_resize_frame(false, 30 + i, 30, 600 + i * 5, 400);
    });
    await countUpdates('maximize', () => window.maximize());
    await countUpdates('unmaximize', () => window.unmaximize());
    global.stage.disconnect(paintId);

    // A maximized window has no shadow and needs no room for it.
    window.maximize();
    await Scripting.sleep(350);
    check(!state.room?.enabled, 'A maximized window needs no room for a shadow');
    window.unmaximize();
    await Scripting.sleep(350);
    check(state.room.enabled, 'The room has to return after unmaximizing');

    // Like "Compiz alike magic lamp effect", animate minimizing and
    // unminimizing with an effect added after the extension's handler ran.
    // Shadow and corners pause until the animation is almost done.
    const lampIds = ['minimize', 'unminimize'].map(signal =>
        global.window_manager.connect(signal, (_, a) => {
            const lamp = new Clutter.DesaturateEffect();
            lamp.timerId = new Clutter.Timeline({actor: a, duration: 400});
            lamp.timerId.connect('completed', () => a.remove_effect(lamp));
            a.add_effect_with_name(`${signal}-magic-lamp-effect`, lamp);
            lamp.timerId.start();
        }),
    );
    const lampPaused = () => !state.room.enabled && !state.effect.enabled;
    for (const action of ['minimize', 'unminimize']) {
        window[action]();
        await Scripting.sleep(100);
        check(lampPaused(), `${action}: the magic lamp has to pause the window`);
        await Scripting.sleep(500);
    }
    // Minimized again before the unminimize ended: when the old animation
    // ends, the new one still runs, and the window has to stay paused.
    window.minimize();
    await Scripting.sleep(600);
    window.unminimize();
    await Scripting.sleep(200);
    window.minimize();
    await Scripting.sleep(250);
    check(lampPaused(), 'The end of an older magic lamp must not resume');
    await Scripting.sleep(400);
    window.unminimize();
    await Scripting.sleep(600);
    for (const id of lampIds) global.window_manager.disconnect(id);
    check(
        state.room.enabled && state.effect.enabled,
        'The window has to return after the magic lamp',
    );

    window.move_resize_frame(false, 30, 30, 720, 500);
    await Scripting.sleep(350);
    window.maximize();
    await Scripting.sleep(350);
    window.unmaximize();
    await Scripting.sleep(350);
    window.make_fullscreen();
    await Scripting.sleep(350);
    window.unmake_fullscreen();
    await Scripting.sleep(350);
    window.minimize();
    await Scripting.sleep(350);
    window.unminimize();
    await Scripting.sleep(650);

    await Scripting.destroyTestWindows();
    await Scripting.sleep(400);

    // Windows that close right after opening, some after going fullscreen,
    // like mpv or Electron apps in upstream issues #115 and #131: before
    // their first buffer, during the app detection or the opening
    // animation. Nothing may run on them afterwards or stay behind.
    for (let i = 0; i < 12; i++) {
        await Scripting.createTestWindow({width: 300, height: 200});
        await Scripting.sleep(i * 15);
        if (i % 3 === 2) {
            for (const actor of global.get_window_actors())
                actor.metaWindow?.make_fullscreen();
            await Scripting.sleep(i * 5);
        }
        await Scripting.destroyTestWindows();
    }
    await Scripting.sleep(600);
    check(states.size === 0, 'Closed windows left window states behind');
    check(otherActors() === othersBefore, 'Closed windows left actors behind');

    extension.disable();

    // Like Blur my Shell, put a widget in front of the window contents
    // before the extension sees the window. The effect has to go on the
    // contents, so the widget stays outside the offscreen framebuffer.
    await Scripting.createTestWindow({width: 500, height: 320});
    await Scripting.waitTestWindows();
    for (const actor of global.get_window_actors())
        actor.insert_child_at_index(new St.Widget({name: 'RWC blur'}), 0);
    extension.enable();
    await Scripting.sleep(600);
    actors = roundedActors();
    check(actors.length > 0, 'Re-enable did not create effects');
    for (const actor of actors) {
        const {effectActor} = states.get(actor);
        check(
            effectActor.get_parent() === actor &&
                !(effectActor instanceof St.Widget) &&
                actor.get_effects().length === 0,
            'The effect has to be on the window contents',
        );
    }

    extension.disable();
    check(roundedActors().length === 0, 'Disable leaked window effects');
    check(states.size === 0, 'Disable leaked window states');
    check(otherActors() === othersBefore, 'Disable leaked actors');
    await Scripting.destroyTestWindows();

    print('RWC_SMOKE_PASS');
}
