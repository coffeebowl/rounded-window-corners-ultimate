/** @file Provides a function to add a shadow actor to a window preview in the overview. */

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Graphene from 'gi://Graphene';

import {overview} from 'resource:///org/gnome/shell/ui/main.js';

import {states} from '../manager/window_state.js';
import {OVERVIEW_SHADOW_ACTOR, SHADOW_PADDING} from '../utils/constants.js';
import {logDebug} from '../utils/log.js';

/**
 * What was added to each window preview, so it can be removed again when
 * the preview goes away or the extension is disabled.
 *
 * @typedef {object} PreviewExtras
 * @property {Clutter.Clone} clone - The shadow clone.
 * @property {GObject.Binding[]} bindings - Scale bindings to the clone.
 */

/** @type {Map<object, PreviewExtras>} */
const previews = new Map();

/**
 * Add a shadow actor to a window preview in the overview.
 *
 * @param {import('gi://Meta').default.Window} window - The window that the preview is of.
 * @param {import('resource:///org/gnome/shell/ui/windowPreview.js').WindowPreview} self - The window preview that the shadow actor is added to.
 */
export function addShadowInOverview(window, self) {
    // Skip attached dialogs — they are added via _updateAttachedDialogs/addDialog
    // and should not get their own shadow clone in the overview.
    // We detect them by checking if the window is transient-for another window,
    // which is always the case for attached dialogs but not for top-level windows.
    if (window.get_transient_for() !== null || previews.has(self)) {
        return;
    }

    // If the original window doesn't have rounded corners or a shadow,
    // we don't need to do anything, so we can skip it.
    const state = states.get(window.get_compositor_private());
    const shadow = state?.effect ? state.shadow : null;
    if (!shadow) {
        return;
    }

    logDebug(() => `Adding shadow for ${window.wmClass} in overview`);

    // windowContainer has the actual contents of the window preview
    const windowContainer = self.windowContainer;

    // Create a clone of the window's shadow actor and add it to the preview
    const clone = new OverviewShadowActorClone(shadow, self);
    const bindings = [
        windowContainer.bind_property('scale-x', clone, 'scale-x', 1),
        windowContainer.bind_property('scale-y', clone, 'scale-y', 1),
    ];
    self.insert_child_below(clone, windowContainer);

    previews.set(self, {clone, bindings});
    self.connectObject('destroy', () => removeFromPreview(self), previews);
}

/** Remove the shadows and filters from all overview previews. */
export function removeOverviewShadows() {
    for (const preview of [...previews.keys()]) removeFromPreview(preview);
}

/**
 * Remove what {@link addShadowInOverview} added to a preview.
 *
 * @param {object} preview - The window preview.
 */
function removeFromPreview(preview) {
    const extras = previews.get(preview);
    if (!extras) return;
    previews.delete(preview);
    preview.disconnectObject(previews);

    for (const binding of extras.bindings) binding.unbind();
    extras.clone.destroy();
}

/**
 * A clone of a window's shadow actor that is shown in the overview. Binds the
 * size of the shadow to the size of the window preview in the overview.
 */
const OverviewShadowActorClone = GObject.registerClass(
    {GTypeName: 'RwcUltimateOverviewShadowClone'},
    class extends Clutter.Clone {
        /** @type {import('resource:///org/gnome/shell/ui/windowPreview.js').WindowPreview} */
        windowPreview;

        /**
         * Create the clone of the shadow actor.
         *
         * @param {import('gi://St').default.Bin} source - The shadow actor to clone.
         * @param {import('resource:///org/gnome/shell/ui/windowPreview.js').WindowPreview} windowPreview - The window preview that the clone is applied to.
         */
        constructor(source, windowPreview) {
            super({
                source, // the source shadow actor shown in desktop
                name: OVERVIEW_SHADOW_ACTOR,
                pivotPoint: new Graphene.Point({x: 0.5, y: 0.5}),
            });

            this.windowPreview = windowPreview;
        }

        /**
         * Recompute the position and size of shadow in overview
         * This virtual function will be called when we:
         * - entering/closing overview
         * - dragging window
         * - position and size of window preview in overview changed
         *
         * @param {Clutter.ActorBox} box - The bound box of shadow actor
         */
        vfunc_allocate(box) {
            // The layout box of the window has to be obtained in a different
            // way when leaving the overview (eg. by pressing ESC). I have no
            // idea why this is the case, but oh well. GNOME.
            const leavingOverview =
                overview._overview.controls._workspacesDisplay._leavingOverview;
            const windowContainerBox = leavingOverview
                ? this.windowPreview.windowContainer.get_allocation_box()
                : this.windowPreview.get_allocation_box();

            // A window that was just opened can have no frame yet. Dividing by
            // its width would put NaN into the allocation, so give the shadow
            // an empty allocation until the window has a size.
            const metaWindow =
                this.windowPreview._windowActor.get_meta_window();
            const frameWidth = metaWindow?.get_frame_rect().width ?? 0;
            if (frameWidth <= 0) {
                box.set_origin(0, 0);
                box.set_size(0, 0);
                super.vfunc_allocate(box);
                return;
            }

            // Scale the shadow by the same scale factor that the window preview
            // is scaled by.
            const containerScaleFactor =
                windowContainerBox.get_width() / frameWidth;
            const paddings = SHADOW_PADDING * containerScaleFactor;

            // Setup the bounding box of the shadow actor.
            box.set_origin(-paddings, -paddings);
            box.set_size(
                windowContainerBox.get_width() + 2 * paddings,
                windowContainerBox.get_height() + 2 * paddings,
            );

            // Apply the bounding box.
            super.vfunc_allocate(box);
        }
    },
);
