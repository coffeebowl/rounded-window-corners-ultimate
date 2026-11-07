// Helpers for the automation scripts of tests/run-smoke.sh, which run
// inside the private headless GNOME Shell 51 session.

import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

/**
 * Wait until the shell's test client, which opens the test windows, is on
 * the bus. The shell starts it with the script but does not wait for it,
 * and for X11 it first has to start Xwayland, which takes a while on slow
 * machines.
 *
 * @returns {Promise<void>}
 */
function testClientReady() {
    return new Promise(resolve => {
        const id = Gio.bus_watch_name(
            Gio.BusType.SESSION,
            'org.gnome.Shell.PerfHelper',
            Gio.BusNameWatcherFlags.NONE,
            () => {
                Gio.bus_unwatch_name(id);
                resolve();
            },
            null,
        );
    });
}

/**
 * Load the packed extension from $RWC_TEST_EXTENSION, without enabling it,
 * once the test client is ready.
 *
 * @returns {Promise<{extension: object, states: Map<object, object>}>} The
 *   extension and its window states.
 */
export async function loadExtension() {
    await testClientReady();
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

/**
 * Poll until fn returns something truthy, for things that take longer on
 * slow machines.
 *
 * @template T
 * @param {() => T | Promise<T>} fn
 * @param {number} [timeout] - Milliseconds to give up after.
 * @returns {Promise<T | null>} The last value, or null on timeout.
 */
export async function waitFor(fn, timeout = 8000) {
    for (let t = 0; t < timeout; t += 100) {
        const value = await fn();
        if (value) return value;
        await Scripting.sleep(100);
    }
    return null;
}
