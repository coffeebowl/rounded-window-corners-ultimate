/**
 * @file Provides wrappers around the GSettings object that add type safety and
 * automatically convert values between JS types and GLib Variant types that
 * are used for storing GSettings.
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

/**
 * Mapping of schema keys to the JS representation of their type.
 *
 * @typedef {object} SchemaType
 * @property {string[]} blacklist
 * @property {boolean} whitelist
 * @property {boolean} skip-libadwaita-app
 * @property {boolean} skip-libhandy-app
 * @property {number} border-width
 * @property {import('./types.js').RoundedCornerSettings} global-rounded-corner-settings
 * @property {import('./types.js').CustomRoundedCornerSettings} custom-rounded-corner-settings
 * @property {import('./types.js').BoxShadow} focused-shadow
 * @property {import('./types.js').BoxShadow} unfocused-shadow
 * @property {[number, number, number, number] | null} dark-border-color
 * @property {import('./types.js').BoxShadow | null} dark-focused-shadow
 * @property {import('./types.js').BoxShadow | null} dark-unfocused-shadow
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
    blacklist: 'as',
    whitelist: 'b',
    'skip-libadwaita-app': 'b',
    'skip-libhandy-app': 'b',
    'border-width': 'i',
    'global-rounded-corner-settings': 'a{sv}',
    'custom-rounded-corner-settings': 'a{sv}',
    'focused-shadow': 'a{si}',
    'unfocused-shadow': 'a{si}',
    'dark-border-color': 'ad',
    'dark-focused-shadow': 'a{si}',
    'dark-unfocused-shadow': 'a{si}',
    'keep-shadow-for-maximized-fullscreen': 'b',
    'debug-mode': 'b',
    'tweak-kitty-terminal': 'b',
};

/**
 * Keys that only count when they were set, for example with gsettings or
 * dconf-editor. Until then {@link getPref} returns null for them, and the
 * value they override applies. They have no place in the preferences
 * window, since the settings go away once the values are fixed.
 */
const OPTIONAL_KEYS = new Set([
    'dark-border-color',
    'dark-focused-shadow',
    'dark-unfocused-shadow',
]);

/**
 * The raw GSettings object for direct manipulation.
 *
 * @type {Gio.Settings}
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

/**
 * Handler IDs on {@link prefs}: the one that invalidates {@link cache}, then
 * those of {@link connectPref}. All are disconnected by {@link uninitPrefs}.
 *
 * @type {number[]}
 */
const handlerIds = [];

/**
 * Initialize the {@link prefs} object with existing GSettings.
 *
 * @param {import('gi://Gio').default.Settings} gSettings - GSettings to initialize the prefs with.
 */
export function initPrefs(gSettings) {
    prefs = gSettings;
    cache.clear();
    // Connected before anyone else listens to `changed`, so other handlers
    // already read the new value.
    handlerIds.push(
        prefs.connect('changed', (_settings, key) => cache.delete(key)),
    );
}

/** Delete the {@link prefs} object for garbage collection. */
export function uninitPrefs() {
    for (const id of handlerIds) prefs?.disconnect(id);
    handlerIds.length = 0;
    cache.clear();
    prefs = null;
}

/**
 * Run a callback whenever a preference changes, until {@link uninitPrefs}.
 * For the preferences window, which can outlive its settings object.
 *
 * @param {SchemaKey} key - The key to watch.
 * @param {() => void} callback - Runs after the change.
 */
export function connectPref(key, callback) {
    handlerIds.push(prefs.connect(`changed::${key}`, () => callback()));
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
        const variant = OPTIONAL_KEYS.has(key)
            ? prefs.get_user_value(key)
            : prefs.get_value(key);
        cache.set(key, variant ? variant.recursiveUnpack() : null);
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
 * Bind a preference to a property in both directions, see
 * {@link prefs.bind}.
 *
 * @param {SchemaKey} key - The key to bind.
 * @param {import('gi://GObject').default.Object} object - The object to bind to.
 * @param {string} property - The property of `object` to bind.
 */
export function bindPref(key, object, property) {
    prefs.bind(key, object, property, Gio.SettingsBindFlags.DEFAULT);
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
