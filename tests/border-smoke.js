// Automation script for tests/run-smoke.sh: checks that a 1 px border lies
// exactly on the edges of the window frame, and that it is 1.5 pixels wide
// on every side at 150 % (upstream issue #113). Needs a 1920x1080 monitor
// for the 150 % part.
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

/**
 * @param {GdkPixbuf.Pixbuf} image
 * @param {number} x
 * @param {number} y
 * @returns {boolean} Whether the pixel is the red border color.
 */
function isRed(image, x, y) {
    const pixels = image.get_pixels();
    const i = y * image.get_rowstride() + x * image.get_n_channels();
    return pixels[i] > 200 && pixels[i + 1] < 60 && pixels[i + 2] < 60;
}

/**
 * Add up how much border color lies on a line of pixels: 1 for a pixel
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
        // Red over black or white: red minus green is its coverage.
        sum += Math.max(0, pixels[j] - pixels[j + 1]) / 255;
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
    extension.enable();

    // After enable, which resets outdated settings.
    const settings = extension.getSettings();
    settings.set_boolean('skip-libadwaita-app', false);
    settings.set_boolean('skip-libhandy-app', false);
    settings.set_int('border-width', 1);
    const zero = variant('u', 0);
    settings.set_value(
        'global-rounded-corner-settings',
        variant('a{sv}', {
            padding: variant('a{sv}', {
                left: zero,
                right: zero,
                top: zero,
                bottom: zero,
            }),
            keepRoundedCorners: variant('a{sv}', {
                maximized: variant('b', false),
                fullscreen: variant('b', false),
            }),
            borderRadius: zero,
            smoothing: variant('i', 0),
            borderColor: variant('ad', [1, 0, 0, 1]),
            enabled: variant('b', true),
        }),
    );
    for (const key of ['focused-shadow', 'unfocused-shadow']) {
        const shadow = settings.get_value(key).deepUnpack();
        shadow.opacity = 0;
        settings.set_value(key, variant('a{si}', shadow));
    }

    Main.overview.hide();
    await Scripting.createTestWindow({width: 500, height: 320});
    await Scripting.waitTestWindows();
    await Scripting.sleep(600);
    const win = global.get_window_actors()[0].metaWindow;
    win.move_frame(false, 100, 120);
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
            isRed(image, ex, ey) &&
                !isRed(image, ex + dx, ey + dy) &&
                !isRed(image, ex - dx, ey - dy),
            `The ${name} border is not on the frame edge`,
        );
    }

    // While the system prefers dark, the dark border color applies, but
    // only once it is set.
    const isGreen = (shot, px, py) => {
        const pixels = shot.get_pixels();
        const i = py * shot.get_rowstride() + px * shot.get_n_channels();
        return pixels[i] < 60 && pixels[i + 1] > 200 && pixels[i + 2] < 60;
    };
    const desktop = new Gio.Settings({
        schema_id: 'org.gnome.desktop.interface',
    });
    desktop.set_string('color-scheme', 'prefer-dark');
    await Scripting.sleep(300);
    check(
        isRed(await screenshot(), x, midY),
        'Without a dark border color, the border has to stay red',
    );
    settings.set_value('dark-border-color', variant('ad', [0, 1, 0, 1]));
    await Scripting.sleep(300);
    check(
        isGreen(await screenshot(), x, midY),
        'The dark border color has to apply in dark mode',
    );
    desktop.set_string('color-scheme', 'default');
    await Scripting.sleep(300);
    check(
        isRed(await screenshot(), x, midY),
        'The light border color has to return',
    );
    settings.reset('dark-border-color');

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
