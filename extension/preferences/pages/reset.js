/**
 * @file Contains the implementation of the reset page.
 * The prefs that can be reset are listed in `#resetLabels`, and the UI is
 * generated from that.
 */

import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {
    getPrefCopy,
    prefs,
    Schema,
    setPref,
} from '../../utils/settings.js';

const GLOBAL_KEY = 'global-rounded-corner-settings';

export const ResetPage = GObject.registerClass(
    {
        Template: GLib.uri_resolve_relative(
            import.meta.url,
            'reset.ui',
            GLib.UriFlags.NONE,
        ),
        GTypeName: 'ResetPage',
        InternalChildren: ['resetGroup', 'resetButton', 'dialog'],
    },
    class extends Adw.NavigationPage {
        // Store all switches in a list to enable the "select all" button.
        #rows = [];

        // Settings keys, and keys inside of `global-rounded-corner-settings`,
        // with their labels in the UI.
        #resetLabels = {
            'skip-libadwaita-app': _('Skip LibAdwaita Applications'),
            'skip-libhandy-app': _('Skip LibHandy Applications'),
            'focused-shadow': _('Focus Window Shadow Style'),
            'unfocused-shadow': _('Unfocus Window Shadow Style'),
            'keep-shadow-for-maximized-fullscreen': _(
                'Keep Window Shadows when Maximized or Fullscreen',
            ),
            'border-width': _('Border Width'),
            'debug-mode': _('Enable Log'),

            borderRadius: _('Border Radius'),
            borderColor: _('Border Color'),
            padding: _('Padding'),
            keepRoundedCorners: _(
                'Keep Rounded Corners when Maximized or Fullscreen',
            ),
            smoothing: _('Corner Smoothing'),
        };

        constructor() {
            super();

            this.#buildUi();
        }

        selectAll() {
            for (const row of this.#rows) {
                row.set_active(true);
            }
        }

        askForReset() {
            this._dialog.choose(this, null, null);
        }

        reset(_, response) {
            if (response === 'cancel') {
                return;
            }

            const defaults = prefs
                .get_default_value(GLOBAL_KEY)
                .recursiveUnpack();
            const current = getPrefCopy(GLOBAL_KEY);
            let globalChanged = false;

            for (const row of this.#rows) {
                if (!row.active) continue;
                if (row.name in Schema) {
                    // A top-level key, reset it directly.
                    prefs.reset(row.name);
                } else {
                    // A key inside of `global-rounded-corner-settings`.
                    current[row.name] = defaults[row.name];
                    globalChanged = true;
                }
            }

            if (globalChanged) setPref(GLOBAL_KEY, current);

            this.root.pop_subpage();
        }

        /** Generate the UI from {@link #resetLabels}. */
        #buildUi() {
            for (const [key, title] of Object.entries(this.#resetLabels)) {
                const row = new Adw.SwitchRow({active: false, name: key, title});
                this._resetGroup.add(row);
                this.#rows.push(row);
            }
        }
    },
);
