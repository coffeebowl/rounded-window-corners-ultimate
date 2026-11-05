/** @file Contains the implementation of the preferences page. */

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {prefsTabs} from './preferences/index.js';
import {logDebug} from './utils/log.js';
import {initPrefs, uninitPrefs} from './utils/settings.js';

export default class RoundedWindowCornersUltimatePrefs extends ExtensionPreferences {
    // ExtensionPreferences requires this to be async.
    async fillPreferencesWindow(win) {
        initPrefs(this.getSettings());

        for (const page of prefsTabs) {
            win.add(new page());
        }

        // Disconnect all signals when closing the preferences
        win.connect('close-request', () => {
            logDebug('Disconnect Signals');
            uninitPrefs();
        });
    }
}
