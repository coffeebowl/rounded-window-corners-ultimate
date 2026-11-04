// Tests for findInFile in extension/utils/file.js.

import GLib from 'gi://GLib';

import {findInFile} from '../extension/utils/file.js';
import {equal, run, test} from './harness.js';

/**
 * Write a temporary file and return its path.
 *
 * @param {string} contents
 * @returns {string}
 */
function tempFile(contents) {
    const [fd, path] = GLib.file_open_tmp('rwc-test-XXXXXX');
    GLib.close(fd);
    GLib.file_set_contents(path, contents);
    return path;
}

const MARKERS = ['libhandy-1.so', 'libadwaita-1.so', '/dev/shm/.org.chromium.Chromium'];

test('finds a marker', async () => {
    const path = tempFile('a\nb /usr/lib64/libadwaita-1.so.0\nc\n');
    equal(await findInFile(path, MARKERS), 'libadwaita-1.so');
    GLib.unlink(path);
});

test('returns null without a marker', async () => {
    const path = tempFile('nothing to see here\n'.repeat(1000));
    equal(await findInFile(path, MARKERS), null);
    GLib.unlink(path);
});

test('returns the marker that comes first in the file', async () => {
    const path = tempFile('x libadwaita-1.so\ny libhandy-1.so\n');
    equal(await findInFile(path, MARKERS), 'libadwaita-1.so');
    GLib.unlink(path);
});

test('finds a marker across chunk borders', async () => {
    const filler = 'x'.repeat(10);
    const path = tempFile(`${filler}/dev/shm/.org.chromium.Chromium.abc\n`);
    // Chunks of 7 bytes split the marker over several reads.
    equal(
        await findInFile(path, MARKERS, 7),
        '/dev/shm/.org.chromium.Chromium',
    );
    GLib.unlink(path);
});

test('reads /proc maps of a process', async () => {
    equal(await findInFile('/proc/self/maps', ['libgjs']), 'libgjs');
});

await run('file.test.js');
