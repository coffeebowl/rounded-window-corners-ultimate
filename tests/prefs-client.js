// Drives the preferences window of the packed extension in
// $RWC_TEST_EXTENSION and checks what lands in GSettings. Started by
// tests/prefs-smoke.js; exits with status 1 if a check fails.

import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk?version=4.0';
import System from 'system';

import {ok as check} from './harness.js';

/** Let GTK handle pending work, such as mapping a pushed page. */
function settle() {
    return new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_LOW, 100, () => {
        resolve();
        return GLib.SOURCE_REMOVE;
    }));
}

/**
 * Find widgets below a widget by their GType name.
 *
 * @param {import('gi://Gtk').default.Widget} widget
 * @param {string} typeName
 * @returns {import('gi://Gtk').default.Widget[]}
 */
function findAll(widget, typeName) {
    const found = [];
    for (let child = widget.get_first_child(); child; child = child.get_next_sibling()) {
        if (GObject.type_name(child.constructor.$gtype) === typeName) found.push(child);
        found.push(...findAll(child, typeName));
    }
    return found;
}

/**
 * Save a widget as PNG to $RWC_TEST_SHOTS, if set, to look at the layout.
 *
 * @param {import('gi://Gtk').default.Widget} widget
 * @param {string} name
 */
function shot(widget, name) {
    const dir = GLib.getenv('RWC_TEST_SHOTS');
    if (!dir) return;
    const paintable = new Gtk.WidgetPaintable({widget});
    const snapshot = new Gtk.Snapshot();
    paintable.snapshot(snapshot, widget.get_width(), widget.get_height());
    const node = snapshot.to_node();
    if (!node) return;
    widget.get_native().get_renderer().render_texture(node, null)
        .save_to_png(`${dir}/${name}.png`);
}

/** Make the stub answer for the shell's prefs module. */
function registerStub() {
    const dir = GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]);
    const scratch = GLib.dir_make_tmp('rwc-prefs-XXXXXX');
    const xml = `${scratch}/stub.gresource.xml`;
    GLib.file_set_contents(xml, `<gresources>
        <gresource prefix="/org/gnome/Shell/Extensions/js/extensions">
            <file alias="prefs.js">prefs-stub.js</file>
        </gresource>
    </gresources>`);
    const target = `${scratch}/stub.gresource`;
    const [ok] = GLib.spawn_sync(null, [
        'glib-compile-resources', `--sourcedir=${dir}`, `--target=${target}`, xml,
    ], null, GLib.SpawnFlags.SEARCH_PATH, null);
    check(ok, 'glib-compile-resources failed');
    Gio.Resource.load(target)._register();
}

async function main() {
    registerStub();
    Adw.init();

    const root = GLib.getenv('RWC_TEST_EXTENSION');
    const [, bytes] = GLib.file_get_contents(`${root}/metadata.json`);
    const metadata = {...JSON.parse(new TextDecoder().decode(bytes)), path: root};
    const {default: Prefs} = await import(`file://${root}/prefs.js`);
    const prefs = new Prefs(metadata);

    const settings = prefs.getSettings();

    const win = new Adw.PreferencesWindow();
    await prefs.fillPreferencesWindow(win);
    win.present();
    await settle();
    shot(win, 'prefs');

    // The width row follows the switch in the group header.
    const [toggle] = findAll(win, 'GtkSwitch');
    const [width] = findAll(win, 'AdwSpinRow');
    check(!toggle.active && !width.sensitive, 'Focus border starts off, width greyed out');
    toggle.active = true;
    check(settings.get_boolean('focus-border'), 'Switch saved');
    check(width.sensitive, 'Width can be changed once the border is on');

    // The width is saved and stays within the schema's range.
    check(width.value === settings.get_int('focus-border-width'), 'Width row shows the setting');
    width.value = 3;
    check(settings.get_int('focus-border-width') === 3, 'Width saved');
    width.value = 7;
    check(settings.get_int('focus-border-width') === 7, 'Wider borders saved');
    width.value = 20;
    check(settings.get_int('focus-border-width') === 10, 'Width kept within 1 to 10');
    settings.set_int('focus-border-width', 1);
    check(width.value === 1, 'Width row follows the setting');

    win.close();
    await settle();
}

try {
    await main();
    print('prefs checks passed');
} catch (e) {
    printerr(`JS ERROR: prefs check failed: ${e.message}\n${e.stack}`);
    System.exit(1);
}
