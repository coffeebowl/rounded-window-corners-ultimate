/**
 * @file Generic widget for choosing a window via a picker or a text entry.
 * Used in the blacklist and custom settings pages.
 */

import Adw from 'gi://Adw';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {onPicked, pick} from '../../window_picker/client.js';
import {NO_WINDOW} from '../../window_picker/names.js';

export class AppRowClass extends Adw.ExpanderRow {
    #callbacks;

    #removeButton = new Gtk.Button({
        icon_name: 'window-close-symbolic',
        css_classes: ['flat', 'circular'],
        valign: Gtk.Align.CENTER,
    });
    #applyButton = new Gtk.Button({
        icon_name: 'object-select-symbolic',
        css_classes: ['flat', 'circular'],
        valign: Gtk.Align.CENTER,
    });
    #pickButton = new Gtk.Button({
        icon_name: 'find-location-symbolic',
        css_classes: ['flat', 'circular'],
        valign: Gtk.Align.CENTER,
    });

    #wmClassEntry = new Adw.EntryRow({
        title: _('Window class'),
    });

    constructor(cb) {
        super();

        this.#callbacks = cb;

        this.#wmClassEntry.add_prefix(this.#applyButton);
        this.#wmClassEntry.add_prefix(this.#pickButton);
        this.add_row(this.#wmClassEntry);
        this.add_suffix(this.#removeButton);

        this.bind_property(
            'subtitle',
            this.#wmClassEntry,
            'text',
            GObject.BindingFlags.DEFAULT,
        );

        this.add_css_class('property');
        this.set_title(_('Expand this row, to pick a window'));

        this.#removeButton.connect('clicked', () => {
            this.onDelete();
        });
        this.#pickButton.connect('clicked', () => {
            this.pickWindow(this.#wmClassEntry);
        });
        this.#applyButton.connect('clicked', () => {
            this.onTitleChange(this.#wmClassEntry);
        });
    }

    /**
     * Apply the window class from the entry. The callback refuses classes
     * that are already in the list.
     *
     * @param {Adw.EntryRow} entry - The entry with the new window class.
     */
    onTitleChange(entry) {
        const wmClass = entry.text;
        if (wmClass === '' || wmClass === this.subtitle) return;

        if (!this.#callbacks.onWindowChange(this, this.subtitle, wmClass)) {
            // Translators: %s is a window class.
            this.#toast(_('%s is already in the list').replace('%s', wmClass));
            return;
        }
        this.set_subtitle(wmClass);
    }

    onDelete() {
        this.#callbacks.onDelete(this);
    }

    pickWindow(entry) {
        onPicked(wmInstanceClass => {
            if (wmInstanceClass === NO_WINDOW) {
                this.#toast(_("Can't pick window from this position"));
                return;
            }
            entry.text = wmInstanceClass;
        });
        pick();
    }

    /** @param {string} title - Message to show at the bottom of the window. */
    #toast(title) {
        this.root.add_toast(new Adw.Toast({title}));
    }
}

export const AppRow = GObject.registerClass(
    {
        GTypeName: 'AppRow',
    },
    AppRowClass,
);
