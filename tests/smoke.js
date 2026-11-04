// Automation script for tests/run-smoke.sh. Runs inside a private headless
// GNOME Shell 51 session, never inside the running desktop.
//
// Based on tests/gnome51-smoke.mjs from a1c7e0/rounded-window-corners.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

/**
 * @param {unknown} value
 * @param {string} message
 */
function check(value, message) {
    if (!value) throw new Error(message);
}

/** Window states of the loaded extension, set in run(). */
let states;

/** @returns {Meta.WindowActor[]} Window actors that have the effect. */
function roundedActors() {
    return global.get_window_actors().filter(a => states.get(a)?.effect);
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
    const root = GLib.getenv('RWC_TEST_EXTENSION');
    const file = Gio.File.new_for_path(`${root}/metadata.json`);
    const [, bytes] = file.load_contents(null);
    const metadata = JSON.parse(new TextDecoder().decode(bytes));
    const {default: Extension} = await import(`file://${root}/extension.js`);
    ({states} = await import(`file://${root}/manager/window_state.js`));
    const extension = new Extension({
        ...metadata,
        path: root,
        dir: Gio.File.new_for_path(root),
    });

    const settings = extension.getSettings();
    settings.set_boolean('skip-libadwaita-app', false);
    settings.set_boolean('skip-libhandy-app', false);
    extension.enable();

    await Scripting.createTestWindow({width: 640, height: 480});
    await Scripting.createTestWindow({width: 400, height: 300});
    await Scripting.waitTestWindows();
    await Scripting.sleep(700);

    // Largest window first, so screenshots are comparable between runs.
    let actors = roundedActors().sort((a, b) => b.width - a.width);
    check(actors.length >= 2, 'Expected rounded effects on two test windows');

    // Shadows are pre-rendered images, no offscreen effect per shadow.
    for (const actor of actors) {
        const {shadow} = states.get(actor);
        check(
            shadow.get_effects().length === 0 &&
                shadow.firstChild.get_effects().length === 0,
            'Shadow actors must not have effects',
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
        Main.wm.actionMoveWorkspace(next);
        await Scripting.sleep(650);
        Main.wm.actionMoveWorkspace(workspace);
        await Scripting.sleep(650);
    }

    const window = actors[0].metaWindow;
    const state = states.get(actors[0]);

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
    check(
        !global.window_group
            .get_children()
            .some(child => child.name === 'Shadow Actor'),
        'Disable leaked shadow actors',
    );
    await Scripting.destroyTestWindows();

    print('RWC_SMOKE_PASS');
}
