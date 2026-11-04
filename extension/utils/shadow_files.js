/**
 * @file Stores rendered shadow images as PNG files, so St can draw them as
 * border images. One file per shadow style, named by a hash of the style,
 * since St caches images by URI for the whole session.
 */

import GdkPixbuf from 'gi://GdkPixbuf';
import GLib from 'gi://GLib';

import {SHADOW_PADDING} from './constants.js';
import {logDebug} from './log.js';
import {renderShadow, shadowKey, shadowLayout} from './shadow_texture.js';

/** @typedef {import('./shadow_texture.js').ShadowStyle} ShadowStyle */

const directory = GLib.build_filenamev([
    GLib.get_user_cache_dir(),
    'rwc-ultimate',
]);

/**
 * Images already written in this session, by style key.
 *
 * @type {Map<string, {uri: string, slice: number}>}
 */
const images = new Map();

/**
 * Get the PNG for a shadow style, rendering it first if needed.
 *
 * Every image reaches {@link SHADOW_PADDING} beyond the window box, so
 * switching between the focused and unfocused shadow does not change the
 * actor's size and St can cross-fade the two.
 *
 * @param {ShadowStyle} style - How the shadow looks.
 * @returns {{uri: string, slice: number}} The file URI and the border
 *   slice to use in CSS.
 */
export function shadowImage(style) {
    const key = shadowKey(style);
    let image = images.get(key);
    if (image) return image;

    const path = GLib.build_filenamev([directory, `shadow-${key}.png`]);
    if (!GLib.file_test(path, GLib.FileTest.EXISTS)) {
        const start = GLib.get_monotonic_time();
        const rendered = renderShadow(style, SHADOW_PADDING);
        GLib.mkdir_with_parents(directory, 0o755);
        const pixbuf = GdkPixbuf.Pixbuf.new_from_bytes(
            new GLib.Bytes(rendered.pixels),
            GdkPixbuf.Colorspace.RGB,
            true,
            8,
            rendered.width,
            rendered.height,
            rendered.width * 4,
        );
        pixbuf.savev(path, 'png', [], []);
        logDebug(
            () =>
                `Rendered shadow ${key} in ${
                    (GLib.get_monotonic_time() - start) / 1000
                } ms`,
        );
    }

    image = {
        uri: GLib.filename_to_uri(path, null),
        slice: shadowLayout(style, SHADOW_PADDING).slice,
    };
    images.set(key, image);
    return image;
}

/**
 * Delete the shadow files of earlier sessions. Images that are needed again
 * are rendered anew, which takes a few milliseconds each.
 */
export function clearShadowImages() {
    images.clear();
    if (!GLib.file_test(directory, GLib.FileTest.IS_DIR)) return;

    const dir = GLib.Dir.open(directory, 0);
    try {
        let name;
        while ((name = dir.read_name()) !== null) {
            if (/^shadow-[0-9a-f]{8}\.png$/.test(name))
                GLib.unlink(GLib.build_filenamev([directory, name]));
        }
    } finally {
        dir.close();
    }
}
