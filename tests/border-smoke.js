// Automation script for tests/run-smoke.sh: checks that a 1 px focus border
// lies exactly on the edges of the window frame, follows focus and accent
// color, and is 1.5 pixels wide on every side at 150 % (upstream issue
// #113). Needs a 1920x1080 monitor for the 150 % part.
//
// The shader maps texture coordinates to window coordinates with Clutter's
// padding rules for offscreen textures. If those rules change, the border
// moves by a pixel or two, which this test notices.

import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

import {ok as check} from './harness.js';

/** @returns {Promise<GdkPixbuf.Pixbuf>} The whole stage. */
async function screenshot() {
    const stream = Gio.MemoryOutputStream.new_resizable();
    const {width, height} = global.stage;
    await new Shell.Screenshot().screenshot_area(0, 0, width, height, stream);
    stream.close(null);
    const input = Gio.MemoryInputStream.new_from_bytes(stream.steal_as_bytes());
    return GdkPixbuf.Pixbuf.new_from_stream(input, null);
}

/** The red accent color, #e62d42 in st-theme-context.c. */
const RED = [230, 45, 66];
/** The green accent color, #3a944a. */
const GREEN = [58, 148, 74];

/**
 * @param {GdkPixbuf.Pixbuf} image
 * @param {number} x
 * @param {number} y
 * @param {number[]} [color] - The color to look for.
 * @returns {boolean} Whether the pixel has the color.
 */
function isColor(image, x, y, color = RED) {
    const pixels = image.get_pixels();
    const i = y * image.get_rowstride() + x * image.get_n_channels();
    return color.every((c, j) => Math.abs(pixels[i + j] - c) < 12);
}

/**
 * Add up how much red border lies on a line of pixels: 1 for a pixel
 * fully covered by the border, 0.5 for one half covered.
 *
 * @param {GdkPixbuf.Pixbuf} image
 * @param {number} x - First pixel.
 * @param {number} y - First pixel.
 * @param {number} dx - Step to the next pixel.
 * @param {number} dy - Step to the next pixel.
 * @param {number} count - Number of pixels.
 * @returns {number}
 */
function borderAmount(image, x, y, dx, dy, count) {
    const pixels = image.get_pixels();
    let sum = 0;
    for (let i = 0; i < count; i++) {
        const j =
            (y + i * dy) * image.get_rowstride() +
            (x + i * dx) * image.get_n_channels();
        // Red over black or grey: red minus green is its coverage.
        sum += Math.max(0, pixels[j] - pixels[j + 1]) / (RED[0] - RED[1]);
    }
    return sum;
}

/**
 * @param {string} method
 * @param {GLib.Variant | null} params
 * @returns {Promise<GLib.Variant>}
 */
function callDisplayConfig(method, params) {
    return new Promise((resolve, reject) => {
        Gio.DBus.session.call(
            'org.gnome.Mutter.DisplayConfig',
            '/org/gnome/Mutter/DisplayConfig',
            'org.gnome.Mutter.DisplayConfig',
            method,
            params,
            null,
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            (connection, result) => {
                try {
                    resolve(connection.call_finish(result));
                } catch (e) {
                    reject(e);
                }
            },
        );
    });
}

/**
 * Switch the monitor to a scale, if its mode supports it.
 *
 * @param {number} wanted
 * @returns {Promise<boolean>} Whether the scale is supported.
 */
async function setScale(wanted) {
    const state = await callDisplayConfig('GetCurrentState', null);
    const [serial, monitors] = state.deepUnpack();
    const [[connector], [mode]] = monitors[0];
    const [modeId, , , , , scales] = mode;
    const scale = scales.find(s => Math.abs(s - wanted) < 0.01);
    if (!scale) return false;

    await callDisplayConfig(
        'ApplyMonitorsConfig',
        variant('(uua(iiduba(ssa{sv}))a{sv})', [
            serial,
            1, // temporary
            [[0, 0, scale, 0, true, [[connector, modeId, {}]]]],
            {},
        ]),
    );
    return true;
}

const variant = (type, value) => new GLib.Variant(type, value);

export async function run() {
    const background = new Gio.Settings({
        schema_id: 'org.gnome.desktop.background',
    });
    background.set_string('picture-options', 'none');
    background.set_string('color-shading-type', 'solid');
    background.set_string('primary-color', '#000000');

    const root = GLib.getenv('RWC_TEST_EXTENSION');
    const file = Gio.File.new_for_path(`${root}/metadata.json`);
    const [, bytes] = file.load_contents(null);
    const metadata = JSON.parse(new TextDecoder().decode(bytes));
    const {default: Extension} = await import(`file://${root}/extension.js`);
    const extension = new Extension({
        ...metadata,
        path: root,
        dir: Gio.File.new_for_path(root),
    });
    const desktop = new Gio.Settings({
        schema_id: 'org.gnome.desktop.interface',
    });
    desktop.set_string('accent-color', 'red');
    extension.enable();
    const settings = extension.getSettings();
    settings.set_boolean('focus-border', true);
    settings.set_int('focus-border-width', 1);

    Main.overview.hide();
    await Scripting.createTestWindow({width: 500, height: 320});
    await Scripting.createTestWindow({width: 300, height: 200});
    await Scripting.waitTestWindows();
    await Scripting.sleep(600);
    const [win, other] = global
        .get_window_actors()
        .map(a => a.metaWindow)
        .sort((a, b) => b.get_frame_rect().width - a.get_frame_rect().width);
    win.move_frame(false, 100, 120);
    other.move_frame(false, 900, 120);
    Main.activateWindow(win);
    await Scripting.sleep(600);

    const {x, y, width, height} = win.get_frame_rect();
    const image = await screenshot();
    const midX = x + Math.floor(width / 2);
    const midY = y + Math.floor(height / 2);
    // Each edge as [first pixel of the frame, step to the outside].
    const edges = {
        left: [x, midY, -1, 0],
        right: [x + width - 1, midY, 1, 0],
        top: [midX, y, 0, -1],
        bottom: [midX, y + height - 1, 0, 1],
    };
    for (const [name, [ex, ey, dx, dy]] of Object.entries(edges)) {
        check(
            isColor(image, ex, ey) &&
                !isColor(image, ex + dx, ey + dy) &&
                !isColor(image, ex - dx, ey - dy),
            `The ${name} border is not on the frame edge`,
        );
    }

    // Only the focused window has the border, the other one the thin line.
    const otherX = other.get_frame_rect().x;
    const otherY = other.get_frame_rect().y + 100;
    check(!isColor(image, otherX, otherY), 'An unfocused window has no focus border');
    Main.activateWindow(other);
    await Scripting.sleep(300);
    let shot = await screenshot();
    check(
        isColor(shot, otherX, otherY) && !isColor(shot, x, midY),
        'The focus border has to move with the focus',
    );
    Main.activateWindow(win);
    await Scripting.sleep(300);

    // The border follows the accent color and its switch.
    desktop.set_string('accent-color', 'green');
    await Scripting.sleep(300);
    check(isColor(await screenshot(), x, midY, GREEN), 'The border has to follow the accent color');
    desktop.set_string('accent-color', 'red');
    settings.set_boolean('focus-border', false);
    await Scripting.sleep(300);
    shot = await screenshot();
    check(!isColor(shot, x, midY), 'The border has to go when switched off');
    settings.set_boolean('focus-border', true);
    await Scripting.sleep(300);
    check(isColor(await screenshot(), x, midY), 'The border has to return');

    // At 150 %, a 1 px border covers 1.5 pixels on every side, wherever
    // the window is. Before, it was 1 or 2 pixels depending on the side
    // and position.
    if (await setScale(1.5)) {
        for (const left of [100, 101]) {
            win.move_frame(false, left, 120);
            await Scripting.sleep(600);
            const frame = win.get_frame_rect();
            const shot = await screenshot();
            const at = v => Math.round(v * 1.5);
            const cx = at(frame.x + frame.width / 2);
            const cy = at(frame.y + frame.height / 2);
            const amounts = {
                left: borderAmount(shot, at(frame.x) - 3, cy, 1, 0, 6),
                right: borderAmount(shot, at(frame.x + frame.width) - 3, cy, 1, 0, 6),
                top: borderAmount(shot, cx, at(frame.y) - 3, 0, 1, 6),
                bottom: borderAmount(shot, cx, at(frame.y + frame.height) - 3, 0, 1, 6),
            };
            for (const [name, amount] of Object.entries(amounts)) {
                check(
                    Math.abs(amount - 1.5) < 0.1,
                    `The ${name} border at x = ${left} is ${amount.toFixed(2)} pixels wide at 150 %`,
                );
            }
        }
    } else {
        print('RWC_SKIP 150 % needs a larger virtual monitor');
    }

    extension.disable();
    await Scripting.destroyTestWindows();
    print('RWC_SMOKE_PASS');
}
