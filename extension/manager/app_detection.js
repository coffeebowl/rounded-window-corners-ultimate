/**
 * @file Finds out what an app is built with, by the libraries its process
 * has mapped.
 *
 * This module has no GNOME Shell imports, so it can be unit tested with
 * `gjs -m`.
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {findInFile} from '../utils/file.js';
import {logDebug, logError} from '../utils/log.js';

/**
 * @typedef {object} AppInfo
 * @property {boolean} libadwaita - Whether the app uses libadwaita, which
 *   draws corners, line and shadow itself.
 * @property {boolean} chromium - Whether the app is Chromium or Electron.
 */

/** Markers in /proc/<pid>/maps and what they mean. */
const MAPS_MARKERS = new Map([
    ['libadwaita-1.so', Object.freeze({libadwaita: true, chromium: false})],
    [
        '/dev/shm/.org.chromium.Chromium',
        Object.freeze({libadwaita: false, chromium: true}),
    ],
]);

/** @type {AppInfo} */
export const OTHER_APP = Object.freeze({libadwaita: false, chromium: false});

/**
 * Detection results per process, shared by all windows of the process.
 *
 * @type {Map<number, {promise: Promise<AppInfo>, users: number}>}
 */
const appsByPid = new Map();

/**
 * Find out what an app is built with. Windows of the same process share one
 * read of /proc/<pid>/maps, which stops at the first marker. Call
 * {@link releaseApp} with the same PID when the window goes away.
 *
 * Errors for processes that cannot be read (other users, sandboxes) or that
 * already exited are expected and only logged in debug mode.
 *
 * @param {number} pid - The process ID, greater than 0.
 * @param {string | null} name - Name of the window, for logging.
 * @returns {Promise<AppInfo>}
 */
export function detectApp(pid, name) {
    let entry = appsByPid.get(pid);
    if (!entry) {
        entry = {promise: readAppInfo(pid, name), users: 0};
        appsByPid.set(pid, entry);
    }
    entry.users++;
    return entry.promise;
}

/**
 * Drop a window's claim on the detection result of its process. The result
 * is forgotten when the last window of the process is gone, since the PID
 * can be reused.
 *
 * @param {number} pid - The PID passed to {@link detectApp}.
 */
export function releaseApp(pid) {
    const entry = appsByPid.get(pid);
    if (entry && --entry.users <= 0) appsByPid.delete(pid);
}

/**
 * Read /proc/<pid>/maps once and look for the toolkit markers.
 *
 * @param {number} pid - The process ID.
 * @param {string | null} name - Name of a window of the process, for logging.
 * @returns {Promise<AppInfo>}
 */
async function readAppInfo(pid, name) {
    let marker;
    try {
        marker = await findInFile(`/proc/${pid}/maps`, [...MAPS_MARKERS.keys()]);
    } catch (e) {
        if (
            e instanceof GLib.Error &&
            (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.PERMISSION_DENIED) ||
                e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
        ) {
            logDebug(() => `Cannot read /proc maps for ${name}`);
        } else {
            logError(e);
        }
        return OTHER_APP;
    }

    const app = (marker && MAPS_MARKERS.get(marker)) || OTHER_APP;
    logDebug(() => `${name}: libadwaita: ${app.libadwaita}, chromium: ${app.chromium}`);
    return app;
}
