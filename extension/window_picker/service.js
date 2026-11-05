/**
 * @file This file contains the implementation of the DBus interface for the
 * window picker. See the {@link WindowPicker} class for more information.
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';

import {Inspector} from 'resource:///org/gnome/shell/ui/lookingGlass.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {readRelativeFile} from '../utils/file.js';
import {logDebug} from '../utils/log.js';
import {NO_WINDOW, OBJECT_PATH} from './names.js';

const iface = await readRelativeFile(import.meta.url, 'iface.xml');

/**
 * This class provides the implementation of the DBus interface for the window
 * picker. It implements a single method - `pick` - which opens the window picker
 * and allows the user to select a window.
 */
export class WindowPicker {
    #dbus = Gio.DBusExportedObject.wrapJSObject(iface, this);

    /**
     * Emit the wm_class of the picked window to the `picked` signal.
     *
     * @param {string} wmClass - The wm_class of the picked window.
     */
    #sendPickedWindow(wmClass) {
        this.#dbus.emit_signal('picked', new GLib.Variant('(s)', [wmClass]));
    }

    /**
     * Open the window picker and select a window.
     *
     * This uses the window picker from GNOME's Looking Glass. This is the
     * easiest way to pick a window, and this is also what's used by other
     * extensions such as Blur my Shell.
     */
    pick() {
        const lookingGlass = Main.createLookingGlass();
        const inspector = new Inspector(lookingGlass);

        inspector.connect('target', (me, target, x, y) => {
            logDebug(`${me}: pick ${target} in ${x}, ${y}`);

            // The inspector marks the actor under the pointer with a red
            // border, which stays unless the looking glass removes it.
            lookingGlass.setBorderPaintTarget(null);

            // The picked actor is usually a surface somewhere inside the
            // window actor, for example a subsurface.
            let actor = target;
            while (actor && !(actor instanceof Meta.WindowActor))
                actor = actor.get_parent();

            this.#sendPickedWindow(actor?.metaWindow?.wmClass ?? NO_WINDOW);
        });

        inspector.connect('closed', () => {
            lookingGlass.close();
        });
    }

    export() {
        this.#dbus.export(Gio.DBus.session, OBJECT_PATH);
        logDebug('DBus Service exported');
    }

    unexport() {
        this.#dbus.unexport();
    }
}
