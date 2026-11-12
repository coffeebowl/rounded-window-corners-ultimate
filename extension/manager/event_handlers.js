/**
 * @file Applies the pending changes of a window: adds or removes the effect
 * and updates its uniforms, the shadow included. Everything here runs from
 * the update queue in window_state.js, never directly from a signal
 * handler, so effects are never changed in the middle of a paint.
 */

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';

import {
    RoundedCornersEffect,
    ShadowRoomEffect,
} from '../effect/rounded_corners_effect.js';
import {RADIUS} from '../utils/config.js';
import {
    MAGIC_LAMP_MINIMIZE_EFFECT,
    MAGIC_LAMP_UNMINIMIZE_EFFECT,
    ROUNDED_CORNERS_EFFECT,
    SHADOW_ROOM_EFFECT,
} from '../utils/constants.js';
import {logDebug} from '../utils/log.js';
import {detectApp, OTHER_APP, releaseApp} from './app_detection.js';
import {
    computeBounds,
    getBorder,
    isMaximized,
    shouldEnableEffect,
    unwrapActor,
} from './utils.js';
import {
    FOCUS,
    GEOMETRY,
    MINIMIZE,
    STATE,
    queueUpdate,
    whenAlive,
} from './window_state.js';

/** @typedef {import('./window_state.js').WindowState} WindowState */

/**
 * Apply the pending changes of a window. Called by the update queue at most
 * once per frame and window.
 *
 * @param {WindowState} state - The window.
 * @param {number} bits - What changed since the last update.
 */
export function flush(state, bits) {
    const {actor} = state;
    const win = actor.metaWindow;
    if (!win) return;

    // Follow the texture for every window, also those that never get the
    // effect: a new buffer can make a window opaque, which matters for
    // pausing the windows below it.
    syncTexture(state);
    if (!state.texture) return;

    // Everything except a focus change can decide whether the window has
    // the effect: maximizing changes the size, fullscreen changes the
    // rules, and so on. A focus change only for windows whose effect only
    // draws the focus border.
    if (bits & ~FOCUS) {
        // The surface actor of XWayland clients can arrive after the
        // window, and can be replaced; move the effect along. Its signal
        // queues another update.
        const target = unwrapActor(actor);
        if (state.effect && state.effectActor !== target) removeEffect(state);
        if (!target) return;

        if (state.app === null) startAppDetection(state);
        syncEffect(state, target);
    } else if (isBorderOnly(state)) {
        syncEffect(state, null);
    }

    if (bits & MINIMIZE) syncMinimized(state);

    // The focus decides border and shadow, so this runs on focus changes
    // too.
    if (state.effect) updateEffect(state);
}

/**
 * Remove everything the extension added to a window.
 *
 * @param {WindowState} state - The window.
 */
export function teardown(state) {
    if (state.effect) removeEffect(state);
    if (state.pid) releaseApp(state.pid);
    state.pid = 0;
    for (const emitter of state.emitters) emitter.disconnectObject(state);
    state.emitters.clear();
    state.lampTimer = null;
    state.texture = null;
}

/**
 * Apply a change of {@link WindowState.suspended}: a window hidden behind an
 * opaque fullscreen window loses its effect, so Mutter culls it again and
 * skips its offscreen copy and shadow.
 *
 * Runs before the frame is painted, so a window that becomes visible again
 * has its corners in the same frame.
 *
 * @param {WindowState} state - The window.
 */
export function applySuspended(state) {
    logDebug(() => `${state.suspended ? 'Pausing' : 'Resuming'} ${state.win.wmClass}`);
    syncEffect(state, null);
    if (state.effect) updateEffect(state);
}

/**
 * Add or remove the effect as the window needs it now.
 *
 * The effect only exists while it paints. A disabled effect would not be
 * painted either, but Clutter keeps its offscreen texture until the effect
 * is removed (clutter_offscreen_effect_set_enabled in Clutter 51), and
 * makes a new one when it is enabled again. So paused windows, and windows
 * whose effect only draws the focus border while they have no focus, have
 * no effect at all.
 *
 * @param {WindowState} state - The window.
 * @param {import('gi://Clutter').default.Actor | null} target - The actor
 *   for the effect, if already known.
 */
function syncEffect(state, target) {
    const {actor, win} = state;
    const wanted =
        shouldEnableEffect(win, state.app) &&
        !state.suspended &&
        (!isBorderOnly(state) || win.appears_focused);
    if (!wanted) {
        if (state.effect) removeEffect(state);
        return;
    }
    if (state.effect) return;

    // An offscreen effect cannot paint a window that has no buffer yet.
    // The texture's size-changed signal queues the next update once the
    // first buffer arrives. A window can also be resumed before its first
    // update found a texture.
    if (!state.texture) return;
    const [, bufferWidth, bufferHeight] = state.texture.get_preferred_size();
    if (
        actor.width <= 0 ||
        actor.height <= 0 ||
        bufferWidth <= 0 ||
        bufferHeight <= 0
    )
        return;

    target ??= unwrapActor(actor);
    if (target) createEffect(state, target);
}

/**
 * Turn corners and shadow off during a magic lamp animation, which only
 * lasts a moment. Mutter then culls the window again (see meta-cullable.c),
 * which needs both effects disabled.
 *
 * @param {WindowState} state - The window.
 */
function syncEffectEnabled(state) {
    const {effect, room} = state;
    if (!effect) return;

    const enabled = !state.lampHidden;
    // Only windows with a shadow need room for it.
    room.enabled = enabled && !isBorderOnly(state);
    if (effect.enabled === enabled) return;
    effect.enabled = enabled;
    // Without the effect, Mutter paints a window scaled below half size
    // from a mipmap again, see createEffect.
    state.texture?.set_create_mipmaps(!enabled);
}

/**
 * Check whether the effect of a window only draws the focus border, so the
 * window only has it while it has the focus: libadwaita apps round
 * themselves and draw their own line and shadow, maximized and tiled
 * windows stay square and have neither.
 *
 * @param {WindowState} state - The window.
 * @returns {boolean}
 */
function isBorderOnly(state) {
    return isLibadwaita(state) || isMaximized(state.win);
}

/**
 * @param {WindowState} state - The window.
 * @returns {boolean} Whether the window belongs to a libadwaita app.
 */
function isLibadwaita(state) {
    return state.app?.libadwaita === true;
}

/**
 * Start or end hiding shadow and corners for a magic lamp animation.
 *
 * @param {WindowState} state - The window.
 * @param {boolean} hidden - Whether the animation runs.
 */
function setLampHidden(state, hidden) {
    state.lampHidden = hidden;
    syncEffectEnabled(state);
}

/**
 * Follow a minimize or unminimize: hide shadow and corners while the
 * "Compiz alike magic lamp effect" extension animates it, and refresh
 * Chromium windows once they settled after unminimizing.
 *
 * That extension adds its effect in its own signal handlers, which may run
 * after ours, so this runs from the update queue. A minimize and unminimize
 * in the same frame end up here once, the current state decides.
 *
 * @param {WindowState} state - The window.
 */
function syncMinimized(state) {
    // Only the latest animation counts, an older one may still run.
    stopLampTimer(state);

    const {minimized} = state.win;
    const lamp = state.actor.get_effect(
        minimized ? MAGIC_LAMP_MINIMIZE_EFFECT : MAGIC_LAMP_UNMINIMIZE_EFFECT,
    );
    // Without the animation's timeline, from another version of that
    // extension, its end cannot be seen, so nothing is hidden.
    const timer = lamp?.timerId;
    const hidden = Boolean(state.effect && timer instanceof Clutter.Timeline);
    setLampHidden(state, hidden);
    if (hidden) followLamp(state, timer, minimized);
    if (minimized) return;

    // Chromium has a bug where windows are sometimes unminimized to the
    // wrong location, and then move to the correct position shortly after.
    // This forces an effect refresh after the window has already moved to the
    // proper position; otherwise, the effect bounds would use the wrong one and
    // cut off a part of the window.
    //
    // See https://github.com/flexagoon/rounded-window-corners/issues/124
    //
    // If the app is not known yet, the refresh follows once it is.
    startAppDetection(state, () => refreshChromiumLater(state));
}

/**
 * Show shadow and corners again when the magic lamp animation of a window
 * ends: shortly before the end of an unminimize, and only after a
 * minimize, or they would flash up in its last frames. A minimized window
 * is still seen through clones, in the overview, Alt+Tab or a dock.
 *
 * @param {WindowState} state - The window.
 * @param {import('gi://Clutter').default.Timeline} timer - The animation.
 * @param {boolean} minimized - Whether it animates a minimize.
 */
function followLamp(state, timer, minimized) {
    const show = () => {
        logDebug(() => `Magic lamp effect ended for ${state.win.wmClass}`);
        stopLampTimer(state);
        setLampHidden(state, false);
    };
    timer.connectObject(
        'new-frame',
        source => {
            if (!minimized && source.get_progress() > 0.98) show();
        },
        'completed',
        show,
        state,
    );
    // Disconnected in teardown if the window goes away first.
    state.lampTimer = timer;
    state.emitters.add(timer);
}

/**
 * Stop following the magic lamp animation of a window.
 *
 * @param {WindowState} state - The window.
 */
function stopLampTimer(state) {
    if (!state.lampTimer) return;
    state.lampTimer.disconnectObject(state);
    state.emitters.delete(state.lampTimer);
    state.lampTimer = null;
}

/**
 * Refresh a Chromium window 250 ms after it was unminimized.
 *
 * @param {WindowState} state - The window.
 */
function refreshChromiumLater(state) {
    if (!(state.app?.chromium && state.effect)) return;

    if (state.unminimizeTimeoutId)
        GLib.source_remove(state.unminimizeTimeoutId);
    state.unminimizeTimeoutId = GLib.timeout_add(
        GLib.PRIORITY_DEFAULT,
        250,
        () => {
            state.unminimizeTimeoutId = 0;
            queueUpdate(state, GEOMETRY);
            return GLib.SOURCE_REMOVE;
        },
    );
}

/**
 * Follow the window's current texture. Its `size-changed` signal is needed
 * besides `notify::size` on the actor; without it, windows can stay
 * invisible with Dash to Dock until they are pinned.
 *
 * @param {WindowState} state - The window.
 */
function syncTexture(state) {
    const texture = state.actor.get_texture();
    if (texture === state.texture) return;

    if (state.texture) {
        state.texture.disconnectObject(state);
        state.emitters.delete(state.texture);
        if (state.effect?.enabled) state.texture.set_create_mipmaps(true);
    }
    state.texture = texture;
    if (texture) {
        if (state.effect?.enabled) texture.set_create_mipmaps(false);
        texture.connectObject(
            'size-changed',
            () => queueUpdate(state, GEOMETRY),
            state,
        );
        state.emitters.add(texture);
    }
}

/**
 * Find out once whether the app uses libadwaita or Chromium, and
 * update the window when the answer arrives.
 *
 * @param {WindowState} state - The window.
 * @param {() => void} [then] - Runs after the result arrived, also when the
 *   detection was already running. Not run if the window went away.
 */
function startAppDetection(state, then) {
    if (!state.app && !state.detection) {
        const pid = state.win.get_pid();
        if (pid <= 0) {
            state.app = OTHER_APP;
            queueUpdate(state, STATE);
        } else {
            state.pid = pid;
            state.detection = whenAlive(
                state,
                detectApp(pid, state.win.wmClass),
                app => {
                    state.app = app;
                    state.detection = null;
                    queueUpdate(state, STATE);
                },
            );
        }
    }

    if (state.app) then?.();
    else if (then) state.detection.then(() => state.app && then());
}

/**
 * Add the effect to a window, and the room for its shadow before it.
 *
 * @param {WindowState} state - The window.
 * @param {import('gi://Clutter').default.Actor} target - The actor to add
 *   the effect to.
 */
function createEffect(state, target) {
    logDebug(() => `Adding effect to ${state.win.wmClass}`);

    const room = new ShadowRoomEffect();
    target.add_effect_with_name(SHADOW_ROOM_EFFECT, room);
    const effect = new RoundedCornersEffect();
    target.add_effect_with_name(ROUNDED_CORNERS_EFFECT, effect);
    state.room = room;
    state.effect = effect;
    state.effectActor = target;

    // Mutter paints a window below half size from a half-resolution mipmap.
    // With the effect it would do that even while filling the full-size
    // offscreen texture, which makes overview previews blurry (upstream
    // issue #36, pull request #170).
    state.texture?.set_create_mipmaps(false);
}

/**
 * Remove the effect and the room for its shadow from a window.
 *
 * @param {WindowState} state - The window.
 */
function removeEffect(state) {
    logDebug(() => `Removing effect from ${state.win.wmClass}`);

    state.effectActor?.remove_effect(state.effect);
    state.effectActor?.remove_effect(state.room);
    state.effect = null;
    state.room = null;
    state.effectActor = null;
    state.texture?.set_create_mipmaps(true);

    // Only a window with the effect hides it for a magic lamp animation.
    // A new effect must not start disabled.
    state.lampHidden = false;

    if (state.unminimizeTimeoutId) {
        GLib.source_remove(state.unminimizeTimeoutId);
        state.unminimizeTimeoutId = 0;
    }
}

/**
 * Update the effect uniforms of a window. Uniforms that stay the same cost
 * nothing.
 *
 * @param {WindowState} state - The window.
 */
function updateEffect(state) {
    const {win, effect} = state;

    // A window that is maximized with the focus border keeps its effect,
    // but no longer needs room for a shadow.
    syncEffectEnabled(state);

    // libadwaita's own shadow lies outside the window and has to stay.
    // Everything else is cut off, also around maximized windows, whose old
    // buffer can still have room for a shadow right after maximizing.
    effect.updateUniforms(
        computeBounds(win),
        getBorder(win),
        !isLibadwaita(state),
        isMaximized(win) ? 0 : RADIUS,
    );
    // libadwaita apps draw their own shadow, maximized windows have none.
    effect.setShadow(!isBorderOnly(state), win.appears_focused);
}
