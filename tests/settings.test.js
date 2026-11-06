// Tests for the settings cache in extension/utils/settings.js.

import {
    debugMode,
    focusBorderWidth,
    initSettings,
    settings as current,
    uninitSettings,
} from '../extension/utils/settings.js';
import {equal, ok, run, test} from './harness.js';

/** A stand-in for Gio.Settings that counts reads. */
class FakeSettings {
    constructor(values) {
        this.values = {
            'debug-mode': false,
            'focus-border': false,
            'focus-border-width': 2,
            ...values,
        };
        this.reads = 0;
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

    set(key, value) {
        this.values[key] = value;
        for (const {signal, callback} of this.handlers.values())
            if (signal === 'changed' || signal === `changed::${key}`)
                callback(this, key);
    }

    get_boolean(key) {
        this.reads++;
        return this.values[key];
    }

    get_int(key) {
        this.reads++;
        return this.values[key];
    }
}

test('the focus border width is 0 while the border is off', () => {
    const settings = new FakeSettings({'focus-border-width': 3});
    initSettings(settings);
    equal(focusBorderWidth(), 0);
    settings.set('focus-border', true);
    equal(focusBorderWidth(), 3, 'width once switched on');
    settings.set('focus-border-width', 1);
    equal(focusBorderWidth(), 1, 'new width after a change');
    uninitSettings();
});

test('values are read once, not on every call', () => {
    const settings = new FakeSettings({'focus-border': true});
    initSettings(settings);
    const before = settings.reads;
    for (let i = 0; i < 10; i++) {
        focusBorderWidth();
        debugMode();
    }
    equal(settings.reads, before);
    uninitSettings();
});

test('uninitSettings disconnects and resets the values', () => {
    const settings = new FakeSettings({'focus-border': true, 'debug-mode': true});
    initSettings(settings);
    uninitSettings();
    equal(settings.handlers.size, 0);
    equal(current, null);
    equal(focusBorderWidth(), 0);
    equal(debugMode(), false);
});

test('debug logging builds no message while debug mode is off', async () => {
    const settings = new FakeSettings({});
    initSettings(settings);
    const {logDebug} = await import('../extension/utils/log.js');
    let built = 0;
    for (let i = 0; i < 10; i++) {
        logDebug(() => {
            built++;
            return 'message';
        });
    }
    equal(built, 0);
    uninitSettings();
    logDebug('after uninit does not throw');
    ok(true);
});

await run('settings.test.js');
