/**
 * @file Connects the widgets for rounded corner settings to a settings
 * object. Shared by the general page and the rows of the custom page.
 */

import Gdk from 'gi://Gdk';

/**
 * The widgets that edit one {@link RoundedCornerSettings} object.
 *
 * @typedef {object} CornerWidgets
 * @property {import('gi://Gtk').default.ColorDialogButton} borderColor
 * @property {import('gi://Gtk').default.Adjustment} cornerRadius
 * @property {import('gi://Gtk').default.Adjustment} cornerSmoothing
 * @property {import('gi://Adw').default.SwitchRow} keepForMaximized
 * @property {import('gi://Adw').default.SwitchRow} keepForFullscreen
 * @property {import('./widgets/paddings_row.js').PaddingsRowClass} paddings
 * @property {import('gi://Adw').default.SwitchRow} [enabled] - Only for
 *   custom settings.
 */

/** @typedef {import('../utils/types.js').RoundedCornerSettings} RoundedCornerSettings */

/** Padding sides and the matching properties of the paddings row. */
const PADDINGS = [
    ['top', 'padding-top', 'paddingTop'],
    ['bottom', 'padding-bottom', 'paddingBottom'],
    ['left', 'padding-start', 'paddingStart'],
    ['right', 'padding-end', 'paddingEnd'],
];

/**
 * Write changes of the widgets into the settings object returned by
 * `getCfg` and save them.
 *
 * @param {CornerWidgets} widgets - The widgets to connect.
 * @param {() => RoundedCornerSettings | undefined} getCfg - The settings
 *   object to edit. Widgets do nothing while it returns undefined.
 * @param {() => void} save - Stores the edited settings.
 * @returns {() => void} Shows the current values of `getCfg()` in the
 *   widgets, without saving them again. Already called once.
 */
export function bindCornerSettings(widgets, getCfg, save) {
    let loading = false;

    /**
     * @param {import('gi://GObject').default.Object} widget
     * @param {string} signal
     * @param {(cfg: RoundedCornerSettings) => void} apply
     */
    const onChange = (widget, signal, apply) =>
        widget.connect(signal, () => {
            const cfg = getCfg();
            if (loading || !cfg) return;
            apply(cfg);
            save();
        });

    onChange(widgets.borderColor, 'notify::rgba', cfg => {
        const {red, green, blue, alpha} = widgets.borderColor.rgba;
        cfg.borderColor = [red, green, blue, alpha];
    });
    onChange(widgets.cornerRadius, 'value-changed', cfg => {
        cfg.borderRadius = widgets.cornerRadius.value;
    });
    onChange(widgets.cornerSmoothing, 'value-changed', cfg => {
        cfg.smoothing = widgets.cornerSmoothing.value;
    });
    onChange(widgets.keepForMaximized, 'notify::active', cfg => {
        cfg.keepRoundedCorners.maximized = widgets.keepForMaximized.active;
    });
    onChange(widgets.keepForFullscreen, 'notify::active', cfg => {
        cfg.keepRoundedCorners.fullscreen = widgets.keepForFullscreen.active;
    });
    for (const [side, property, accessor] of PADDINGS) {
        onChange(widgets.paddings, `notify::${property}`, cfg => {
            cfg.padding[side] = widgets.paddings[accessor];
        });
    }
    if (widgets.enabled) {
        onChange(widgets.enabled, 'notify::active', cfg => {
            cfg.enabled = widgets.enabled.active;
        });
    }

    const load = () => {
        const cfg = getCfg();
        if (!cfg) return;

        loading = true;
        try {
            const color = new Gdk.RGBA();
            [color.red, color.green, color.blue, color.alpha] = cfg.borderColor;
            widgets.borderColor.rgba = color;
            widgets.cornerRadius.value = cfg.borderRadius;
            widgets.cornerSmoothing.value = cfg.smoothing;
            widgets.keepForMaximized.active = cfg.keepRoundedCorners.maximized;
            widgets.keepForFullscreen.active =
                cfg.keepRoundedCorners.fullscreen;
            for (const [side, , accessor] of PADDINGS)
                widgets.paddings[accessor] = cfg.padding[side];
            if (widgets.enabled) widgets.enabled.active = cfg.enabled;
        } finally {
            loading = false;
        }
    };
    load();
    return load;
}
