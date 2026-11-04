/**
 * @file Connects GNOME Shell signals to the update queue. See
 * {@link enableEffect} for more information.
 */

import GLib from 'gi://GLib';
import Meta from 'gi://Meta';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {logDebug, logError} from '../utils/log.js';
import {clearShadowImages} from '../utils/shadow_files.js';
import {prefs} from '../utils/settings.js';
import {findCovered} from './coverage.js';
import * as handlers from './event_handlers.js';
import {coversMonitor, isOpaque, monitorContaining} from './utils.js';
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

/** @type {Meta.Laters | null} */
let laters = null;

/** ID of the queued coverage check, or 0. */
let coverageLaterId = 0;

/**
 * Reasons why pausing covered windows is off right now, for example while
 * the overview shows previews of all windows.
 *
 * @type {Set<string>}
 */
const coveragePausedBy = new Set();

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
    try {
        clearShadowImages();
    } catch (e) {
        logError(e);
    }

    laters = global.compositor.get_laters();
    startUpdates({
        add: fn => laters.add(Meta.LaterType.BEFORE_REDRAW, fn),
        remove: id => laters.remove(id),
        flush: (state, bits) => {
            try {
                handlers.flush(state, bits);
            } catch (e) {
                logError(e);
            }
            // A new buffer can change whether a window is opaque, for
            // example when a game switches to its fullscreen buffer. Pausing
            // may come one frame later this way, which cannot be seen;
            // resuming is triggered directly by the signals.
            if (bits & (GEOMETRY | STATE)) queueCoverage();
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
        () => {
            handlers.onRestacked();
            queueCoverage();
        },
        'in-fullscreen-changed',
        () => queueCoverage(),
        owner,
    );

    Main.layoutManager.connectObject(
        'monitors-changed',
        () => queueCoverage(),
        owner,
    );

    // The overview shows all windows, covered ones included.
    if (Main.overview.visible) coveragePausedBy.add('overview');
    Main.overview.connectObject(
        'showing',
        () => setCoverageAllowed('overview', false),
        'hidden',
        () => setCoverageAllowed('overview', true),
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
    if (coverageLaterId) laters?.remove(coverageLaterId);
    coverageLaterId = 0;
    coveragePausedBy.clear();

    for (const state of [...states.values()]) untrack(state);

    prefs?.disconnectObject(owner);
    global.display.disconnectObject(owner);
    global.windowManager.disconnectObject(owner);
    Main.layoutManager.disconnectObject(owner);
    Main.overview.disconnectObject(owner);

    stopUpdates();
    laters = null;
}

/**
 * Allow or forbid pausing covered windows, for example during a workspace
 * switch, which shows windows of two workspaces at once.
 *
 * @param {string} reason - Who asks, so several reasons can overlap.
 * @param {boolean} allowed - Whether pausing is allowed again.
 */
export function setCoverageAllowed(reason, allowed) {
    if (allowed) coveragePausedBy.delete(reason);
    else coveragePausedBy.add(reason);
    queueCoverage();
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
        () => {
            queueUpdate(state, GEOMETRY);
            queueCoverage();
        },
        // XWayland surfaces can arrive after the window.
        'notify::first-child',
        () => queueUpdate(state, STATE),
        'notify::visible',
        () => {
            handlers.syncShadowVisible(state);
            queueCoverage();
        },
        // Windows fade, scale and move during animations, for example when
        // going fullscreen. Only a window at rest covers others.
        'notify::opacity',
        () => queueCoverage(),
        'notify::scale-x',
        () => queueCoverage(),
        'notify::scale-y',
        () => queueCoverage(),
        'notify::translation-x',
        () => queueCoverage(),
        'notify::translation-y',
        () => queueCoverage(),
        state,
    );
    win.connectObject(
        'notify::wm-class',
        () => queueUpdate(state, STATE),
        // A window does not have to change its size to go fullscreen.
        'notify::fullscreen',
        () => {
            queueUpdate(state, STATE);
            queueCoverage();
        },
        'notify::minimized',
        () => queueCoverage(),
        'notify::appears-focused',
        () => queueUpdate(state, FOCUS),
        'workspace-changed',
        () => queueUpdate(state, FOCUS),
        state,
    );
    state.emitters.add(actor);
    state.emitters.add(win);

    queueUpdate(state, STATE);
    queueCoverage();
}

/**
 * Check before the next frame which windows are covered. Signals from
 * Mutter's own laters (restacked, in-fullscreen-changed) run before
 * BEFORE_REDRAW laters, so the check still lands in the same frame.
 */
function queueCoverage() {
    if (coverageLaterId || !laters) return;
    coverageLaterId = laters.add(Meta.LaterType.BEFORE_REDRAW, () => {
        coverageLaterId = 0;
        try {
            updateCoverage();
        } catch (e) {
            logError(e);
        }
        return GLib.SOURCE_REMOVE;
    });
}

/** Pause windows hidden behind an opaque fullscreen window, resume the rest. */
function updateCoverage() {
    const covered =
        coveragePausedBy.size > 0 ? new Set() : findCovered(describeStack());

    for (const state of states.values()) {
        const suspended = covered.has(state);
        if (state.suspended === suspended) continue;
        state.suspended = suspended;
        handlers.applySuspended(state);
    }
}

/**
 * Describe the window stack for {@link findCovered}, top window first.
 *
 * @returns {import('./coverage.js').StackEntry[]}
 */
function describeStack() {
    const actors = global.get_window_actors();
    const stack = [];
    for (let i = actors.length - 1; i >= 0; i--) {
        const actor = actors[i];
        const win = actor.metaWindow;
        if (!win) continue;

        const covers = coversMonitor(win) && isOpaque(actor);
        stack.push({
            key: states.get(actor) ?? actor,
            visible: actor.visible && !win.minimized,
            insideMonitor: monitorContaining(win),
            coversMonitor: covers ? win.get_monitor() : null,
        });
    }
    return stack;
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
    queueCoverage();
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
