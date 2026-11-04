/**
 * @file Per-window state and the update queue.
 *
 * Signal handlers never touch effects directly. They mark what changed in
 * the window's {@link WindowState} and queue one update, which runs before
 * the next frame is laid out and painted. This bundles bursts of signals
 * (a resize emits several) into one update per frame and makes sure effects
 * are never added or removed in the middle of a paint.
 *
 * This module has no GNOME Shell imports, so it can be unit tested with
 * `gjs -m`. The scheduler and the update function are passed in by
 * {@link startUpdates}.
 */

/** The window's size or position changed. */
export const GEOMETRY = 1;
/** The window gained or lost focus, or moved to another workspace. */
export const FOCUS = 2;
/** Something changed that decides whether the window has the effect. */
export const STATE = 4;
/** The extension settings changed. */
export const SETTINGS = 8;

/**
 * Everything the extension keeps for one window.
 *
 * @typedef {object} WindowState
 * @property {import('gi://Meta').default.WindowActor} actor - The window actor.
 * @property {import('gi://Meta').default.Window} win - Its window.
 * @property {import('../effect/rounded_corners_effect.js').RoundedCornersEffect['prototype'] | null} effect -
 *   The rounded corners effect, if the window has it.
 * @property {import('gi://Clutter').default.Actor | null} effectActor -
 *   The actor the effect was added to (the surface actor for X11 windows).
 * @property {import('gi://St').default.Bin | null} shadow - The shadow actor.
 * @property {import('gi://GObject').default.Binding[]} bindings -
 *   Property bindings from the window actor to the shadow.
 * @property {import('gi://GObject').default.Object | null} texture -
 *   The texture whose `size-changed` signal is connected.
 * @property {Set<import('gi://GObject').default.Object>} emitters -
 *   Objects with signals connected for this window, to disconnect them.
 * @property {{type: 'LibHandy' | 'LibAdwaita' | 'Other', chromium: boolean} | null} app -
 *   What the app is built with, once known.
 * @property {boolean} detecting - Whether the app detection is running.
 * @property {number} unminimizeTimeoutId - Pending Chromium refresh.
 * @property {number} dirty - Bitmask of pending changes.
 * @property {number} laterId - ID of the queued update, or 0.
 * @property {boolean} destroyed - Set once the window is gone.
 * @property {number} flushes - How many updates ran, for debugging and tests.
 */

/**
 * All tracked windows by their actor.
 *
 * @type {Map<object, WindowState>}
 */
export const states = new Map();

/**
 * @typedef {object} Updater
 * @property {(fn: () => boolean) => number} add - Schedule `fn` before the
 *   next frame, return an ID. `fn` returns whether to run again.
 * @property {(id: number) => void} remove - Cancel a scheduled function.
 * @property {(state: WindowState, bits: number) => void} flush - Apply the
 *   pending changes of a window.
 */

/** @type {Updater | null} */
let updater = null;

/**
 * Counts enable/disable cycles. Async work remembers the value it started
 * with, so results that arrive after a disable are thrown away.
 */
let generation = 0;

/**
 * Start processing updates.
 *
 * @param {Updater} newUpdater - Scheduler and update function to use.
 */
export function startUpdates(newUpdater) {
    updater = newUpdater;
    generation++;
}

/**
 * Stop processing updates and cancel all queued ones. The caller tears
 * down the windows themselves.
 */
export function stopUpdates() {
    for (const state of states.values()) cancelUpdate(state);
    updater = null;
    generation++;
}

/**
 * Create and register the state for a window.
 *
 * @param {import('gi://Meta').default.WindowActor} actor
 * @param {import('gi://Meta').default.Window} win
 * @returns {WindowState}
 */
export function createState(actor, win) {
    /** @type {WindowState} */
    const state = {
        actor,
        win,
        effect: null,
        effectActor: null,
        shadow: null,
        bindings: [],
        texture: null,
        emitters: new Set(),
        app: null,
        detecting: false,
        unminimizeTimeoutId: 0,
        dirty: 0,
        laterId: 0,
        destroyed: false,
        flushes: 0,
    };
    states.set(actor, state);
    return state;
}

/**
 * Mark a window as destroyed, cancel its queued update and forget it.
 *
 * @param {WindowState} state
 */
export function dropState(state) {
    state.destroyed = true;
    cancelUpdate(state);
    states.delete(state.actor);
}

/**
 * Record a change and queue one update for the window, unless one is
 * already queued.
 *
 * @param {WindowState} state
 * @param {number} bits - What changed, see {@link GEOMETRY} and friends.
 */
export function queueUpdate(state, bits) {
    state.dirty |= bits;
    if (state.laterId || state.destroyed || !updater) return;

    const current = updater;
    state.laterId = current.add(() => {
        state.laterId = 0;
        if (state.destroyed || updater !== current) return false;

        const dirty = state.dirty;
        state.dirty = 0;
        state.flushes++;
        current.flush(state, dirty);
        return false;
    });
}

/**
 * Queue an update for every window.
 *
 * @param {number} bits - What changed.
 */
export function queueUpdateAll(bits) {
    for (const state of states.values()) queueUpdate(state, bits);
}

/**
 * Cancel the queued update of a window, keeping its dirty bits.
 *
 * @param {WindowState} state
 */
function cancelUpdate(state) {
    if (state.laterId) updater?.remove(state.laterId);
    state.laterId = 0;
}

/**
 * Wait for async work and hand its result to `callback`, but only if the
 * window still exists and the extension was not disabled in the meantime.
 *
 * @template T
 * @param {WindowState} state - The window the work is for.
 * @param {Promise<T>} promise - The async work.
 * @param {(value: T) => void} callback - Runs with the result.
 * @returns {Promise<void>}
 */
export async function whenAlive(state, promise, callback) {
    const startedIn = generation;
    const value = await promise;
    if (state.destroyed || startedIn !== generation) return;
    callback(value);
}
