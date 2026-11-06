/** @file Provides wrapper functions for printing out debug messages. */

import {debugMode} from './settings.js';

/**
 * Log a message with a [RWC Ultimate] prefix, but only when debug mode is
 * enabled.
 *
 * Pass a function to build the message only when it is actually logged, so
 * hot paths do not build strings that are thrown away:
 * `logDebug(() => `Updating ${win.wmClass}`)`.
 *
 * @param {string | (() => string)} message - The message, or a function
 *   returning it.
 */
export function logDebug(message) {
    if (!debugMode()) return;

    const text = typeof message === 'function' ? message() : message;
    console.log(`[RWC Ultimate] ${text}`);
}

/**
 * Log an error with a [RWC Ultimate] prefix. Error objects are passed on
 * as they are, so the log keeps their stack trace.
 *
 * @param {...unknown} args - Values to log.
 */
export function logError(...args) {
    console.error('[RWC Ultimate]', ...args);
}
