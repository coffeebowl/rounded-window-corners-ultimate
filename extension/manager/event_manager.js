/**
 * @file Connects GNOME Shell signals to the update queue. See
 * {@link enableEffect} for more information.
 */

import Meta from 'gi://Meta';

import {logDebug, logError} from '../utils/log.js';
import {prefs} from '../utils/settings.js';
import * as handlers from './event_handlers.js';
import {
    FOCUS,
    GEOMETRY,
    SETTINGS,
    STATE,
    createState,
    dropState,
    queueUpdate,
    queueUpdateAll,
    startUpdates,
    states,
    stopUpdates,
} from './window_state.js';

/** Owner of the global signal connections, for disconnectObject. */
const owner = {};

/** Settings keys that only change how the shadow looks. */
const SHADOW_KEYS = new Set([
    'focused-shadow',
    'unfocused-shadow',
    'keep-shadow-for-maximized-fullscreen',
]);

/**
 * The rounded corners effect has to react when different events happen.
 * For example, when a new window is opened, the effect has to detect it and
 * add rounded corners to it.
 *
 * Signal handlers only record what changed. The actual work happens in
 * {@link handlers.flush}, at most once per frame and window, before the
 * frame is laid out and painted.
 */
export function enableEffect() {
    const laters = global.compositor.get_laters();
    startUpdates({
        add: fn => laters.add(Meta.LaterType.BEFORE_REDRAW, fn),
        remove: id => laters.remove(id),
        flush: (state, bits) => {
            try {
                handlers.flush(state, bits);
            } catch (e) {
                logError(e);
            }
        },
    });

    // Update the effect when settings are changed.
    prefs.connectObject('changed', (_, key) => onSettingsChanged(key), owner);

    // Add the effect to all windows when the extension is enabled.
    const windowActors = global.get_window_actors();
    logDebug(() => `Initial window count: ${windowActors.length}`);
    for (const actor of windowActors) track(actor);

    global.display.connectObject(
        // Add the effect to new windows when they are opened.
        'window-created',
        (_, win) => track(win.get_compositor_private()),
        // When windows are restacked, the order of shadow actors as well.
        'restacked',
        () => handlers.onRestacked(),
        owner,
    );

    global.windowManager.connectObject(
        'minimize',
        (_, actor) => withState(actor, handlers.onMinimize),
        'unminimize',
        (_, actor) => withState(actor, handlers.onUnminimize),
        // The close animation starts, remove the effect from the window.
        'destroy',
        (_, actor) => withState(actor, untrack),
        owner,
    );
}

/** Disable the effect for all windows. */
export function disableEffect() {
    for (const state of [...states.values()]) untrack(state);

    prefs?.disconnectObject(owner);
    global.display.disconnectObject(owner);
    global.windowManager.disconnectObject(owner);

    stopUpdates();
}

/**
 * Start tracking a window and queue its first update.
 *
 * @param {Meta.WindowActor | null} actor - The window actor.
 */
function track(actor) {
    const win = actor?.metaWindow;
    if (!win || states.has(actor)) return;

    const state = createState(actor, win);

    actor.connectObject(
        'destroy',
        () => untrack(state),
        // A resize emits this, the texture's size-changed is connected
        // in the update. Both end up in one update per frame.
        'notify::size',
        () => queueUpdate(state, GEOMETRY),
        // XWayland surfaces can arrive after the window.
        'notify::first-child',
        () => queueUpdate(state, STATE),
        state,
    );
    win.connectObject(
        'notify::wm-class',
        () => queueUpdate(state, STATE),
        // A window does not have to change its size to go fullscreen.
        'notify::fullscreen',
        () => queueUpdate(state, STATE),
        'notify::appears-focused',
        () => queueUpdate(state, FOCUS),
        'workspace-changed',
        () => queueUpdate(state, FOCUS),
        state,
    );
    state.emitters.add(actor);
    state.emitters.add(win);

    queueUpdate(state, STATE);
}

/**
 * Stop tracking a window and remove everything the extension added to it.
 *
 * @param {import('./window_state.js').WindowState} state - The window.
 */
function untrack(state) {
    if (state.destroyed) return;
    dropState(state);
    handlers.teardown(state);
}

/**
 * Run a handler for a window actor, if the window is tracked.
 *
 * @param {Meta.WindowActor} actor - The window actor from the signal.
 * @param {(state: import('./window_state.js').WindowState) => void} handler
 */
function withState(actor, handler) {
    const state = states.get(actor);
    if (state) handler(state);
}

/**
 * Queue the updates that a settings change needs.
 *
 * @param {string} key - The settings key that changed.
 */
function onSettingsChanged(key) {
    if (key === 'debug-mode') return;
    queueUpdateAll(SHADOW_KEYS.has(key) ? FOCUS : SETTINGS);
}
