/**
 * @file Contains the code for the shadow settings page.
 * It implements the dynamic preview widget that uses a GTK CSS provider to
 * show what the shadow will look like.
 */

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import {boxShadowCss} from '../../utils/box_shadow.js';
import {getPref, setPref} from '../../utils/settings.js';

/**
 * Shadow properties and the name parts of their adjustments in the UI, for
 * example `_focusedBlurRadius` for `blurOffset` of the focused shadow.
 */
const FIELDS = {
    horizontalOffset: 'HorizontalOffset',
    verticalOffset: 'VerticalOffset',
    blurOffset: 'BlurRadius',
    spreadRadius: 'SpreadRadius',
    opacity: 'Opacity',
};

/** The shadows on this page: settings key and adjustment name prefix. */
const SHADOWS = [
    ['focused-shadow', 'focused'],
    ['unfocused-shadow', 'unfocused'],
];

export const EditShadowPage = GObject.registerClass(
    {
        Template: GLib.uri_resolve_relative(
            import.meta.url,
            'edit-shadow.ui',
            GLib.UriFlags.NONE,
        ),
        GTypeName: 'EditShadowPage',
        InternalChildren: [
            'focusedHorizontalOffset',
            'focusedVerticalOffset',
            'focusedBlurRadius',
            'focusedSpreadRadius',
            'focusedOpacity',

            'unfocusedHorizontalOffset',
            'unfocusedVerticalOffset',
            'unfocusedBlurRadius',
            'unfocusedSpreadRadius',
            'unfocusedOpacity',
        ],
    },
    class extends Adw.NavigationPage {
        /** Styles of the preview, added to the display while shown. */
        #css = new Gtk.CssProvider();

        #styleManager = Adw.StyleManager.get_default();
        #darkChangedId = 0;
        #wallpaper = '';

        #isInitialized = false;

        constructor() {
            super();

            for (const [key, prefix] of SHADOWS) {
                const shadow = getPref(key);
                for (const [field, name] of Object.entries(FIELDS))
                    this[`_${prefix}${name}`].value = shadow[field];
            }
            this.#isInitialized = true;
        }

        vfunc_map() {
            super.vfunc_map();
            Gtk.StyleContext.add_provider_for_display(
                this.get_display(),
                this.#css,
                Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION,
            );
            // The wallpaper can differ between light and dark.
            this.#darkChangedId = this.#styleManager.connect(
                'notify::dark',
                () => this.#refreshWallpaper(),
            );
            this.#refreshWallpaper();
        }

        vfunc_unmap() {
            this.#styleManager.disconnect(this.#darkChangedId);
            this.#darkChangedId = 0;
            Gtk.StyleContext.remove_provider_for_display(
                this.get_display(),
                this.#css,
            );
            super.vfunc_unmap();
        }

        onValueChanged() {
            if (!this.#isInitialized) return;

            for (const [key, prefix] of SHADOWS)
                setPref(key, this.#readShadow(prefix));
            this.#updateCss();
        }

        /**
         * Read a shadow from its adjustments.
         *
         * @param {string} prefix - `focused` or `unfocused`.
         * @returns {import('../../utils/types.js').BoxShadow}
         */
        #readShadow(prefix) {
            const shadow = {};
            for (const [field, name] of Object.entries(FIELDS))
                shadow[field] = this[`_${prefix}${name}`].value;
            return shadow;
        }

        /** Show the desktop wallpaper in the preview. */
        #refreshWallpaper() {
            const backgrounds = Gio.Settings.new('org.gnome.desktop.background');
            this.#wallpaper = backgrounds.get_string(
                this.#styleManager.dark ? 'picture-uri-dark' : 'picture-uri',
            );
            this.#updateCss();
        }

        /**
         * Style the previews with the shadows. Hovering a preview shows the
         * other shadow, to compare them.
         */
        #updateCss() {
            const focused = boxShadowCss(this.#readShadow('focused'));
            const unfocused = boxShadowCss(this.#readShadow('unfocused'));
            this.#css.load_from_string(`
                .rwc-desktop-background {
                    background: url("${this.#wallpaper}");
                    background-size: cover;
                }
                .rwc-focused-preview, .rwc-unfocused-preview {
                    border-radius: 15px;
                    transition: box-shadow 200ms;
                }
                .rwc-focused-preview, .rwc-unfocused-preview:hover {
                    ${focused};
                }
                .rwc-unfocused-preview, .rwc-focused-preview:hover {
                    ${unfocused};
                }
            `);
        }
    },
);
