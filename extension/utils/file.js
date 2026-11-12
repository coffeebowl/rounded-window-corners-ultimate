/** @file Contains utility functions for reading and removing files. */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

// GNOME Shell promisifies some of these itself, load_contents_async only
// as a side effect of loading the login dialog. Do it here, so this module
// works on its own and under `gjs -m`.
Gio._promisify(Gio.File.prototype, 'load_contents_async');
Gio._promisify(Gio.File.prototype, 'read_async');
Gio._promisify(Gio.InputStream.prototype, 'read_bytes_async');
Gio._promisify(Gio.InputStream.prototype, 'close_async');

/**
 * Search a file for the first of several markers, reading it in chunks and
 * stopping at the first match. Cheaper than reading a large file as a whole
 * when the marker comes early.
 *
 * @param {string} path - The file to search.
 * @param {string[]} markers - Plain-text markers to look for.
 * @param {number} [chunkSize] - Bytes to read at a time.
 * @returns {Promise<string | null>} The first marker found, or null.
 */
export async function findInFile(path, markers, chunkSize = 64 * 1024) {
    const stream = await Gio.File.new_for_path(path).read_async(
        GLib.PRIORITY_DEFAULT,
        null,
    );
    const decoder = new TextDecoder('utf-8');
    // Keep the end of the previous chunk, a marker can span two chunks.
    const overlap = Math.max(...markers.map(m => m.length)) - 1;
    let tail = '';

    try {
        for (;;) {
            const bytes = await stream.read_bytes_async(
                chunkSize,
                GLib.PRIORITY_DEFAULT,
                null,
            );
            if (bytes.get_size() === 0) return null;

            // The markers are ASCII, so a multi-byte character split
            // between two chunks cannot hide one.
            const text = tail + decoder.decode(bytes.toArray());
            let first = null;
            let firstIndex = Infinity;
            for (const marker of markers) {
                const index = text.indexOf(marker);
                if (index >= 0 && index < firstIndex) {
                    first = marker;
                    firstIndex = index;
                }
            }
            if (first !== null) return first;
            tail = overlap > 0 ? text.slice(-overlap) : '';
        }
    } finally {
        await stream.close_async(GLib.PRIORITY_DEFAULT, null);
    }
}

/**
 * Read a file relative to the current module.
 *
 * @param {string} module - `import.meta.url` of the current module.
 * @param {string} path - File path relative to the current module.
 * @returns {Promise<string>} Contents of the file as a UTF-8 string.
 */
async function readRelativeFile(module, path) {
    const file = Gio.File.new_for_uri(
        GLib.uri_resolve_relative(module, path, GLib.UriFlags.NONE),
    );
    const [contents] = await file.load_contents_async(null);
    return new TextDecoder('utf-8').decode(contents);
}

/**
 * Read a shader file and split it into declarations and main code, since
 * `Cogl.Snippet.new` takes those parts as two separate arguments
 * (declarations, and the code that runs after the default fragment code).
 *
 * @param {string} module - `import.meta.url` of the current module.
 * @param {string} path - File path relative to the current module.
 * @returns {Promise<[string, string]>} A list containing the declarations as the first element and
 *          contents of the main function as the second.
 */
export async function readShader(module, path) {
    const shader = await readRelativeFile(module, path);
    let [declarations, code] = shader.split(/^.*?main\(\s?\)\s?/m);
    declarations = declarations.trim();
    code = code.trim().replace(/^[{}]/gm, '').trim();
    return [declarations, code];
}

/**
 * Delete the shadow images that versions up to 51.0 kept in the cache
 * directory. The shader draws the shadow now.
 */
export function removeOldShadowFiles() {
    const directory = GLib.build_filenamev([
        GLib.get_user_cache_dir(),
        'rwc-ultimate',
    ]);
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
    GLib.rmdir(directory);
}
