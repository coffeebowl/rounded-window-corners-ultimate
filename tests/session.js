// Helpers for the automation scripts of tests/run-smoke.sh, which run
// inside the private headless GNOME Shell 51 session.

import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

/**
 * Load the packed extension from $RWC_TEST_EXTENSION, without enabling it.
 *
 * @returns {Promise<{extension: object, states: Map<object, object>}>} The
 *   extension and its window states.
 */
export async function loadExtension() {
    const root = GLib.getenv('RWC_TEST_EXTENSION');
    const file = Gio.File.new_for_path(`${root}/metadata.json`);
    const [, bytes] = file.load_contents(null);
    const metadata = JSON.parse(new TextDecoder().decode(bytes));
    const {default: Extension} = await import(`file://${root}/extension.js`);
    const {states} = await import(`file://${root}/manager/window_state.js`);
    const extension = new Extension({
        ...metadata,
        path: root,
        dir: Gio.File.new_for_path(root),
    });
    return {extension, states};
}

/**
 * Show a background of one color, so shadows and borders can be measured.
 *
 * @param {string} color - For example '#c0c0c0'.
 */
export function plainBackground(color) {
    const background = new Gio.Settings({
        schema_id: 'org.gnome.desktop.background',
    });
    background.set_string('picture-options', 'none');
    background.set_string('color-shading-type', 'solid');
    background.set_string('primary-color', color);
}

/**
 * Take a screenshot of the stage.
 *
 * @param {{x?: number, y?: number, width?: number, height?: number}} [area] -
 *   In stage coordinates, the whole stage by default.
 * @returns {Promise<GdkPixbuf.Pixbuf>}
 */
export async function screenshot({
    x = 0,
    y = 0,
    width = global.stage.width,
    height = global.stage.height,
} = {}) {
    const stream = Gio.MemoryOutputStream.new_resizable();
    await new Shell.Screenshot().screenshot_area(x, y, width, height, stream);
    stream.close(null);
    const input = Gio.MemoryInputStream.new_from_bytes(stream.steal_as_bytes());
    return GdkPixbuf.Pixbuf.new_from_stream(input, null);
}
