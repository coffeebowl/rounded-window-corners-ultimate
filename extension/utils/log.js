/** @file Provides wrapper functions for printing out debug messages. */

import {getPref} from './settings.js';

/**
 * Log a message with a [RWC Ultimate] prefix, but only
 * when debug mode is enabled.
 *
 * @param {...unknown} args - Values to log.
 */
export function logDebug(...args) {
    if (getPref('debug-mode')) {
        console.log(`[RWC Ultimate] ${args}`);
    }
}

/**
 * Log an error with a [RWC Ultimate] prefix.
 *
 * @param {...unknown} args - Values to log.
 */
export function logError(...args) {
    console.error(`[RWC Ultimate] ${args}`);
}
