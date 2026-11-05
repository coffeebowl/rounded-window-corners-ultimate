/**
 * @file Contains the implementation of the custom overrides page.
 * Handles creating override rows and binding them to settings for the corresponding
 * window.
 */

import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

import {getPrefCopy, setPref} from '../../utils/settings.js';
import {bindCornerSettings} from '../corner_settings.js';
import {CustomSettingsRow} from '../widgets/custom_settings_row.js';

const CUSTOM_KEY = 'custom-rounded-corner-settings';

export const CustomPage = GObject.registerClass(
    {
        Template: GLib.uri_resolve_relative(
            import.meta.url,
            'custom.ui',
            GLib.UriFlags.NONE,
        ),
        GTypeName: 'PrefsCustom',
        InternalChildren: ['customGroup'],
    },
    class extends Adw.PreferencesPage {
        #customWindowSettings = getPrefCopy(CUSTOM_KEY);

        constructor() {
            super();

            for (const wmClass in this.#customWindowSettings) {
                this.addWindow(undefined, wmClass);
            }
        }

        /**
         * Add a new custom settings row for a window.
         * @param {unknown} _ - The button, when called from the UI.
         * @param {string} [wmClass] - The WM_CLASS of the window.
         */
        addWindow(_, wmClass) {
            const row = new CustomSettingsRow({
                onDelete: row => this.#deleteWindowConfig(row),
                onWindowChange: (_row, oldWmClass, newWmClass) =>
                    this.#changeWindow(oldWmClass, newWmClass),
            });
            row.set_subtitle(wmClass ?? '');

            // The row edits the settings of whatever window it shows, so
            // renaming it needs no new connections.
            const load = bindCornerSettings(
                {
                    borderColor: row.borderColorButton,
                    cornerRadius: row.cornerRadius,
                    cornerSmoothing: row.cornerSmoothing,
                    keepForMaximized: row.keepForMaximized,
                    keepForFullscreen: row.keepForFullscreen,
                    paddings: row.paddings,
                    enabled: row.enabledRow,
                },
                () => this.#customWindowSettings[row.subtitle],
                () => this.#save(),
            );
            row.connect('notify::subtitle', load);

            this._customGroup.add(row);
        }

        /**
         * Delete custom overrides for a window.
         * @param {import('../widgets/app_row.js').AppRowClass} row - The row to delete.
         */
        #deleteWindowConfig(row) {
            delete this.#customWindowSettings[row.subtitle];
            this.#save();
            this._customGroup.remove(row);
        }

        /**
         * Change the window that the override is applied to.
         * @param {string} oldWmClass - Current WM_CLASS of the override.
         * @param {string} newWmClass - New WM_CLASS of the override.
         * @returns {boolean} False if the window already has overrides.
         */
        #changeWindow(oldWmClass, newWmClass) {
            if (this.#customWindowSettings[newWmClass] !== undefined) {
                return false;
            }

            if (oldWmClass === '') {
                // The override was just created, so start with the values
                // from the global settings.
                this.#customWindowSettings[newWmClass] = getPrefCopy(
                    'global-rounded-corner-settings',
                );
            } else {
                // Otherwise, move the override to the new window.
                this.#customWindowSettings[newWmClass] =
                    this.#customWindowSettings[oldWmClass];
                delete this.#customWindowSettings[oldWmClass];
            }

            this.#save();
            return true;
        }

        #save() {
            setPref(CUSTOM_KEY, this.#customWindowSettings);
        }
    },
);
