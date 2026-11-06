// Monitor settings for the smoke tests, through Mutter's DisplayConfig
// D-Bus interface of the private headless session.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

/**
 * @param {string} method
 * @param {GLib.Variant | null} params
 * @returns {Promise<GLib.Variant>}
 */
function callDisplayConfig(method, params) {
    return new Promise((resolve, reject) => {
        Gio.DBus.session.call(
            'org.gnome.Mutter.DisplayConfig',
            '/org/gnome/Mutter/DisplayConfig',
            'org.gnome.Mutter.DisplayConfig',
            method,
            params,
            null,
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            (connection, result) => {
                try {
                    resolve(connection.call_finish(result));
                } catch (e) {
                    reject(e);
                }
            },
        );
    });
}

/**
 * Switch the monitor to a scale, if its mode supports it.
 *
 * @param {number} wanted
 * @returns {Promise<boolean>} Whether the scale is supported.
 */
export async function setScale(wanted) {
    const state = await callDisplayConfig('GetCurrentState', null);
    const [serial, monitors] = state.deepUnpack();
    const [[connector], [mode]] = monitors[0];
    const [modeId, , , , , scales] = mode;
    const scale = scales.find(s => Math.abs(s - wanted) < 0.01);
    if (!scale) return false;

    await callDisplayConfig(
        'ApplyMonitorsConfig',
        new GLib.Variant('(uua(iiduba(ssa{sv}))a{sv})', [
            serial,
            1, // temporary
            [[0, 0, scale, 0, true, [[connector, modeId, {}]]]],
            {},
        ]),
    );
    return true;
}

