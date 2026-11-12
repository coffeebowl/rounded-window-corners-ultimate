// Tests for extension/manager/app_detection.js.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {
    detectApp,
    OTHER_APP,
    releaseApp,
} from '../extension/manager/app_detection.js';
import {equal, ok, run, test} from './harness.js';

const ownPid = Gio.Credentials.new().get_unix_pid();

/** Larger than any PID Linux hands out (`pid_max` is at most 2^22). */
const NO_PID = 2 ** 22 + 1;

test('windows of one process share one read', () => {
    const first = detectApp(ownPid, 'first');
    const second = detectApp(ownPid, 'second');
    ok(first === second, 'the second window has to get the same promise');

    // The result stays while one window of the process is left.
    releaseApp(ownPid);
    ok(detectApp(ownPid, 'third') === first, 'one window was still left');
    releaseApp(ownPid);
    releaseApp(ownPid);
});

test('the next window after the last one reads again', () => {
    const before = detectApp(ownPid, 'before');
    releaseApp(ownPid);
    const after = detectApp(ownPid, 'after');
    ok(after !== before, 'the PID may belong to another process by now');
    releaseApp(ownPid);
});

test('unreadable and gone processes are other apps, without an error', async () => {
    /** @type {string[]} */
    const errors = [];
    GLib.log_set_writer_func((level, fields) => {
        if (level <= GLib.LogLevelFlags.LEVEL_WARNING)
            errors.push(new TextDecoder().decode(fields.MESSAGE));
        return GLib.LogWriterOutput.HANDLED;
    });
    try {
        // PID 1 belongs to root, or in a container may be readable.
        for (const pid of [1, NO_PID]) {
            equal(await detectApp(pid, `pid ${pid}`), OTHER_APP, `PID ${pid}`);
            releaseApp(pid);
        }
    } finally {
        GLib.log_set_writer_default();
    }
    equal(errors, [], 'logged errors');
});

test('a process with libadwaita loaded is a libadwaita app', async () => {
    let Adw;
    try {
        ({default: Adw} = await import('gi://Adw?version=1'));
    } catch {
        print('skip  app_detection.test.js: libadwaita is not installed');
        return;
    }
    // GJS loads the library on the first call.
    Adw.get_major_version();
    const app = await detectApp(ownPid, 'own process');
    releaseApp(ownPid);
    equal(app, {libadwaita: true, chromium: false});
});

await run('app_detection.test.js');
