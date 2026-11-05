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
    settings.set_strv('blacklist', ['a', 'b', 'c']);

    const win = new Adw.PreferencesWindow();
    await prefs.fillPreferencesWindow(win);
    win.present();
    await settle();

    const global = () => settings.get_value('global-rounded-corner-settings').recursiveUnpack();
    const custom = () => settings.get_value('custom-rounded-corner-settings').recursiveUnpack();

    // Blacklist: deleting a row removes exactly its window class.
    const [blacklist] = findAll(win, 'PrefsBlacklist');
    const rowB = findAll(blacklist, 'AppRow').find(row => row.subtitle === 'b');
    rowB.onDelete();
    check(
        JSON.stringify(settings.get_strv('blacklist')) === '["a","c"]',
        `Deleting b left ${settings.get_strv('blacklist')}`,
    );

    // Custom settings: a new row starts from the global settings, and keeps
    // editing its window after a rename.
    const [customPage] = findAll(win, 'PrefsCustom');
    customPage.addWindow(null);
    const row = findAll(customPage, 'CustomSettingsRow').at(-1);
    row.onTitleChange({text: 'foo'});
    row.expanded = true;
    await settle();
    shot(row, 'custom-row');
    check(custom().foo?.borderRadius === global().borderRadius, 'New override copies the global settings');
    row.cornerRadius.value = 20;
    check(custom().foo.borderRadius === 20, 'Radius of foo saved');
    row.onTitleChange({text: 'bar'});
    row.cornerRadius.value = 25;
    check(!custom().foo && custom().bar?.borderRadius === 25, 'Renamed override keeps saving');

    // A second row cannot take a window class that is already used.
    customPage.addWindow(null);
    const second = findAll(customPage, 'CustomSettingsRow').at(-1);
    second.onTitleChange({text: 'bar'});
    check(second.subtitle === '' && custom().bar.borderRadius === 25, 'Duplicate refused');

    // General page: edits are saved, and a reset shows up on the page.
    const [general] = findAll(win, 'PrefsGeneral');
    shot(general._paddings, 'paddings');
    general._cornerRadius.value = 30;
    check(global().borderRadius === 30, 'Global radius saved');
    general.showResetPage();
    await settle();
    const [reset] = findAll(win, 'ResetPage');
    findAll(reset, 'AdwSwitchRow').find(r => r.name === 'borderRadius').active = true;
    reset.reset(null, 'reset');
    await settle();
    const defaultRadius = settings.get_default_value('global-rounded-corner-settings')
        .recursiveUnpack().borderRadius;
    check(global().borderRadius === defaultRadius, 'Reset restores the radius');
    check(general._cornerRadius.value === defaultRadius, 'General page shows the reset radius');
    general._cornerSmoothing.value = 0.5;
    check(global().borderRadius === defaultRadius, 'Next edit keeps the reset radius');

    // Shadow page: edits are saved while it is shown.
    general.showShadowPage();
    await settle();
    const [shadowPage] = findAll(win, 'EditShadowPage');
    shot(shadowPage, 'shadow-page');
    shadowPage._focusedOpacity.value = 10;
    check(settings.get_value('focused-shadow').recursiveUnpack().opacity === 10, 'Shadow saved');
    win.pop_subpage();
    await settle();

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
