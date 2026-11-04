/**
 * @file Provides wrappers around the GSettings object that add type safety and
 * automatically convert values between JS types and GLib Variant types that
 * are used for storing GSettings.
 */

import GLib from 'gi://GLib';

/**
 * Mapping of schema keys to the JS representation of their type.
 *
 * @typedef {object} SchemaType
 * @property {number} settings-version
 * @property {string[]} blacklist
 * @property {boolean} whitelist
 * @property {boolean} skip-libadwaita-app
 * @property {boolean} skip-libhandy-app
 * @property {number} border-width
 * @property {import('./types.js').RoundedCornerSettings} global-rounded-corner-settings
 * @property {import('./types.js').CustomRoundedCornerSettings} custom-rounded-corner-settings
 * @property {import('./types.js').BoxShadow} focused-shadow
 * @property {import('./types.js').BoxShadow} unfocused-shadow
 * @property {boolean} keep-shadow-for-maximized-fullscreen
 * @property {boolean} debug-mode
 * @property {boolean} tweak-kitty-terminal
 */

/**
 * All existing schema keys.
 *
 * @typedef {keyof SchemaType} SchemaKey
 */

/** Mapping of schema keys to their GLib Variant type string */
export const Schema = {
    'settings-version': 'u',
    blacklist: 'as',
    whitelist: 'b',
    'skip-libadwaita-app': 'b',
    'skip-libhandy-app': 'b',
    'border-width': 'i',
    'global-rounded-corner-settings': 'a{sv}',
    'custom-rounded-corner-settings': 'a{sv}',
    'focused-shadow': 'a{si}',
    'unfocused-shadow': 'a{si}',
    'keep-shadow-for-maximized-fullscreen': 'b',
    'debug-mode': 'b',
    'tweak-kitty-terminal': 'b',
};

/**
 * The raw GSettings object for direct manipulation.
 *
 * @type {import('gi://Gio').default.Settings}
 */
export let prefs;

/**
 * Unpacked values by key. Unpacking a GVariant allocates new objects on
 * every call, and some keys are read on every window update, so values are
 * kept until GSettings reports a change.
 *
 * @type {Map<string, unknown>}
 */
const cache = new Map();

/** Handler ID of the `changed` signal that invalidates {@link cache}. */
let changedId = 0;

/**
 * Initialize the {@link prefs} object with existing GSettings.
 *
 * @param {import('gi://Gio').default.Settings} gSettings - GSettings to initialize the prefs with.
 */
export function initPrefs(gSettings) {
    resetOutdated(gSettings);
    prefs = gSettings;
    cache.clear();
    // Connected before anyone else listens to `changed`, so other handlers
    // already read the new value.
    changedId = prefs.connect('changed', (_settings, key) => cache.delete(key));
}

/** Delete the {@link prefs} object for garbage collection. */
export function uninitPrefs() {
    if (prefs && changedId) prefs.disconnect(changedId);
    changedId = 0;
    cache.clear();
    prefs = null;
}

/**
 * Get a preference from GSettings and convert it from a GLib Variant to a
 * JavaScript type.
 *
 * The value is cached and shared between callers. Do not modify it, copy it
 * first if needed.
 *
 * @template {SchemaKey} K
 * @param {K} key - The key of the preference to get.
 * @returns {SchemaType[K]} The value of the preference.
 */
export function getPref(key) {
    if (!cache.has(key)) {
        cache.set(key, prefs.get_value(key).recursiveUnpack());
    }
    return /** @type {SchemaType[K]} */ (cache.get(key));
}

/**
 * Get a preference as a deep copy that the caller may modify, for example
 * in the preferences window before writing it back with {@link setPref}.
 *
 * @template {SchemaKey} K
 * @param {K} key - The key of the preference to get.
 * @returns {SchemaType[K]} A copy of the value.
 */
export function getPrefCopy(key) {
    return JSON.parse(JSON.stringify(getPref(key)));
}

/**
 * Pack a value into a GLib Variant type and store it in GSettings.
 *
 * @template {SchemaKey} K
 * @param {K} key - The key of the preference to set.
 * @param {SchemaType[K]} value - The value to set the preference to.
 */
export function setPref(key, value) {
    let variant;

    if (key === 'global-rounded-corner-settings') {
        variant = packRoundedCornerSettings(value);
    } else if (key === 'custom-rounded-corner-settings') {
        variant = packCustomRoundedCornerSettings(value);
    } else {
        variant = new GLib.Variant(Schema[key], value);
    }

    prefs.set_value(key, variant);
    // GSettings reports the change as well, but not necessarily right away.
    cache.delete(key);
}

/**
 * A simple wrapper around {@link prefs.bind}.
 *
 * @param {SchemaKey} key - The key to bind.
 * @param {import('gi://GObject').default.Object} object - The object to bind to.
 * @param {string} property - The property of `object` to bind.
 * @param {import('gi://Gio').default.SettingsBindFlags} flags - Binding flags.
 */
export function bindPref(key, object, property, flags) {
    prefs.bind(key, object, property, flags);
}

/**
 * Reset setting keys that changed their type between releases
 * to avoid conflicts.
 *
 * @param {import('gi://Gio').default.Settings} prefs - The GSettings object to clean.
 */
function resetOutdated(prefs) {
    const lastVersion = 9;
    const prefsCurrentVersion = prefs
        .get_user_value('settings-version')
        ?.recursiveUnpack();
    const currentVersion = prefsCurrentVersion ?? 0;

    if (currentVersion < lastVersion) {
        if (currentVersion < 7) {
            if (prefs.list_keys().includes('black-list')) {
                prefs.reset('black-list');
            }
            prefs.reset('global-rounded-corner-settings');
            prefs.reset('custom-rounded-corner-settings');
            if (prefs.list_keys().includes('border-color')) {
                prefs.reset('border-color');
            }
            prefs.reset('focused-shadow');
            prefs.reset('unfocused-shadow');
        }

        if (currentVersion < 8) {
            const roundedCornerSettings = prefs
                .get_value('global-rounded-corner-settings')
                .recursiveUnpack();
            if (roundedCornerSettings.borderRadius === 12) {
                roundedCornerSettings.borderRadius = 15;
                prefs.set_value(
                    'global-rounded-corner-settings',
                    packRoundedCornerSettings(roundedCornerSettings),
                );
            }
        }

        if (currentVersion < 9) {
            if (prefs.list_keys().includes('enable-preferences-entry')) {
                prefs.reset('enable-preferences-entry');
            }
        }

        prefs.set_uint('settings-version', lastVersion);
    }
}

/**
 * Pack rounded corner settings into a GLib Variant object.
 *
 * Since rounded corner settings are stored as a dictionary where the values
 * are of different types, it can't be automatically packed into a variant.
 * Instead, we need to pack each of the values into the correct variant
 * type, and only then pack the entire dictionary into a variant with type
 * "a{sv}" (dictionary with string keys and arbitrary variant values).
 *
 * @param {import('./types.js').RoundedCornerSettings} settings - The rounded corner settings to pack.
 * @returns {GLib.Variant} The packed GLib Variant object.
 */
function packRoundedCornerSettings(settings) {
    const padding = new GLib.Variant('a{su}', settings.padding);
    const keepRoundedCorners = new GLib.Variant(
        'a{sb}',
        settings.keepRoundedCorners,
    );
    const borderRadius = GLib.Variant.new_uint32(settings.borderRadius);
    const smoothing = GLib.Variant.new_double(settings.smoothing);
    const borderColor = new GLib.Variant('(dddd)', settings.borderColor);
    const enabled = GLib.Variant.new_boolean(settings.enabled);

    const variantObject = {
        padding,
        keepRoundedCorners,
        borderRadius,
        smoothing,
        borderColor,
        enabled,
    };

    return new GLib.Variant('a{sv}', variantObject);
}

/**
 * Pack custom rounded corner overrides into a GLib Variant object.
 *
 * Custom rounded corner settings are stored as a dictionary from window
 * wm_class to {@link RoundedCornerSettings} objects. See the documentation for
 * {@link packRoundedCornerSettings} for more information on why manual packing
 * is needed here.
 *
 * @param {import('./types.js').CustomRoundedCornerSettings} settings - The custom rounded corner setting overrides to pack.
 * @returns {GLib.Variant} The packed GLib Variant object.
 */
function packCustomRoundedCornerSettings(settings) {
    /** @type {Record<string, GLib.Variant>} */
    const packedSettings = {};
    for (const [wmClass, windowSettings] of Object.entries(settings)) {
        packedSettings[wmClass] = packRoundedCornerSettings(windowSettings);
    }

    const variant = new GLib.Variant('a{sv}', packedSettings);
    return variant;
}
