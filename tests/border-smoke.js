// Automation script for tests/run-smoke.sh: checks that a 1 px border lies
// exactly on the edges of the window frame.
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

/**
 * @param {unknown} value
 * @param {string} message
 */
function check(value, message) {
    if (!value) throw new Error(message);
}

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

    extension.disable();
    await Scripting.destroyTestWindows();
    print('RWC_SMOKE_PASS');
}
