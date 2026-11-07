// Checks that the fixed values in extension/utils/config.js still match
// `window.csd` in the gtk.css of the installed libadwaita. Skipped if
// libadwaita is not installed.

import Gio from 'gi://Gio';

import * as config from '../extension/utils/config.js';
import {equal, run, test} from './harness.js';

/** @returns {Promise<string | null>} libadwaita's gtk.css, if installed. */
async function loadStylesheet() {
    try {
        const {default: Adw} = await import('gi://Adw?version=1');
        // GJS loads the library, and with it its resources, on the first call.
        Adw.get_major_version();
        const bytes = Gio.resources_lookup_data(
            '/org/gnome/Adwaita/styles/gtk.css',
            Gio.ResourceLookupFlags.NONE,
        );
        return new TextDecoder().decode(bytes.toArray());
    } catch {
        return null;
    }
}

const css = await loadStylesheet();

/**
 * Declarations of the rules with exactly this selector, outside of media
 * queries. gtk.css has one rule per line.
 *
 * @param {string} selector
 * @returns {Map<string, string>}
 */
function declarations(selector) {
    const result = new Map();
    for (const line of css.split('\n')) {
        if (!line.startsWith(`${selector} {`)) continue;
        for (const declaration of line.slice(selector.length + 2).split(';')) {
            const colon = declaration.indexOf(':');
            if (colon < 0) continue;
            result.set(
                declaration.slice(0, colon).trim(),
                declaration.slice(colon + 1).trim(),
            );
        }
    }
    return result;
}

// The parsers below return what does not fit (an offset, another color)
// as the string itself, so the comparison shows it.

/**
 * Parse an `outline` into a border like in config.js.
 *
 * @param {string} value
 */
function border(value) {
    const m = value.match(/^(\d+)px solid RGB\((\d+) (\d+) (\d+)\/(\d+)%\)$/);
    if (!m) return value;
    const [, width, r, g, b, a] = m.map(Number);
    return {width, color: [r / 255, g / 255, b / 255, a / 100]};
}

/**
 * Parse a `box-shadow` into layers like in config.js. Transparent layers
 * only exist for the transition and are left out.
 *
 * @param {string} value
 */
function shadowLayers(value) {
    return value
        .split(/,\s*/)
        .filter(layer => !layer.endsWith(' transparent'))
        .map(layer => {
            const m = layer.match(/^0 0 (\d+)(?:px)? (\d+)px RGB\(0 0 0\/(\d+)%\)$/);
            return m ? {blur: +m[1], spread: +m[2], alpha: m[3] / 100} : layer;
        });
}

if (css) {
    const csd = declarations('window.csd');
    const backdrop = declarations('window.csd:backdrop');

    test('the corner radius matches', () => {
        equal(csd.get('border-radius'), 'var(--window-radius)');
        equal(declarations(':root').get('--window-radius'), `${config.RADIUS}px`);
    });

    test('the border matches', () => {
        equal(border(csd.get('outline')), config.BORDER);
        equal(csd.get('outline-offset'), `-${config.BORDER.width}px`);
    });

    test('the focused shadow matches', () => {
        equal(shadowLayers(csd.get('box-shadow')), config.FOCUSED_SHADOW);
    });

    test('the unfocused shadow matches', () => {
        equal(shadowLayers(backdrop.get('box-shadow')), config.UNFOCUSED_SHADOW);
    });
} else {
    print('skip  adwaita.test.js: libadwaita is not installed');
}

await run('adwaita.test.js');
