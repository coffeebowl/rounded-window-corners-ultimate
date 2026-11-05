/** @file Provides functions for handling shadows during workspace switching. */

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';

import {states} from '../manager/window_state.js';
import {SHADOW_PADDING} from '../utils/constants.js';

/**
 * Shadow clones by the window clone they belong to, so they can be removed
 * after the switch or when the extension is disabled mid-switch.
 *
 * @type {Map<Clutter.Actor, {shadowClone: Clutter.Clone, binding: GObject.Binding}>}
 */
const shadowClones = new Map();

/**
 * Workspace groups with a connected `restacked` handler.
 *
 * @type {Set<Clutter.Actor>}
 */
const workspaces = new Set();

/**
 * Add shadows to windows when switching workspaces.
 *
 * @param {import('resource:///org/gnome/shell/ui/workspaceAnimation.js').WorkspaceAnimationController} self - The workspace animation controller.
 */
export function addShadowsInWorkspaceSwitch(self) {
    for (const monitor of self._switchData.monitors) {
        for (const workspace of monitor._workspaceGroups) {
            const windowRecords = workspace._windowRecords;

            // Switching workspaces messes with the window stacking order,
            // so the shadows need to be restacked in order to always be
            // behind the window. The connection ends with the workspace.
            global.display.connectObject(
                'restacked',
                () => {
                    for (const {clone} of windowRecords) {
                        const shadow = shadowClones.get(clone)?.shadowClone;
                        if (shadow) {
                            workspace.set_child_below_sibling(shadow, clone);
                        }
                    }
                },
                workspace,
            );
            workspaces.add(workspace);
            workspace.connectObject(
                'destroy',
                () => workspaces.delete(workspace),
                workspaces,
            );

            for (const {windowActor: actor, clone} of windowRecords) {
                const state = states.get(actor);
                const win = actor.metaWindow;

                // Skip windows that don't have a shadow or an enabled RWC effect.
                if (!(state?.shadow && state.effect?.enabled && win)) {
                    continue;
                }

                // Clone the shadow actor and set its dimensions to match the
                // window actor size.
                const shadowClone = new Clutter.Clone({
                    source: state.shadow,
                });

                const frameRect = win.get_frame_rect();

                shadowClone.width = frameRect.width + SHADOW_PADDING * 2;
                shadowClone.height = frameRect.height + SHADOW_PADDING * 2;
                shadowClone.x =
                    clone.x + frameRect.x - actor.x - SHADOW_PADDING;
                shadowClone.y =
                    clone.y + frameRect.y - actor.y - SHADOW_PADDING;

                // Compatibility with Desktop Cube. The connection ends when
                // either clone is destroyed.
                clone.connectObject(
                    'notify::translation-z',
                    () => {
                        shadowClone.translationZ = clone.translationZ - 0.05;
                    },
                    shadowClone,
                );

                // Remember the shadow clone, so the restacked handler above
                // can keep it below its window clone.
                const binding = clone.bind_property(
                    'visible',
                    shadowClone,
                    'visible',
                    GObject.BindingFlags.DEFAULT,
                );
                shadowClones.set(clone, {shadowClone, binding});
                clone.connectObject(
                    'destroy',
                    () => removeShadowClone(clone),
                    shadowClones,
                );

                workspace.insert_child_below(shadowClone, clone);
            }
        }
    }
}

/**
 * Delete shadow clones after switching workspaces.
 *
 * @param {import('resource:///org/gnome/shell/ui/workspaceAnimation.js').WorkspaceAnimationController} self - The workspace animation controller.
 */
export function removeShadowsAfterWorkspaceSwitch(self) {
    for (const monitor of self._switchData?.monitors ?? []) {
        for (const workspace of monitor._workspaceGroups) {
            for (const {clone} of workspace._windowRecords) {
                removeShadowClone(clone);
            }
        }
    }
}

/** Remove all shadow clones, for example when disabling mid-switch. */
export function removeWorkspaceShadows() {
    for (const clone of [...shadowClones.keys()]) removeShadowClone(clone);
    for (const workspace of workspaces) {
        global.display.disconnectObject(workspace);
        workspace.disconnectObject(workspaces);
    }
    workspaces.clear();
}

/**
 * Remove the shadow clone of one window clone.
 *
 * @param {Clutter.Actor} clone - The window clone.
 */
function removeShadowClone(clone) {
    const entry = shadowClones.get(clone);
    if (!entry) return;
    shadowClones.delete(clone);
    entry.binding.unbind();
    entry.shadowClone.destroy();
}
