import {
    Extension,
    InjectionManager,
} from 'resource:///org/gnome/shell/extensions/extension.js';
import {layoutManager} from 'resource:///org/gnome/shell/ui/main.js';
import {SwitcherPopup} from 'resource:///org/gnome/shell/ui/switcherPopup.js';
import {WindowPreview} from 'resource:///org/gnome/shell/ui/windowPreview.js';
import {WorkspaceAnimationController} from 'resource:///org/gnome/shell/ui/workspaceAnimation.js';

import {
    disableEffect,
    enableEffect,
    setCoverageAllowed,
} from './manager/event_manager.js';
import {
    addShadowInOverview,
    removeOverviewShadows,
} from './patch/add_shadow_in_overview.js';
import {
    addShadowsInWorkspaceSwitch,
    removeShadowsAfterWorkspaceSwitch,
    removeWorkspaceShadows,
} from './patch/workspace_switch.js';
import {logDebug} from './utils/log.js';
import {initPrefs, uninitPrefs} from './utils/settings.js';
import {WindowPicker} from './window_picker/service.js';

export default class RoundedWindowCornersUltimate extends Extension {
    // The extension works by overriding (monkey patching) the code of GNOME
    // Shell's internal methods. InjectionManager is a convenience class that
    // stores references to the original methods and allows to easily restore
    // them when the extension is disabled.
    /** @type {InjectionManager | null} */
    #injectionManager = null;

    /** @type {WindowPicker | null} */
    #windowPicker = null;

    enable() {
        // Initialize extension preferences
        initPrefs(this.getSettings());

        this.#injectionManager = new InjectionManager();

        // Export the d-bus interface of the window picker in preferences.
        // See the readme in the `window_picker` directory for more information.
        this.#windowPicker = new WindowPicker();
        this.#windowPicker.export();

        if (layoutManager._startingUp) {
            // Wait for GNOME Shell to be ready before enabling rounded corners
            layoutManager.connectObject(
                'startup-complete',
                () => {
                    layoutManager.disconnectObject(this);
                    enableEffect();
                },
                this,
            );
        } else {
            enableEffect();
        }

        // WindowPreview is a widget that shows a window in the overview.
        // We need to override its `_addWindow` method to add a shadow actor
        // to the preview, otherwise overview windows won't have custom
        // shadows.
        this.#injectionManager.overrideMethod(
            WindowPreview.prototype,
            '_addWindow',
            addWindow =>
                function (window) {
                    addWindow.call(this, window);
                    addShadowInOverview(window, this);
                },
        );

        // The same way we applied a cloned shadow actor to window previews in
        // the overview, we also need to apply it to windows during workspace
        // switching.
        this.#injectionManager.overrideMethod(
            WorkspaceAnimationController.prototype,
            '_prepareWorkspaceSwitch',
            prepareWorkspaceSwitch =>
                function (workspaceIndices) {
                    // Windows of two workspaces are visible during the switch.
                    setCoverageAllowed('workspace-switch', false);
                    prepareWorkspaceSwitch.call(this, workspaceIndices);
                    addShadowsInWorkspaceSwitch(this);
                },
        );
        this.#injectionManager.overrideMethod(
            WorkspaceAnimationController.prototype,
            '_finishWorkspaceSwitch',
            finishWorkspaceSwitch =>
                function (switchData) {
                    removeShadowsAfterWorkspaceSwitch(this);
                    finishWorkspaceSwitch.call(this, switchData);
                    setCoverageAllowed('workspace-switch', true);
                },
        );

        // Alt+Tab and the other switchers show clones of windows. A paused
        // window would show square corners there, so pausing is off while
        // a switcher is open.
        this.#injectionManager.overrideMethod(
            SwitcherPopup.prototype,
            'show',
            show =>
                function (...args) {
                    setCoverageAllowed('switcher', false);
                    return show.call(this, ...args);
                },
        );
        this.#injectionManager.overrideMethod(
            SwitcherPopup.prototype,
            '_onDestroy',
            onDestroy =>
                function (...args) {
                    setCoverageAllowed('switcher', true);
                    return onDestroy.call(this, ...args);
                },
        );

        logDebug('Enabled');
    }

    disable() {
        // Restore patched methods
        this.#injectionManager?.clear();
        this.#injectionManager = null;

        // Remove shadows that were added to overview previews and workspace
        // switch clones, in case the extension is disabled while they exist.
        removeOverviewShadows();
        removeWorkspaceShadows();

        this.#windowPicker?.unexport();
        this.#windowPicker = null;

        // In case the shell is still starting up.
        layoutManager.disconnectObject(this);
        disableEffect();

        logDebug('Disabled');

        uninitPrefs();
    }
}
