/**
 * @file This file provides wrapper functions around the DBus window picker
 * interface.
 */

import Gio from 'gi://Gio';

import {BUS_NAME, INTERFACE_NAME, OBJECT_PATH} from './names.js';

const connection = Gio.DBus.session;

/** Open the window picker and select a window. */
export function pick() {
    connection.call(
        BUS_NAME,
        OBJECT_PATH,
        INTERFACE_NAME,
        'pick',
        null,
        null,
        Gio.DBusCallFlags.NO_AUTO_START,
        -1,
        null,
        null,
    );
}

/**
 * Connect a callback to the `picked` signal, which is emitted when a window
 * is picked.
 *
 * @param {(wmClass: string) => void} callback - The function to execute when the window is picked.
 */
export function onPicked(callback) {
    const id = connection.signal_subscribe(
        BUS_NAME,
        INTERFACE_NAME,
        'picked',
        OBJECT_PATH,
        null,
        Gio.DBusSignalFlags.NONE,
        (_conn, _sender, _objectPath, _iface, _signal, params) => {
            const val = params.get_child_value(0);
            callback(val.get_string()[0]);
            connection.signal_unsubscribe(id);
        },
    );
}
