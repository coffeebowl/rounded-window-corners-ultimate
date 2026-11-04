// Tests for the update queue in extension/manager/window_state.js.
//
// Based on the scenarios in tests/event_manager.test.mjs from
// a1c7e0/rounded-window-corners, rewritten for gjs -m and the new structure.

import {
    FOCUS,
    GEOMETRY,
    SETTINGS,
    STATE,
    createState,
    dropState,
    queueUpdate,
    queueUpdateAll,
    startUpdates,
    states,
    stopUpdates,
    whenAlive,
} from '../extension/manager/window_state.js';
import {equal, ok, run, settle, test} from './harness.js';

/**
 * A fake for the BEFORE_REDRAW laters: functions wait until `frame()` runs
 * them, like Mutter does before the next frame.
 */
function fakeUpdater() {
    const pending = new Map();
    let nextId = 1;
    /** @type {{state: object, bits: number}[]} */
    const flushes = [];
    const updater = {
        add(fn) {
            const id = nextId++;
            pending.set(id, fn);
            return id;
        },
        remove(id) {
            pending.delete(id);
        },
        flush(state, bits) {
            flushes.push({state, bits});
            updater.onFlush?.(state, bits);
        },
        onFlush: null,
    };
    return {
        updater,
        flushes,
        pending,
        /** Run everything that was queued before this frame. */
        frame() {
            const due = [...pending];
            pending.clear();
            for (const [, fn] of due) fn();
        },
    };
}

/** Start with a clean module state for each test. */
function setup() {
    stopUpdates();
    for (const state of [...states.values()]) dropState(state);
    const fake = fakeUpdater();
    startUpdates(fake.updater);
    const state = createState({name: 'actor'}, {name: 'win'});
    return {fake, state};
}

test('bundles a burst of signals into one update', () => {
    const {fake, state} = setup();
    queueUpdate(state, GEOMETRY);
    queueUpdate(state, GEOMETRY);
    queueUpdate(state, FOCUS);
    queueUpdate(state, GEOMETRY);
    equal(fake.pending.size, 1, 'one scheduled update');
    fake.frame();
    equal(fake.flushes.length, 1, 'one flush');
    equal(fake.flushes[0].bits, GEOMETRY | FOCUS);
    equal(state.dirty, 0);
});

test('runs one update per frame during a long resize', () => {
    const {fake, state} = setup();
    for (let frame = 0; frame < 5; frame++) {
        for (let signal = 0; signal < 4; signal++)
            queueUpdate(state, GEOMETRY);
        fake.frame();
    }
    equal(fake.flushes.length, 5);
});

test('a change during an update is handled in the next frame', () => {
    const {fake, state} = setup();
    fake.updater.onFlush = (s, bits) => {
        if (bits & STATE) queueUpdate(s, GEOMETRY);
    };
    queueUpdate(state, STATE);
    fake.frame();
    equal(fake.flushes.length, 1, 'not run again within the same frame');
    fake.frame();
    equal(fake.flushes.length, 2);
    equal(fake.flushes[1].bits, GEOMETRY);
});

test('a window destroyed before its update is not touched', () => {
    const {fake, state} = setup();
    queueUpdate(state, GEOMETRY);
    dropState(state);
    equal(fake.pending.size, 0, 'queued update cancelled');
    fake.frame();
    equal(fake.flushes.length, 0);
    ok(!states.has(state.actor));
    queueUpdate(state, GEOMETRY);
    equal(fake.pending.size, 0, 'no new updates after destroy');
});

test('an update that still fires after destroy does nothing', () => {
    const {fake, state} = setup();
    // A scheduler that cannot cancel, to be safe against races in Mutter.
    fake.updater.remove = () => {};
    queueUpdate(state, GEOMETRY);
    dropState(state);
    fake.frame();
    equal(fake.flushes.length, 0);
});

test('disable cancels queued updates and ignores old ones', () => {
    const {fake, state} = setup();
    queueUpdate(state, GEOMETRY);
    stopUpdates();
    equal(fake.pending.size, 0);
    queueUpdate(state, GEOMETRY);
    equal(fake.pending.size, 0, 'nothing queued while disabled');

    const next = fakeUpdater();
    startUpdates(next.updater);
    queueUpdate(state, SETTINGS);
    next.frame();
    equal(next.flushes.length, 1);
    equal(next.flushes[0].bits, GEOMETRY | SETTINGS, 'kept earlier changes');
    equal(fake.flushes.length, 0, 'old updater never flushed');
});

test('queueUpdateAll reaches every window once', () => {
    const {fake, state} = setup();
    const other = createState({name: 'other'}, {name: 'win2'});
    queueUpdate(state, FOCUS);
    queueUpdateAll(SETTINGS);
    fake.frame();
    equal(fake.flushes.length, 2);
    equal(
        fake.flushes.map(f => f.bits).sort(),
        [SETTINGS, FOCUS | SETTINGS].sort(),
    );
    dropState(other);
});

test('async results arrive for live windows', async () => {
    const {state} = setup();
    let result = null;
    await whenAlive(state, Promise.resolve('Other'), value => {
        result = value;
    });
    equal(result, 'Other');
});

test('async results for a destroyed window are dropped', async () => {
    const {state} = setup();
    let called = false;
    let finish;
    const work = new Promise(resolve => (finish = resolve));
    const done = whenAlive(state, work, () => (called = true));
    dropState(state);
    finish('Other');
    await done;
    ok(!called);
});

test('async results from before a disable are dropped', async () => {
    const {state} = setup();
    let called = false;
    let finish;
    const work = new Promise(resolve => (finish = resolve));
    const done = whenAlive(state, work, () => (called = true));
    stopUpdates();
    startUpdates(fakeUpdater().updater);
    finish('Other');
    await done;
    await settle();
    ok(!called, 'result from the old generation ignored');
});

await run('window_state.test.js');
