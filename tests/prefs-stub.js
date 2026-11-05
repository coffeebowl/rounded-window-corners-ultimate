// Stands in for resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js
// in tests/prefs-client.js. The real module needs the whole extensions app.

import Gio from 'gi://Gio';

export class ExtensionPreferences {
    constructor(metadata) {
        this.metadata = metadata;
        this.path = metadata.path;
    }

    getSettings() {
        const source = Gio.SettingsSchemaSource.new_from_directory(
            `${this.path}/schemas`,
            Gio.SettingsSchemaSource.get_default(),
            false,
        );
        const schema = source.lookup(this.metadata['settings-schema'], false);
        return new Gio.Settings({settingsSchema: schema});
    }
}

export const gettext = text => text;
