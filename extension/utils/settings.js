/**
 * @file Holds the few settings while the extension is enabled. Values are
 * read once and again only when GSettings reports a change, since some are
 * needed on every window update.
 */

/** @type {import('gi://Gio').default.Settings | null} */
export let settings = null;

/** Current values, see {@link readAll}. */
const values = {debugMode: false, focusBorderWidth: 0};

/** ID of the `changed` handler on {@link settings}. */
let changedId = 0;

/** Read all values from {@link settings}. */
function readAll() {
    values.debugMode = settings.get_boolean('debug-mode');
    values.focusBorderWidth = settings.get_boolean('focus-border')
        ? settings.get_int('focus-border-width')
        : 0;
}

/**
 * Start using the extension's settings.
 *
 * @param {import('gi://Gio').default.Settings} gSettings - The settings.
 */
export function initSettings(gSettings) {
    settings = gSettings;
    readAll();
    // Connected before anyone else listens to `changed`, so other handlers
    // already see the new values.
    changedId = settings.connect('changed', () => readAll());
}

/** Stop using the settings, for garbage collection. */
export function uninitSettings() {
    if (changedId) settings?.disconnect(changedId);
    changedId = 0;
    settings = null;
    values.debugMode = false;
    values.focusBorderWidth = 0;
}

/**
 * @returns {boolean} Whether debug messages go to the journal. Only set
 *   with gsettings, it has no place in the preferences window.
 */
export function debugMode() {
    return values.debugMode;
}

/**
 * @returns {number} Width of the border that marks the focused window, 0
 *   while it is off.
 */
export function focusBorderWidth() {
    return values.focusBorderWidth;
}
