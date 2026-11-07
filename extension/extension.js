import {
    Extension,
    InjectionManager,
} from 'resource:///org/gnome/shell/extensions/extension.js';
import {layoutManager} from 'resource:///org/gnome/shell/ui/main.js';
import {SwitcherPopup} from 'resource:///org/gnome/shell/ui/switcherPopup.js';
import {WorkspaceAnimationController} from 'resource:///org/gnome/shell/ui/workspaceAnimation.js';

import {
    disableEffect,
    enableEffect,
    setCoverageAllowed,
} from './manager/event_manager.js';
import {logDebug} from './utils/log.js';
import {initSettings, uninitSettings} from './utils/settings.js';

export default class RoundedWindowCornersUltimate extends Extension {
    // The extension works by overriding (monkey patching) the code of GNOME
    // Shell's internal methods. InjectionManager is a convenience class that
    // stores references to the original methods and allows to easily restore
    // them when the extension is disabled.
    /** @type {InjectionManager | null} */
    #injectionManager = null;

    enable() {
        initSettings(this.getSettings());

        this.#injectionManager = new InjectionManager();

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

        // Windows of two workspaces are visible during a workspace switch,
        // so pausing covered windows is off meanwhile.
        this.#injectionManager.overrideMethod(
            WorkspaceAnimationController.prototype,
            '_prepareWorkspaceSwitch',
            prepareWorkspaceSwitch =>
                function (workspaceIndices) {
                    setCoverageAllowed('workspace-switch', false);
                    prepareWorkspaceSwitch.call(this, workspaceIndices);
                },
        );
        this.#injectionManager.overrideMethod(
            WorkspaceAnimationController.prototype,
            '_finishWorkspaceSwitch',
            finishWorkspaceSwitch =>
                function (switchData) {
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

        // In case the shell is still starting up.
        layoutManager.disconnectObject(this);
        disableEffect();

        logDebug('Disabled');

        uninitSettings();
    }
}
