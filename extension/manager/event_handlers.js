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

import {RoundedCornersEffect} from '../effect/rounded_corners_effect.js';
import {ROUNDED_CORNERS_EFFECT} from '../utils/constants.js';
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

    // Follow the texture for every window, also those that never get the
    // effect: a new buffer can make a window opaque, which matters for
    // pausing the windows below it.
    syncTexture(state);

    // The surface actor of XWayland clients and the wm class can arrive
    // after the window. Their signals queue another update.
    const target = unwrapActor(actor);
    if (!target || win.wmClass === null || !state.texture) return;

    if (state.app === null && needsAppType()) startAppDetection(state);

    // Everything except a focus change can decide whether the window has
    // the effect: maximizing changes the size, fullscreen and settings
    // change the rules, and so on.
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
        state.lampHidden = true;
        syncShadowVisible(state);
        state.effect.enabled = false;
    }
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
    if (state.effect && !state.lampHidden) state.effect.enabled = !state.suspended;
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
        !state.shadowHidden;
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
    if (!magicLampEffect && state.lampHidden) {
        // Minimized with the magic lamp, but restored without it.
        state.lampHidden = false;
        syncShadowVisible(state);
        if (state.effect) state.effect.enabled = !state.suspended;
    }
    if (magicLampEffect && state.shadow && state.effect) {
        state.lampHidden = true;
        syncShadowVisible(state);
        const timer = magicLampEffect.timerId;

        timer.connectObject(
            'new-frame',
            source => {
                // Wait until the effect is 98% completed
                if (source.get_progress() > 0.98) {
                    logDebug('Unminimizing with magic lamp effect');
                    state.lampHidden = false;
                    syncShadowVisible(state);
                    if (state.effect) state.effect.enabled = !state.suspended;
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
        if (state.effect) state.texture.set_create_mipmaps(true);
    }
    state.texture = texture;
    if (texture && state.effect) texture.set_create_mipmaps(false);
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

    // Mutter paints a window below half size from a half-resolution mipmap.
    // With the effect it would do that even while filling the full-size
    // offscreen texture, which makes overview previews blurry (upstream
    // issue #36, pull request #170).
    state.texture?.set_create_mipmaps(false);

    const shadow = createShadow(state.actor);
    state.shadow = shadow;

    // Bind properties of the window to the shadow actor. Visibility is set
    // by syncShadowVisible, since it also depends on the window state.
    for (const prop of [
        'pivot-point',
        'translation-x',
        'translation-y',
        'scale-x',
        'scale-y',
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
    // The class only sets the cross-fade when the focus changes. The image
    // has a transparent middle, so nothing shows through behind the window
    // (https://gitlab.gnome.org/GNOME/gnome-shell/-/issues/4474).
    shadow.firstChild.add_style_class_name('shadow');

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

    const hidden = updateShadowActorStyle(
        win,
        shadow,
        getRoundedCornersCfg(win),
        shadowSettings,
    );
    if (hidden !== state.shadowHidden) {
        state.shadowHidden = hidden;
        syncShadowVisible(state);
    }
}

/**
 * Update effect uniforms and shadow constraints for a window.
 *
 * @param {WindowState} state - The window.
 */
function updateEffect(state) {
    const {win, effect, effectActor, shadow} = state;

    // A paused window keeps its uniforms up to date, so it looks right as
    // soon as it is visible again.
    effect.enabled = !state.suspended;

    const cfg = getRoundedCornersCfg(win);
    const windowContentOffset = computeWindowContentsOffset(win);
    effect.updateUniforms(
        cfg,
        computeBounds(win, effectActor, windowContentOffset),
    );

    const offsets = computeShadowActorOffset(windowContentOffset);
    shadow.get_constraints().forEach((constraint, i) => {
        if (constraint instanceof Clutter.BindConstraint) {
            constraint.offset = offsets[i];
        }
    });
}
