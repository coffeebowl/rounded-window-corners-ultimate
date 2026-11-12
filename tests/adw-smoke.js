// Automation script for tests/run-smoke.sh: libadwaita apps get the focus
// border, and nothing else. They keep their own corners and shadow, and the
// effect is only on while they have the focus. Uses gnome-calculator and
// skips if it is not installed. Needs a 1920x1080 monitor.

import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

import {ok as check} from './harness.js';
import {loadExtension, plainBackground, screenshot} from './session.js';

/** The red accent color, #e62d42 in st-theme-context.c. */
const RED = [230, 45, 66];

/**
 * @param {GdkPixbuf.Pixbuf} image
 * @param {number} x
 * @param {number} y
 * @returns {number[]} Red, green and blue of a pixel.
 */
function pixelAt(image, x, y) {
    const pixels = image.get_pixels();
    const i = y * image.get_rowstride() + x * image.get_n_channels();
    return [pixels[i], pixels[i + 1], pixels[i + 2]];
}

/** @returns {boolean} Whether a pixel has the red accent color. */
const isRed = rgb => RED.every((c, i) => Math.abs(rgb[i] - c) < 12);

export async function run() {
    if (!GLib.find_program_in_path('gnome-calculator')) {
        print('RWC_SKIP gnome-calculator is not installed');
        print('RWC_SMOKE_PASS');
        return;
    }

    plainBackground('#c0c0c0');
    new Gio.Settings({schema_id: 'org.gnome.desktop.interface'})
        .set_string('accent-color', 'red');

    const {extension, states} = await loadExtension();
    extension.enable();
    const settings = extension.getSettings();
    settings.set_int('focus-border-width', 2);
    Main.overview.hide();

    const calculator = Gio.Subprocess.new(['gnome-calculator'], Gio.SubprocessFlags.NONE);
    await Scripting.createTestWindow({width: 400, height: 300});
    await Scripting.waitTestWindows();
    let adw = null;
    for (let i = 0; i < 80 && !adw; i++) {
        await Scripting.sleep(250);
        adw = global
            .get_window_actors()
            .map(a => a.metaWindow)
            .find(w => /calculator/i.test(w.get_wm_class() ?? ''));
    }
    check(adw, 'gnome-calculator did not show up');
    const other = global
        .get_window_actors()
        .map(a => a.metaWindow)
        .find(w => w !== adw);
    // The window shows up before it takes moves and focus.
    await Scripting.sleep(1500);
    adw.move_frame(false, 100, 100);
    other.move_frame(false, 900, 100);
    Main.activateWindow(adw);
    await Scripting.sleep(1500);
    const state = () => states.get(adw.get_compositor_private());

    check(!state().effect, 'libadwaita apps have no effect while the focus border is off');

    settings.set_boolean('focus-border', true);
    await Scripting.sleep(600);
    check(state().effect?.enabled, 'The focused libadwaita app has the effect');
    check(!state().room.enabled, 'libadwaita apps keep their own shadow');

    const frame = adw.get_frame_rect();
    const midY = frame.y + Math.floor(frame.height / 2);
    let image = await screenshot();
    check(isRed(pixelAt(image, frame.x, midY)), 'The focus border is on the edge');
    // The app's own shadow lies outside its frame; the effect must not cut
    // it off.
    const ground = pixelAt(image, frame.x - 60, midY)[0];
    const shadow = pixelAt(image, frame.x - 3, midY)[0];
    check(shadow < ground - 10, `The app's own shadow is gone (${shadow} on ${ground})`);

    Main.activateWindow(other);
    await Scripting.sleep(600);
    check(!state().effect, 'No effect while the app has no focus');
    image = await screenshot();
    check(!isRed(pixelAt(image, frame.x, midY)), 'No focus border without focus');

    settings.set_boolean('focus-border', false);
    await Scripting.sleep(600);
    check(!state().effect, 'The effect goes when the focus border is turned off');

    extension.disable();
    adw.kill();
    calculator.force_exit();
    await Scripting.destroyTestWindows();
    await Scripting.sleep(500);
    print('RWC_SMOKE_PASS');
}
