/**
 * @file Applies the pending changes of a window: adds or removes the effect,
 * updates its uniforms and the shadow. Everything here runs from the update
 * queue in window_state.js, never directly from a signal handler, so effects
 * are never changed in the middle of a paint.
 */

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {ClipShadowEffect} from '../effect/clip_shadow_effect.js';
import {RoundedCornersEffect} from '../effect/rounded_corners_effect.js';
import {CLIP_SHADOW_EFFECT, ROUNDED_CORNERS_EFFECT} from '../utils/constants.js';
import {logDebug} from '../utils/log.js';
import {getPref} from '../utils/settings.js';
import {
    computeBounds,
    computeShadowActorOffset,
    computeWindowContentsOffset,
    detectApp,
    getRoundedCornersCfg,
    isGame,
    needsAppType,
    releaseApp,
    shouldEnableEffect,
    unwrapActor,
    updateShadowActorStyle,
} from './utils.js';
import {FOCUS, GEOMETRY, STATE, queueUpdate, states, whenAlive} from './window_state.js';

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

    // The surface actor of XWayland clients and the wm class can arrive
    // after the window. Their signals queue another update.
    if (!actor.firstChild || win.wmClass === null) return;

    syncTexture(state);
    if (!state.texture) return;

    if (state.app === null && needsAppType()) startAppDetection(state);

    // Everything except a focus change can decide whether the window has
    // the effect: maximizing changes the size, fullscreen and settings
    // change the rules, and so on.
    if (bits & ~FOCUS) {
        const wanted = shouldEnableEffect(win, state.app);
        const target = unwrapActor(actor);

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

        if (wanted && !state.effect && target && hasSize)
            createEffect(state, target);
        else if (!wanted && state.effect) removeEffect(state);

        if (state.effect) updateEffect(state);
    }

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
    state.texture = null;
}

/**
 * Hide the shadow and pause the corners while the "Compiz alike magic lamp
 * effect" extension animates a minimize.
 *
 * @param {WindowState} state - The window being minimized.
 */
export function onMinimize(state) {
    const magicLampEffect = state.actor.get_effect('minimize-magic-lamp-effect');
    if (magicLampEffect && state.shadow && state.effect) {
        logDebug('Minimizing with magic lamp effect');
        state.shadow.visible = false;
        state.effect.enabled = false;
    }
}

/**
 * Show the shadow again after a magic lamp unminimize, and refresh Chromium
 * windows once they settled.
 *
 * @param {WindowState} state - The window being unminimized.
 */
export function onUnminimize(state) {
    // Compatibility with "Compiz alike magic lamp effect".
    // When unminimizing a window, wait until the effect is completed before
    // showing the shadow.
    const magicLampEffect = state.actor.get_effect(
        'unminimize-magic-lamp-effect',
    );
    if (magicLampEffect && state.shadow && state.effect) {
        const {shadow, effect} = state;
        shadow.visible = false;
        const timer = magicLampEffect.timerId;

        timer.connectObject(
            'new-frame',
            source => {
                // Wait until the effect is 98% completed
                if (source.get_progress() > 0.98) {
                    logDebug('Unminimizing with magic lamp effect');
                    shadow.visible = true;
                    effect.enabled = true;
                    timer.disconnectObject(state);
                    state.emitters.delete(timer);
                }
            },
            state,
        );
        // Disconnected in teardown if the window goes away first.
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
    // Without skip settings the app may not be known yet; then the refresh
    // follows once it is.
    if (state.app) refreshChromiumLater(state);
    else startAppDetection(state, () => refreshChromiumLater(state));
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

/** Keep every shadow actor directly below its window actor. */
export function onRestacked() {
    for (const {actor, shadow} of states.values()) {
        if (!(shadow && actor.visible)) continue;
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
    }
    state.texture = texture;
    if (texture) {
        texture.connectObject(
            'size-changed',
            () => queueUpdate(state, GEOMETRY),
            state,
        );
        state.emitters.add(texture);
    }
}

/**
 * Find out once whether the app uses libadwaita, libhandy or Chromium, and
 * update the window when the answer arrives. Games are known from their
 * window class right away.
 *
 * @param {WindowState} state - The window.
 * @param {() => void} [then] - Runs after the result arrived.
 */
function startAppDetection(state, then) {
    if (state.app) {
        then?.();
        return;
    }
    if (state.detecting) return;

    const pid = state.win.get_pid();
    if (isGame(state.win) || pid <= 0) {
        state.app = {type: 'Other', chromium: false};
        queueUpdate(state, STATE);
        then?.();
        return;
    }

    state.detecting = true;
    state.pid = pid;
    whenAlive(state, detectApp(state.win, pid), app => {
        state.app = app;
        state.detecting = false;
        queueUpdate(state, STATE);
        then?.();
    });
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

    const shadow = createShadow(state.actor);
    state.shadow = shadow;

    // Bind properties of the window to the shadow actor.
    for (const prop of [
        'pivot-point',
        'translation-x',
        'translation-y',
        'scale-x',
        'scale-y',
        'visible',
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

    for (const binding of state.bindings) binding.unbind();
    state.bindings = [];

    state.shadow?.destroy();
    state.shadow = null;

    if (state.unminimizeTimeoutId) {
        GLib.source_remove(state.unminimizeTimeoutId);
        state.unminimizeTimeoutId = 0;
    }
}

/**
 * Create the shadow actor for a window.
 *
 * @param {import('gi://Meta').default.WindowActor} actor - The window actor to create the shadow actor for.
 * @returns {St.Bin}
 */
function createShadow(actor) {
    const shadow = new St.Bin({
        name: 'Shadow Actor',
        child: new St.Bin({
            xExpand: true,
            yExpand: true,
        }),
    });
    shadow.firstChild.add_style_class_name('shadow');

    // We have to clip the shadow because of this issue:
    // https://gitlab.gnome.org/GNOME/gnome-shell/-/issues/4474
    shadow.add_effect_with_name(CLIP_SHADOW_EFFECT, new ClipShadowEffect());

    // Draw the shadow actor below the window actor.
    global.windowGroup.insert_child_below(shadow, actor);

    // Bind position and size between window and shadow
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
 * Update the shadow style for the window's focus and settings.
 *
 * @param {WindowState} state - The window.
 */
function refreshShadow(state) {
    const {win, shadow} = state;
    const shadowSettings = win.appears_focused
        ? getPref('focused-shadow')
        : getPref('unfocused-shadow');

    updateShadowActorStyle(win, shadow, getRoundedCornersCfg(win), shadowSettings);
}

/**
 * Update effect uniforms and shadow constraints for a window.
 *
 * @param {WindowState} state - The window.
 */
function updateEffect(state) {
    const {actor, win, effect, shadow} = state;

    if (!effect.enabled) {
        effect.enabled = true;
    }

    const cfg = getRoundedCornersCfg(win);
    const windowContentOffset = computeWindowContentsOffset(win);
    effect.updateUniforms(cfg, computeBounds(actor, windowContentOffset));

    const offsets = computeShadowActorOffset(windowContentOffset);
    shadow.get_constraints().forEach((constraint, i) => {
        if (constraint instanceof Clutter.BindConstraint) {
            constraint.offset = offsets[i];
        }
    });
}
