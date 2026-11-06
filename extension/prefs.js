/**
 * @file The preferences window: one page with the focus border, the only
 * setting. Corners, outline and shadow follow libadwaita and are fixed.
 */

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {
    ExtensionPreferences,
    gettext as _,
} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

/**
 * A spin row for an integer key, limited to the key's range.
 *
 * @param {Gio.Settings} settings
 * @param {string} key
 * @param {string} title
 * @param {string} subtitle
 * @returns {Adw.SpinRow}
 */
function intRow(settings, key, title, subtitle) {
    const [, range] = settings.settingsSchema
        .get_key(key)
        .get_range()
        .recursiveUnpack();
    const [lower, upper] = range;
    const row = new Adw.SpinRow({
        title,
        subtitle,
        adjustment: new Gtk.Adjustment({
            lower,
            upper,
            step_increment: 1,
            page_increment: 1,
        }),
    });
    settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

/**
 * A group for one feature, switched on and off from its header. Its rows
 * are greyed out while the feature is off.
 *
 * @param {Gio.Settings} settings
 * @param {string} enabledKey
 * @param {string} title
 * @param {string} description
 * @param {Adw.PreferencesRow[]} rows
 * @returns {Adw.PreferencesGroup}
 */
function featureGroup(settings, enabledKey, title, description, rows) {
    const group = new Adw.PreferencesGroup({title, description});
    const toggle = new Gtk.Switch({valign: Gtk.Align.CENTER});
    settings.bind(enabledKey, toggle, 'active', Gio.SettingsBindFlags.DEFAULT);
    group.set_header_suffix(toggle);
    for (const row of rows) {
        settings.bind(enabledKey, row, 'sensitive', Gio.SettingsBindFlags.GET);
        group.add(row);
    }
    return group;
}

export default class RoundedWindowCornersUltimatePrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        // Keep the settings alive as long as the window, for the bindings.
        window._settings = settings;
        // Nothing to search on a single page.
        window.search_enabled = false;

        const page = new Adw.PreferencesPage({
            title: _('General'),
            icon_name: 'preferences-system-symbolic',
            description: _('Windows get the corners, outline and shadow of libadwaita windows. libadwaita apps draw them themselves and are left as they are.'),
        });

        const defaultWidth = settings.get_default_value('focus-border-width').unpack();
        page.add(featureGroup(settings, 'focus-border', _('Focus border'),
            _('Marks the focused window with a border in the accent color of the system. It lies inside the window edge in place of the outline. Off by default.'), [
                intRow(settings, 'focus-border-width', _('Width'),
                    // Translators: %d is the default width in pixels.
                    _('In pixels. Default: %d.').replace('%d', defaultWidth)),
            ]));
        window.add(page);
    }
}
