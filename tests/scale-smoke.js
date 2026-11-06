// Automation script for tests/run-smoke.sh: a window that first shows at
// 150 % has its shadow. St's border-image lost it when it loaded the image
// above 100 %, see extension/effect/shadow_actor.js. Needs a 1920x1080
// monitor.

import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

import {setScale} from './display.js';
import {ok as check} from './harness.js';

/** @returns {Promise<GdkPixbuf.Pixbuf>} The whole stage. */
async function screenshot() {
    const stream = Gio.MemoryOutputStream.new_resizable();
    const {width, height} = global.stage;
    await new Shell.Screenshot().screenshot_area(0, 0, width, height, stream);
    stream.close(null);
    const input = Gio.MemoryInputStream.new_from_bytes(stream.steal_as_bytes());
    return GdkPixbuf.Pixbuf.new_from_stream(input, null);
}

export async function run() {
    if (!(await setScale(1.5))) {
        print('RWC_SKIP 150 % needs a larger virtual monitor');
        print('RWC_SMOKE_PASS');
        return;
    }
    const background = new Gio.Settings({
        schema_id: 'org.gnome.desktop.background',
    });
    background.set_string('picture-options', 'none');
    background.set_string('color-shading-type', 'solid');
    background.set_string('primary-color', '#c0c0c0');

    const root = GLib.getenv('RWC_TEST_EXTENSION');
    const file = Gio.File.new_for_path(`${root}/metadata.json`);
    const [, bytes] = file.load_contents(null);
    const metadata = JSON.parse(new TextDecoder().decode(bytes));
    const {default: Extension} = await import(`file://${root}/extension.js`);
    const extension = new Extension({
        ...metadata,
        path: root,
        dir: Gio.File.new_for_path(root),
    });
    extension.enable();
    Main.overview.hide();

    await Scripting.createTestWindow({width: 400, height: 300});
    await Scripting.waitTestWindows();
    await Scripting.sleep(600);
    const [win] = global.get_window_actors().map(a => a.metaWindow);
    win.move_frame(false, 200, 200);
    Main.activateWindow(win);
    await Scripting.sleep(1000);

    // Physical pixels, 1.5 per window pixel.
    const frame = win.get_frame_rect();
    const image = await screenshot();
    const pixels = image.get_pixels();
    const y = Math.round((frame.y + frame.height / 2) * 1.5);
    const at = x =>
        pixels[y * image.get_rowstride() + Math.round(x * 1.5) * image.get_n_channels()];
    const ground = at(frame.x - 60);
    for (const d of [2, 5, 10]) {
        const value = at(frame.x - d);
        check(
            value < ground - 3,
            `No shadow ${d} px left of the window at 150 % (${value} on ${ground})`,
        );
    }

    extension.disable();
    await Scripting.destroyTestWindows();
    print('RWC_SMOKE_PASS');
}
