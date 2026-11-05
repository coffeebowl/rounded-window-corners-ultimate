// Automation script for tests/run-smoke.sh: runs tests/prefs-client.js as a
// Wayland client of the headless shell, since the preferences are a GTK
// app. The client inherits the session's environment and log.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

Gio._promisify(Gio.Subprocess.prototype, 'wait_check_async');

export async function run() {
    const client = GLib.build_filenamev([
        GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]),
        'prefs-client.js',
    ]);
    const proc = Gio.Subprocess.new(['gjs', '-m', client], Gio.SubprocessFlags.NONE);
    await proc.wait_check_async(null);
    print('RWC_SMOKE_PASS');
}
