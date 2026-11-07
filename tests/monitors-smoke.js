// Automation script for tests/run-smoke.sh: two monitors with different
// scales. A window moved to the other monitor and back looks like one that
// was there from the start (upstream issue #93, border and shadow kept the
// old scale), and a workspace switch leaves the windows as they were (#46).
// Needs RWC_SMOKE_MONITOR="1920x1080 1920x1080".

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

import {setScales} from './display.js';
import {ok as check} from './harness.js';
import {
    loadExtension,
    plainBackground,
    screenshot,
    waitFor,
} from './session.js';

/**
 * The largest difference of a color channel between two areas.
 *
 * @param {import('gi://GdkPixbuf').default.Pixbuf} a
 * @param {number[]} aOrigin - Top left corner of the area in `a`.
 * @param {import('gi://GdkPixbuf').default.Pixbuf} b
 * @param {number[]} bOrigin - Top left corner of the area in `b`.
 * @param {number} width
 * @param {number} height
 * @returns {number}
 */
function maxDifference(a, [ax, ay], b, [bx, by], width, height) {
    const pa = a.get_pixels();
    const pb = b.get_pixels();
    const n = a.get_n_channels();
    let max = 0;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (ay + y) * a.get_rowstride() + (ax + x) * n;
            const j = (by + y) * b.get_rowstride() + (bx + x) * n;
            for (let c = 0; c < 3; c++)
                max = Math.max(max, Math.abs(pa[i + c] - pb[j + c]));
        }
    }
    return max;
}

export async function run() {
    // The monitor at 100 % is the primary one, so its windows take part
    // in workspace switches.
    const scales = [2, 1];
    if (!(await setScales(scales, 1))) {
        print('RWC_SKIP needs two 1920x1080 monitors');
        print('RWC_SMOKE_PASS');
        return;
    }
    plainBackground('#c0c0c0');
    new Gio.Settings({schema_id: 'org.gnome.desktop.interface'})
        .set_string('accent-color', 'red');

    const {extension, states} = await loadExtension();
    extension.enable();
    const settings = extension.getSettings();
    settings.set_boolean('focus-border', true);
    settings.set_int('focus-border-width', 1);
    Main.overview.hide();

    // The 100 % monitor starts right of the one at 200 %. Each window that
    // stays is drawn on its monitor from the start, the third moves over
    // and back.
    const monitors = [0, 1].map(i => global.display.get_monitor_geometry(i));
    const [left, right] = monitors;
    const pointer = global.stage.context
        .get_backend()
        .get_default_seat()
        .create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
    // New windows open on the monitor with the pointer, or on slow
    // machines on the primary one, so make it both for the time.
    const open = async index => {
        const monitor = monitors[index];
        await setScales(scales, index);
        pointer.notify_absolute_motion(
            GLib.get_monotonic_time(),
            monitor.x + monitor.width / 2,
            monitor.y + monitor.height / 2,
        );
        // Input goes through its own thread, so the pointer arrives later.
        await waitFor(() => global.display.get_current_monitor() === index);
        const before = global.get_window_actors();
        await Scripting.createTestWindow({width: 300, height: 200});
        await Scripting.waitTestWindows();
        await Scripting.sleep(600);
        return global
            .get_window_actors()
            .find(a => !before.includes(a)).metaWindow;
    };
    const there = await open(0);
    const here = await open(1);
    const moved = await open(1);
    check(
        there.get_monitor() === 0 && here.get_monitor() === 1,
        'The windows did not open on their monitors',
    );

    // The left monitor is only 960x540, so the windows there lie
    // diagonally apart.
    there.move_frame(false, left.x + 560, 300);
    here.move_frame(false, right.x + 700, 150);
    moved.move_frame(false, right.x + 100, 150);
    Main.activateWindow(moved);
    await Scripting.sleep(600);

    /**
     * Compare the top left corner, shadow and border, of a window with
     * that of a window which was on the same monitor from the start. Both
     * are focused in turn.
     */
    const compare = async (win, reference) => {
        const monitor = monitors[win.get_monitor()];
        const shots = [];
        for (const w of [win, reference]) {
            Main.activateWindow(w);
            await Scripting.sleep(400);
            const image = await screenshot(monitor);
            const k = image.get_width() / monitor.width;
            const frame = w.get_frame_rect();
            shots.push(image, [
                Math.round((frame.x - monitor.x - 40) * k),
                Math.round((frame.y - monitor.y - 40) * k),
            ]);
        }
        const size = Math.round(80 * (shots[0].get_width() / monitor.width));
        return maxDifference(...shots, size, size);
    };

    for (const [target, reference, scale] of [
        [left, there, '200 %'],
        [right, here, '100 %'],
    ]) {
        moved.move_frame(false, target.x + 100, 100);
        await Scripting.sleep(600);
        check(
            moved.get_monitor() === reference.get_monitor(),
            `The window did not move to ${scale}`,
        );
        check(
            states.get(moved.get_compositor_private())?.effect,
            `The window lost the effect at ${scale}`,
        );
        const difference = await compare(moved, reference);
        check(
            difference <= 1,
            `A moved window looks different at ${scale} (difference ${difference})`,
        );
    }
    Main.activateWindow(here);
    await Scripting.sleep(400);
    const before = await screenshot(right);

    // Switching to the next workspace and back leaves everything as it was.
    const workspace = global.workspace_manager.get_active_workspace();
    Main.wm.actionMoveWorkspace(
        global.workspace_manager.get_workspace_by_index(workspace.index() + 1),
    );
    await Scripting.sleep(700);
    Main.wm.actionMoveWorkspace(workspace);
    await Scripting.sleep(700);
    const after = await screenshot(right);
    // Without the top bar, whose clock may change.
    const top = 40;
    const changed = maxDifference(
        before, [0, top], after, [0, top], right.width, right.height - top);
    check(
        changed <= 1,
        `A workspace switch changed the windows (difference ${changed})`,
    );

    extension.disable();
    await Scripting.destroyTestWindows();
    print('RWC_SMOKE_PASS');
}
