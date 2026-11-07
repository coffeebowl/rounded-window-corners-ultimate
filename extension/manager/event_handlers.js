/**
 * @file Applies the pending changes of a window: adds or removes the effect,
 * updates its uniforms and the shadow. Everything here runs from the update
 * queue in window_state.js, never directly from a signal handler, so effects
 * are never changed in the middle of a paint.
 */

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

import {RoundedCornersEffect} from '../effect/rounded_corners_effect.js';
import {ShadowActor} from '../effect/shadow_actor.js';
import {
    MAGIC_LAMP_MINIMIZE_EFFECT,
    MAGIC_LAMP_UNMINIMIZE_EFFECT,
    ROUNDED_CORNERS_EFFECT,
    WOBBLY_EFFECT,
} from '../utils/constants.js';
import {logDebug} from '../utils/log.js';
import {
    computeBounds,
    computeShadowActorOffset,
    computeWindowContentsOffset,
    detectApp,
    getBorder,
    getShadowCfg,
    isGame,
    OTHER_APP,
    releaseApp,
    shouldEnableEffect,
    unwrapActor,
    updateShadowActorStyle,
} from './utils.js';
import {
    DEFORM,
    FOCUS,
    GEOMETRY,
    MINIMIZE,
    STATE,
    queueUpdate,
    states,
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
    if (bits & DEFORM) syncWobbly(state);

    // The surface actor of XWayland clients and the wm class can arrive
    // after the window. Their signals queue another update.
    const target = unwrapActor(actor);
    if (!target || win.wmClass === null || !state.texture) return;

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

    // The focus decides the border, so this runs on focus changes too.
    if (state.effect) updateEffect(state);

    if (state.shadow) refreshShadow(state);
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
    state.wobbly = null;
    state.lampTimer = null;
    state.texture = null;
}

/**
 * Apply a change of {@link WindowState.suspended}: a window hidden behind an
 * opaque fullscreen window pauses its effect, so Mutter culls it again and
 * skips its offscreen copy, and hides its shadow.
 *
 * Runs before the frame is painted, so a window that becomes visible again
 * has its corners in the same frame.
 *
 * @param {WindowState} state - The window.
 */
export function applySuspended(state) {
    logDebug(() => `${state.suspended ? 'Pausing' : 'Resuming'} ${state.win.wmClass}`);
    syncEffectEnabled(state);
    syncShadowVisible(state);
}

/**
 * Turn the corners off while the window is paused or in a magic lamp
 * animation. A disabled effect costs nothing, and Mutter culls the window
 * again (see meta-cullable.c).
 *
 * @param {WindowState} state - The window.
 */
function syncEffectEnabled(state) {
    const {effect} = state;
    if (!effect) return;

    const enabled =
        !state.suspended &&
        !state.lampHidden &&
        (!isBorderOnly(state) || state.win.appears_focused);
    if (effect.enabled === enabled) return;
    effect.enabled = enabled;
    // Without the effect, Mutter paints a window scaled below half size
    // from a mipmap again, see createEffect.
    state.texture?.set_create_mipmaps(!enabled);
}

/**
 * Check whether the effect of a window only draws the focus border: the
 * window is a libadwaita app, which rounds itself and draws its own line
 * and shadow. The effect is then only on while the window has the focus,
 * and cuts nothing off.
 *
 * @param {WindowState} state - The window.
 * @returns {boolean}
 */
function isBorderOnly(state) {
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
    syncShadowVisible(state);
}

/**
 * Show the shadow only while the window is shown, neither paused nor in a
 * magic lamp animation, and not maximized or fullscreen (unless the
 * settings keep the shadow then). A hidden actor is not painted at all.
 *
 * @param {WindowState} state - The window.
 */
export function syncShadowVisible(state) {
    if (!state.shadow) return;
    state.shadow.visible =
        state.actor.visible &&
        !state.suspended &&
        !state.lampHidden &&
        !state.wobbly &&
        !state.shadowHidden;
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
 * Hide the shadow while the "Compiz windows effect" extension wobbles the
 * window. The shadow is a separate actor and cannot wobble along.
 *
 * The extension adds its effect on its own signals, which may run after
 * ours, so this runs from the update queue. Removing the effect clears
 * its `actor` property, which shows the shadow again without polling.
 *
 * @param {WindowState} state - The window.
 */
function syncWobbly(state) {
    const effect = state.actor.get_effect(WOBBLY_EFFECT);
    if (effect === state.wobbly) return;

    if (state.wobbly) {
        state.wobbly.disconnectObject(state);
        state.emitters.delete(state.wobbly);
    }
    state.wobbly = effect;
    if (effect) {
        effect.connectObject(
            'notify::actor',
            () => {
                if (effect.actor === state.actor) return;
                effect.disconnectObject(state);
                state.emitters.delete(effect);
                if (state.wobbly === effect) state.wobbly = null;
                syncShadowVisible(state);
            },
            state,
        );
        state.emitters.add(effect);
    }
    syncShadowVisible(state);
}

/**
 * Keep every shadow actor directly below its window actor.
 *
 * Mutter restacks by lowering each window actor to the bottom in turn
 * (sync_actor_stacking in compositor.c), which leaves all shadows above all
 * windows. Hidden windows need their shadow put back too: Alt+Esc hides the
 * selected window while it shows a clone, and nothing restacks when the
 * window is shown again.
 */
export function onRestacked() {
    for (const {actor, shadow} of states.values()) {
        if (!shadow || shadow.get_parent() !== actor.get_parent()) continue;
        global.windowGroup.set_child_below_sibling(shadow, actor);
    }
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
 * update the window when the answer arrives. Games are known from their
 * window class right away.
 *
 * @param {WindowState} state - The window.
 * @param {() => void} [then] - Runs after the result arrived, also when the
 *   detection was already running. Not run if the window went away.
 */
function startAppDetection(state, then) {
    if (!state.app && !state.detection) {
        const pid = state.win.get_pid();
        if (isGame(state.win) || pid <= 0) {
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
 * Add the effect and the shadow to a window.
 *
 * @param {WindowState} state - The window.
 * @param {Clutter.Actor} target - The actor to add the effect to.
 */
function createEffect(state, target) {
    logDebug(() => `Adding effect to ${state.win.wmClass}`);

    const effect = new RoundedCornersEffect();
    target.add_effect_with_name(ROUNDED_CORNERS_EFFECT, effect);
    state.effect = effect;
    state.effectActor = target;

    // Mutter paints a window below half size from a half-resolution mipmap.
    // With the effect it would do that even while filling the full-size
    // offscreen texture, which makes overview previews blurry (upstream
    // issue #36, pull request #170).
    state.texture?.set_create_mipmaps(false);

    // libadwaita apps draw their own shadow.
    if (isBorderOnly(state)) return;

    const shadow = createShadow(state.actor);
    state.shadow = shadow;

    // Bind properties of the window to the shadow actor. Visibility is set
    // by syncShadowVisible, since it also depends on the window state, and
    // the pivot point by updateEffect, since the shadow is larger.
    for (const prop of [
        'translation-x',
        'translation-y',
        'scale-x',
        'scale-y',
        'opacity',
    ]) {
        state.bindings.push(
            state.actor.bind_property(
                prop,
                shadow,
                prop,
                GObject.BindingFlags.SYNC_CREATE,
            ),
        );
    }
    syncShadowVisible(state);
}

/**
 * Remove the effect and the shadow from a window.
 *
 * @param {WindowState} state - The window.
 */
function removeEffect(state) {
    logDebug(() => `Removing effect from ${state.win.wmClass}`);

    state.effectActor?.remove_effect_by_name(ROUNDED_CORNERS_EFFECT);
    state.effect = null;
    state.effectActor = null;
    state.texture?.set_create_mipmaps(true);

    for (const binding of state.bindings) binding.unbind();
    state.bindings = [];

    state.shadow?.destroy();
    state.shadow = null;
    // Only a window with the effect hides it for a magic lamp animation.
    // A new effect must not start disabled.
    state.lampHidden = false;

    if (state.unminimizeTimeoutId) {
        GLib.source_remove(state.unminimizeTimeoutId);
        state.unminimizeTimeoutId = 0;
    }
}

/**
 * Create the shadow actor for a window.
 *
 * @param {import('gi://Meta').default.WindowActor} actor - The window actor to create the shadow actor for.
 * @returns {ShadowActor}
 */
function createShadow(actor) {
    // The shadow has a transparent middle, so nothing shows through behind
    // the window (https://gitlab.gnome.org/GNOME/gnome-shell/-/issues/4474).
    const shadow = new ShadowActor({name: 'Shadow Actor'});

    // Draw the shadow actor below the window actor.
    global.windowGroup.insert_child_below(shadow, actor);

    // Bind position and size between window and shadow. The index is the
    // Clutter.BindCoordinate (X, Y, WIDTH, HEIGHT), in the order of the
    // offsets from computeShadowActorOffset.
    for (let i = 0; i < 4; i++) {
        const constraint = new Clutter.BindConstraint({
            source: actor,
            coordinate: i,
            offset: 0,
        });
        shadow.add_constraint(constraint);
    }

    return shadow;
}

/**
 * Update the shadow style for the window's focus.
 *
 * @param {WindowState} state - The window.
 */
function refreshShadow(state) {
    const {win, shadow} = state;
    const hidden = updateShadowActorStyle(win, shadow, getShadowCfg(win));
    if (hidden !== state.shadowHidden) {
        state.shadowHidden = hidden;
        syncShadowVisible(state);
    }
}

/**
 * Update effect uniforms and shadow constraints for a window. Uniforms and
 * constraints that stay the same cost nothing.
 *
 * @param {WindowState} state - The window.
 */
function updateEffect(state) {
    const {win, effect, effectActor, shadow} = state;

    // A paused window keeps its uniforms up to date, so it looks right as
    // soon as it is visible again.
    syncEffectEnabled(state);

    const windowContentOffset = computeWindowContentsOffset(win);
    effect.updateUniforms(
        computeBounds(effectActor, windowContentOffset),
        getBorder(win),
        !isBorderOnly(state),
    );

    if (!shadow) return;
    const offsets = computeShadowActorOffset(windowContentOffset);
    shadow.get_constraints().forEach((constraint, i) => {
        if (constraint instanceof Clutter.BindConstraint) {
            constraint.offset = offsets[i];
        }
    });

    // Scale the shadow around the same point as the window, for example at
    // the bottom edge when a window opens. The pivot point is relative to
    // the size, and the shadow is larger.
    const {actor} = state;
    const [x, y, width, height] = offsets;
    const [pivotX, pivotY] = actor.get_pivot_point();
    shadow.set_pivot_point(
        (pivotX * actor.width - x) / (actor.width + width),
        (pivotY * actor.height - y) / (actor.height + height),
    );
}
