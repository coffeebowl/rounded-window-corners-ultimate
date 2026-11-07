// Automation script for tests/run-smoke.sh: an SDL window, whose title bar
// and shadow libdecor draws in subsurfaces, is rounded at all four corners
// (upstream issue #30). The shadow subsurface reaches past the buffer and
// made the actor with the effect larger, which moved the right and bottom
// edges out. Needs python3 and SDL3, skipped without them.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

import {ok as check} from './harness.js';
import {loadExtension, plainBackground, screenshot} from './session.js';

const client = GLib.build_filenamev([
    GLib.path_get_dirname(import.meta.url.replace('file://', '')),
    'sdl-window.py',
]);

export async function run() {
    if (!GLib.find_program_in_path('python3')) {
        print('RWC_SKIP libdecor test needs python3');
        print('RWC_SMOKE_PASS');
        return;
    }
    plainBackground('#c0c0c0');
    const {extension, states} = await loadExtension();
    extension.enable();
    Main.overview.hide();

    const launcher = new Gio.SubprocessLauncher();
    launcher.setenv('SDL_VIDEODRIVER', 'wayland', true);
    const proc = launcher.spawnv(['python3', '-I', client, '30']);
    let exited = false;
    proc.wait_async(null, () => (exited = true));
    let state = null;
    for (let t = 0; t < 8000 && !state?.effect && !exited; t += 100) {
        await Scripting.sleep(100);
        state = [...states.values()].find(s => s.win.get_title() === 'rwc-sdl');
    }
    if (exited && proc.get_exit_status() === 77) {
        print('RWC_SKIP libdecor test needs SDL3');
        extension.disable();
        print('RWC_SMOKE_PASS');
        return;
    }
    check(state?.effect, 'The SDL window has no effect');

    state.win.move_frame(false, 200, 150);
    Main.activateWindow(state.win);
    await Scripting.sleep(800);

    // Outside the rounded corners lies the background, darkened by the
    // shadow: grey and no lighter than the background itself. Not the
    // light title bar, not the blue window contents.
    const frame = state.win.get_frame_rect();
    const image = await screenshot(frame);
    const pixels = image.get_pixels();
    const corners = {
        'top left': [0, 0],
        'top right': [frame.width - 1, 0],
        'bottom left': [0, frame.height - 1],
        'bottom right': [frame.width - 1, frame.height - 1],
    };
    for (const [name, [x, y]] of Object.entries(corners)) {
        const i = y * image.get_rowstride() + x * image.get_n_channels();
        const rgb = [...pixels.slice(i, i + 3)];
        check(
            Math.max(...rgb) <= 192 && Math.max(...rgb) - Math.min(...rgb) < 8,
            `The ${name} corner is not rounded (${rgb})`,
        );
    }

    extension.disable();
    proc.force_exit();
    print('RWC_SMOKE_PASS');
}
