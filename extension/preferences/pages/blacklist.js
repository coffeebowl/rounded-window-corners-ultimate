/**
 * @file Contains the implementation of the blacklist page.
 * Handles creating blacklist entries and binding them to settings.
 */

import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {bindPref, getPrefCopy, setPref} from '../../utils/settings.js';
import {AppRow} from '../widgets/app_row.js';

export const BlacklistPage = GObject.registerClass(
    {
        Template: GLib.uri_resolve_relative(
            import.meta.url,
            'blacklist.ui',
            GLib.UriFlags.NONE,
        ),
        GTypeName: 'PrefsBlacklist',
        InternalChildren: ['blacklistGroup', 'useWhitelist'],
    },
    class extends Adw.PreferencesPage {
        #blacklist = getPrefCopy('blacklist');

        constructor() {
            super();

            bindPref('whitelist', this._useWhitelist, 'active');

            for (const title of this.#blacklist) {
                this.addWindow(undefined, title);
            }

            // update page title dynamically
            this._useWhitelist.connect('notify::active', () => {
                this.#updateBlacklistPageTitle();
            });
            this.#updateBlacklistPageTitle();
        }

        /**
         * Dynamically update the title of the blacklist page
         * based on the state of the whitelist switch.
         */
        #updateBlacklistPageTitle() {
            const isWhitelist = this._useWhitelist.get_active();
            const newTitle = isWhitelist
                ? _('Whitelist') // Title when switch is ON
                : _('Blacklist'); // Title when switch is OFF

            this.set_title(newTitle); // changes page Title
            this._blacklistGroup.set_title(newTitle); // changes group Title
        }

        /**
         * Add a new blacklist entry.
         * @param {string} wmClass - The WM_CLASS of the window.
         */
        addWindow(_, wmClass) {
            const row = new AppRow({
                onDelete: row => this.#deleteWindow(row),
                onWindowChange: (_, oldWmClass, newWmClass) =>
                    this.#changeWindow(oldWmClass, newWmClass),
            });
            row.set_subtitle(wmClass ?? '');
            this._blacklistGroup.add(row);
        }

        /**
         * Delete a blacklist entry.
         * @param {import('../widgets/app_row.js').AppRowClass} row - The row to delete.
         */
        #deleteWindow(row) {
            // The window class is the subtitle; the title is a hint text.
            const index = this.#blacklist.indexOf(row.subtitle);
            if (index >= 0) {
                this.#blacklist.splice(index, 1);
                setPref('blacklist', this.#blacklist);
            }
            this._blacklistGroup.remove(row);
        }

        /**
         * Change the blacklist entry to a different window.
         * @param {string} oldWmClass - Current WM_CLASS of the entry.
         * @param {string} newWmClass - New WM_CLASS of the entry.
         * @returns {boolean} False if the window is already in the list.
         */
        #changeWindow(oldWmClass, newWmClass) {
            if (this.#blacklist.includes(newWmClass)) return false;

            if (oldWmClass === '') {
                // If the old WM_CLASS is empty, the entry was just created,
                // so we need to just add the new window to the blacklist.
                this.#blacklist.push(newWmClass);
            } else {
                // Otherwise, replace the old window with the new one.
                const oldId = this.#blacklist.indexOf(oldWmClass);
                this.#blacklist.splice(oldId, 1, newWmClass);
            }

            setPref('blacklist', this.#blacklist);

            return true;
        }
    },
);
