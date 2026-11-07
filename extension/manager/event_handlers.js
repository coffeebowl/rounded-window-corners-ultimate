/**
 * @file Applies the pending changes of a window: adds or removes the effect
 * and updates its uniforms, the shadow included. Everything here runs from
 * the update queue in window_state.js, never directly from a signal
 * handler, so effects are never changed in the middle of a paint.
 */

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
import {
    computeBounds,
    detectApp,
    getBorder,
    isMaximized,
    OTHER_APP,
    releaseApp,
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

    // The surface actor of XWayland clients can arrive after the window.
    // Its signal queues another update.
    const target = unwrapActor(actor);
    if (!target || !state.texture) return;

    if (state.app === null) startAppDetection(state);

    // Everything except a focus change can decide whether the window has
    // the effect: maximizing changes the size, fullscreen changes the
    // rules, and so on.
    if (bits & ~FOCUS) {
        const wanted = shouldEnableEffect(win, state.app);

        // The X11 surface actor can be replaced; move the effect along.
        if (state.effect && state.effectActor !== target) removeEffect(state);

        // An offscreen effect cannot paint a window that has no buffer yet.
        // The texture's size-changed signal queues the next update once the
        // first buffer arrives.
        const [, bufferWidth, bufferHeight] = state.texture.get_preferred_size();
        const hasSize =
            actor.width > 0 &&
            actor.height > 0 &&
            bufferWidth > 0 &&
            bufferHeight > 0;

        if (wanted && !state.effect && hasSize)
            createEffect(state, target);
        else if (!wanted && state.effect) removeEffect(state);
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
 * opaque fullscreen window pauses its effect, so Mutter culls it again and
 * skips its offscreen copy and shadow.
 *
 * Runs before the frame is painted, so a window that becomes visible again
 * has its corners in the same frame.
 *
 * @param {WindowState} state - The window.
 */
export function applySuspended(state) {
    logDebug(() => `${state.suspended ? 'Pausing' : 'Resuming'} ${state.win.wmClass}`);
    syncEffectEnabled(state);
}

/**
 * Turn corners and shadow off while the window is paused or in a magic
 * lamp animation. A disabled effect costs nothing, and Mutter culls the
 * window again (see meta-cullable.c), which needs both effects disabled.
 *
 * @param {WindowState} state - The window.
 */
function syncEffectEnabled(state) {
    const {effect, room} = state;
    if (!effect) return;

    const borderOnly = isBorderOnly(state);
    const enabled =
        !state.suspended &&
        !state.lampHidden &&
        (!borderOnly || state.win.appears_focused);
    // Only windows with a shadow need room for it.
    room.enabled = enabled && !borderOnly;
    if (effect.enabled === enabled) return;
    effect.enabled = enabled;
    // Without the effect, Mutter paints a window scaled below half size
    // from a mipmap again, see createEffect.
    state.texture?.set_create_mipmaps(!enabled);
}

/**
 * Check whether the effect of a window only draws the focus border, so it
 * is only on while the window has the focus: libadwaita apps round
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
    const hidden = Boolean(lamp && state.effect);
    setLampHidden(state, hidden);
    if (minimized) return;

    // Show shadow and corners again shortly before the unminimize ends.
    if (hidden) {
        const timer = lamp.timerId;
        timer.connectObject(
            'new-frame',
            source => {
                if (source.get_progress() <= 0.98) return;
                logDebug('Unminimized with magic lamp effect');
                stopLampTimer(state);
                setLampHidden(state, false);
            },
            state,
        );
        // Disconnected in teardown if the window goes away first.
        state.lampTimer = timer;
        state.emitters.add(timer);
    }

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
 * Stop following the unminimize animation of a window.
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
                detectApp(state.win, pid),
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

    // A paused window keeps its uniforms up to date, so it looks right as
    // soon as it is visible again.
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
