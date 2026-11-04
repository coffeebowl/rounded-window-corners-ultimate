// Tests for the settings cache in extension/utils/settings.js.

import {
    getPref,
    getPrefCopy,
    initPrefs,
    setPref,
    uninitPrefs,
} from '../extension/utils/settings.js';
import {equal, ok, run, test} from './harness.js';

/** A stand-in for Gio.Settings that counts how often values are unpacked. */
class FakeSettings {
    constructor(values) {
        this.values = {'settings-version': 9, ...values};
        this.unpacks = 0;
        this.handlers = new Map();
        this.nextId = 1;
    }

    connect(signal, callback) {
        const id = this.nextId++;
        this.handlers.set(id, {signal, callback});
        return id;
    }

    disconnect(id) {
        this.handlers.delete(id);
    }

    emitChanged(key) {
        for (const {signal, callback} of this.handlers.values())
            if (signal === 'changed') callback(this, key);
    }

    get_user_value(key) {
        return this.get_value(key);
    }

    get_value(key) {
        return {
            recursiveUnpack: () => {
                this.unpacks++;
                return JSON.parse(JSON.stringify(this.values[key]));
            },
        };
    }

    set_value(key, variant) {
        this.values[key] = variant.recursiveUnpack();
    }

    list_keys() {
        return Object.keys(this.values);
    }
}

test('reads each key from GSettings only once', () => {
    const settings = new FakeSettings({'border-width': 2});
    initPrefs(settings);
    const before = settings.unpacks;
    equal(getPref('border-width'), 2);
    equal(getPref('border-width'), 2);
    equal(getPref('border-width'), 2);
    equal(settings.unpacks - before, 1);
    uninitPrefs();
});

test('reads the new value after a changed signal', () => {
    const settings = new FakeSettings({'border-width': 2});
    initPrefs(settings);
    equal(getPref('border-width'), 2);
    settings.values['border-width'] = 5;
    equal(getPref('border-width'), 2, 'still cached before the signal');
    settings.emitChanged('border-width');
    equal(getPref('border-width'), 5);
    uninitPrefs();
});

test('setPref drops the cached value right away', () => {
    const settings = new FakeSettings({'border-width': 2});
    initPrefs(settings);
    equal(getPref('border-width'), 2);
    setPref('border-width', 7);
    equal(getPref('border-width'), 7);
    uninitPrefs();
});

test('getPrefCopy does not change the cached value', () => {
    const settings = new FakeSettings({blacklist: ['a']});
    initPrefs(settings);
    const copy = getPrefCopy('blacklist');
    copy.push('b');
    equal(getPref('blacklist'), ['a']);
    uninitPrefs();
});

test('uninitPrefs disconnects and clears the cache', () => {
    const settings = new FakeSettings({'border-width': 2});
    initPrefs(settings);
    getPref('border-width');
    uninitPrefs();
    equal(settings.handlers.size, 0);

    settings.values['border-width'] = 9;
    initPrefs(settings);
    equal(getPref('border-width'), 9, 'no stale value after re-init');
    uninitPrefs();
});

test('debug logging reads the cached flag', async () => {
    const settings = new FakeSettings({'debug-mode': false});
    initPrefs(settings);
    const {logDebug} = await import('../extension/utils/log.js');
    let built = 0;
    const before = settings.unpacks;
    for (let i = 0; i < 10; i++) {
        logDebug(() => {
            built++;
            return 'message';
        });
    }
    equal(built, 0, 'message not built while debug mode is off');
    ok(settings.unpacks - before <= 1, 'flag unpacked at most once');
    uninitPrefs();
    logDebug('after uninit does not throw');
});

await run('settings.test.js');
