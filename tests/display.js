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
 * Set the scale of each monitor, if their modes support it. The monitors
 * are placed side by side in the order of the scales.
 *
 * @param {number[]} wanted - One scale per monitor.
 * @param {number} [primary] - Index of the primary monitor.
 * @returns {Promise<boolean>} Whether all scales are supported.
 */
export async function setScales(wanted, primary = 0) {
    const state = await callDisplayConfig('GetCurrentState', null);
    const [serial, monitors] = state.deepUnpack();
    const logicalMonitors = [];
    let x = 0;
    for (const [i, scaleWanted] of wanted.entries()) {
        if (!monitors[i]) return false;
        const [[connector], [mode]] = monitors[i];
        const [modeId, width, , , , scales] = mode;
        const scale = scales.find(s => Math.abs(s - scaleWanted) < 0.01);
        if (!scale) return false;
        logicalMonitors.push([
            x,
            0,
            scale,
            0, // transform
            i === primary,
            [[connector, modeId, {}]],
        ]);
        x += Math.round(width / scale);
    }

    await callDisplayConfig(
        'ApplyMonitorsConfig',
        new GLib.Variant('(uua(iiduba(ssa{sv}))a{sv})', [
            serial,
            1, // temporary
            logicalMonitors,
            {},
        ]),
    );
    return true;
}

/**
 * Switch the monitor to a scale, if its mode supports it.
 *
 * @param {number} wanted
 * @returns {Promise<boolean>} Whether the scale is supported.
 */
export function setScale(wanted) {
    return setScales([wanted]);
}
