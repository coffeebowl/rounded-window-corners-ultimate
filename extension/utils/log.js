/** @file Provides wrapper functions for printing out debug messages. */

import {getPref, prefs} from './settings.js';

/**
 * Log a message with a [RWC Ultimate] prefix, but only when debug mode is
 * enabled.
 *
 * Pass a function to build the message only when it is actually logged, so
 * hot paths do not build strings that are thrown away:
 * `logDebug(() => `Updating ${win.wmClass}`)`.
 *
 * @param {...unknown} args - Values to log, or a single function returning
 *   the message.
 */
export function logDebug(...args) {
    if (!prefs || !getPref('debug-mode')) return;

    const message =
        args.length === 1 && typeof args[0] === 'function' ? args[0]() : args;
    console.log(`[RWC Ultimate] ${message}`);
}

/**
 * Log an error with a [RWC Ultimate] prefix.
 *
 * @param {...unknown} args - Values to log.
 */
export function logError(...args) {
    console.error(`[RWC Ultimate] ${args}`);
}
