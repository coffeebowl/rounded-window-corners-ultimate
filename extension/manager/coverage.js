/**
 * @file Decides which windows are hidden behind an opaque window that
 * covers their whole monitor, such as a game in fullscreen. Those windows
 * cannot be seen, so their effect is paused: Mutter then culls them again
 * and skips their offscreen copy (see meta-cullable.c).
 *
 * This module has no GNOME Shell imports, so it can be unit tested with
 * `gjs -m`. The caller describes the window stack.
 */

/**
 * One window in the stack, as far as coverage is concerned.
 *
 * @typedef {object} StackEntry
 * @property {object} key - Identifies the window in the result.
 * @property {boolean} visible - Whether the window is shown at all.
 * @property {number | null} insideMonitor - The monitor the window lies on
 *   completely, or null if it spans several monitors or none.
 * @property {number | null} coversMonitor - The monitor the window covers
 *   completely and opaquely, or null.
 */

/**
 * Find the windows that lie completely below an opaque window covering
 * their monitor.
 *
 * Windows above the covering window stay visible, as do windows that span
 * several monitors. Hidden windows neither cover nor count as covered.
 *
 * @param {StackEntry[]} stack - Windows from the top of the stack down.
 * @returns {Set<object>} Keys of the covered windows.
 */
export function findCovered(stack) {
    /** @type {Set<number>} */
    const coveredMonitors = new Set();
    /** @type {Set<object>} */
    const covered = new Set();

    for (const entry of stack) {
        if (!entry.visible) continue;

        if (
            entry.insideMonitor !== null &&
            coveredMonitors.has(entry.insideMonitor)
        ) {
            covered.add(entry.key);
        }

        if (entry.coversMonitor !== null) coveredMonitors.add(entry.coversMonitor);
    }

    return covered;
}
