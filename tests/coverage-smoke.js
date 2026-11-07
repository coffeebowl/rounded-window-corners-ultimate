// Automation script for pausing windows behind fullscreen windows. Run it
// with: RWC_SMOKE_SCRIPT=$PWD/tests/coverage-smoke.js tests/run-smoke.sh x11
//
// It needs glxgears (mesa-demos), whose X11 window gets a buffer without
// alpha in fullscreen, like games do. Wayland test windows always have
// alpha and never cover anything. Without glxgears the test is skipped.
//
// Set RWC_TEST_SHOTS to a directory to save screenshots of each step.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

import * as AltTab from 'resource:///org/gnome/shell/ui/altTab.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

import {loadExtension, waitFor} from './session.js';

let failures = 0;

/**
 * @param {unknown} value
 * @param {string} message
 */
function check(value, message) {
    if (!value) {
        failures++;
        printerr(`RWC_FAIL ${message}`);
    }
}

/** @param {string} name */
async function screenshot(name) {
    const dir = GLib.getenv('RWC_TEST_SHOTS');
    if (!dir) return;
    const file = Gio.File.new_for_path(`${dir}/${name}.png`);
    const stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
    await new Shell.Screenshot().screenshot_area(0, 0, 1280, 720, stream);
    stream.close(null);
}

/**
 * Resolve with fn() right after the next frame was painted.
 *
 * @template T
 * @param {() => T} fn
 * @returns {Promise<T>}
 */
function afterNextPaint(fn) {
    return new Promise(resolve => {
        const id = global.stage.connect('after-paint', () => {
            global.stage.disconnect(id);
            resolve(fn());
        });
    });
}

/** @param {import('gi://Meta').default.Window} win */
function bringToFront(win) {
    Main.activateWindow(win);
    win.raise();
}

export async function run() {
    if (!GLib.find_program_in_path('glxgears')) {
        print('RWC_SKIP coverage test needs glxgears (mesa-demos)');
        print('RWC_SMOKE_PASS');
        return;
    }

    const {extension, states} = await loadExtension();
    extension.enable();
    Main.overview.hide();
    await Scripting.sleep(600);

    await Scripting.createTestWindow({width: 500, height: 300});
    await Scripting.createTestWindow({width: 400, height: 260});
    await Scripting.waitTestWindows();
    await Scripting.sleep(600);
    const windows = [...states.values()].filter(s => s.effect);
    check(windows.length === 2, 'two test windows with effect');
    windows[0].win.move_frame(false, 60, 80);
    windows[1].win.move_frame(false, 700, 120);

    const launcher = new Gio.SubprocessLauncher({
        flags: Gio.SubprocessFlags.STDOUT_SILENCE,
    });
    const gearsProcess = launcher.spawnv(['glxgears']);
    const gears = await waitFor(() =>
        [...states.values()].find(s => s.win.get_title() === 'glxgears'),
    );
    check(gears, 'glxgears window appeared');
    if (!gears) throw new Error('no glxgears window');
    // It has no window class, and is rounded anyway.
    check(await waitFor(() => gears.effect), 'glxgears has the effect');

    const allPaused = () => windows.every(s => s.suspended);
    const allActive = () =>
        windows.every(s => !s.suspended && s.effect.enabled && s.room.enabled);

    // An opaque fullscreen window pauses the windows below it.
    bringToFront(gears.win);
    gears.win.make_fullscreen();
    await Scripting.sleep(1000);
    check(allPaused(), 'windows below fullscreen glxgears are paused');
    check(
        windows.every(s => !s.effect.enabled && !s.room.enabled),
        'paused windows have no active effects',
    );
    await screenshot('1-fullscreen');

    // The overview shows all windows with their corners.
    Main.overview.show();
    await Scripting.sleep(900);
    check(allActive(), 'overview resumes paused windows');
    await screenshot('2-overview');
    Main.overview.hide();
    await Scripting.sleep(900);
    check(allPaused(), 'windows are paused again after the overview');

    // Alt+Tab shows clones of the windows, with their corners.
    const popup = new AltTab.WindowSwitcherPopup();
    check(popup.show(false, 'switch-windows', 0), 'switcher shown');
    await Scripting.sleep(700);
    check(allActive(), 'switcher resumes paused windows');
    await screenshot('3-switcher');
    popup.destroy();
    await Scripting.sleep(700);
    check(allPaused(), 'windows are paused again after the switcher');

    // A window above the fullscreen window stays active.
    bringToFront(windows[1].win);
    await Scripting.sleep(500);
    check(!windows[1].suspended, 'window above the fullscreen window is active');
    check(windows[0].suspended, 'window below stays paused');
    bringToFront(gears.win);
    await Scripting.sleep(500);

    // Leaving fullscreen shows the corners in the very first frame.
    const unfullscreened = afterNextPaint(allActive);
    gears.win.unmake_fullscreen();
    check(await unfullscreened, 'first frame after leaving fullscreen is active');
    await Scripting.sleep(800);

    // So does minimizing the fullscreen window.
    gears.win.make_fullscreen();
    await Scripting.sleep(1000);
    check(allPaused(), 'paused again in fullscreen');
    const minimized = afterNextPaint(allActive);
    gears.win.minimize();
    check(await minimized, 'first frame after minimizing is active');
    gears.win.unminimize();
    await Scripting.sleep(800);
    gears.win.unmake_fullscreen();
    await Scripting.sleep(600);

    // A fullscreen window with alpha (transparent terminals, most GTK apps)
    // pauses nothing, since the windows below could show through.
    bringToFront(windows[1].win);
    windows[1].win.make_fullscreen();
    await Scripting.sleep(1000);
    check(!windows[0].suspended, 'fullscreen window with alpha pauses nothing');
    windows[1].win.unmake_fullscreen();
    await Scripting.sleep(600);

    // Disabling while windows are paused cleans up.
    bringToFront(gears.win);
    gears.win.make_fullscreen();
    await Scripting.sleep(1000);
    extension.disable();
    check(states.size === 0, 'disable while paused leaves no state');

    gearsProcess.force_exit();
    await Scripting.destroyTestWindows();
    await Scripting.sleep(300);

    if (failures > 0) throw new Error(`${failures} coverage checks failed`);
    print('RWC_SMOKE_PASS');
}
