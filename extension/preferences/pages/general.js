/**
 * @file Contains the implementation of the main preferences page.
 * There isn't much logic in this file.
 */

import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

import {
    bindPref,
    connectPref,
    getPrefCopy,
    setPref,
} from '../../utils/settings.js';
import {bindCornerSettings} from '../corner_settings.js';
import {EditShadowPage} from './edit_shadow.js';
import {ResetPage} from './reset.js';

const GLOBAL_KEY = 'global-rounded-corner-settings';

export const GeneralPage = GObject.registerClass(
    {
        Template: GLib.uri_resolve_relative(
            import.meta.url,
            'general.ui',
            GLib.UriFlags.NONE,
        ),
        GTypeName: 'PrefsGeneral',

        // Those variables are declared inside of the `general.ui` file and
        // passed into the JS module prefixed with an underscore.
        // (skipLibadwaita -> _skipLibadwaita)
        InternalChildren: [
            'skipLibadwaita',
            'skipLibhandy',
            'borderWidth',
            'borderColor',
            'cornerRadius',
            'cornerSmoothing',
            'keepShadowForMaximizedFullscreen',
            'keepForMaximized',
            'keepForFullscreen',
            'paddings',
            'tweakKitty',
            'enableDebugLogs',
        ],
    },
    class extends Adw.PreferencesPage {
        #settings = getPrefCopy(GLOBAL_KEY);

        constructor() {
            super();

            for (const [key, widget, property] of [
                ['skip-libadwaita-app', this._skipLibadwaita, 'active'],
                ['skip-libhandy-app', this._skipLibhandy, 'active'],
                ['border-width', this._borderWidth, 'value'],
                [
                    'keep-shadow-for-maximized-fullscreen',
                    this._keepShadowForMaximizedFullscreen,
                    'active',
                ],
                ['tweak-kitty-terminal', this._tweakKitty, 'active'],
                ['debug-mode', this._enableDebugLogs, 'active'],
            ])
                bindPref(key, widget, property);

            const load = bindCornerSettings(
                {
                    borderColor: this._borderColor,
                    cornerRadius: this._cornerRadius,
                    cornerSmoothing: this._cornerSmoothing,
                    keepForMaximized: this._keepForMaximized,
                    keepForFullscreen: this._keepForFullscreen,
                    paddings: this._paddings,
                },
                () => this.#settings,
                () => setPref(GLOBAL_KEY, this.#settings),
            );

            // The reset page changes the settings as well. Without this,
            // the next change here would write the old values back.
            connectPref(GLOBAL_KEY, () => {
                this.#settings = getPrefCopy(GLOBAL_KEY);
                load();
            });
        }

        showResetPage() {
            this.root.push_subpage(new ResetPage());
        }

        showShadowPage() {
            this.root.push_subpage(new EditShadowPage());
        }
    },
);
