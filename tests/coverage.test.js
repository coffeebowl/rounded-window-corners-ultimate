// Tests for findCovered in extension/manager/coverage.js.

import {findCovered} from '../extension/manager/coverage.js';
import {equal, run, test} from './harness.js';

/**
 * Build a stack entry.
 *
 * @param {string} key
 * @param {object} [options]
 */
function win(key, {visible = true, inside = 0, covers = null} = {}) {
    return {key, visible, insideMonitor: inside, coversMonitor: covers};
}

/** @param {Set<string>} set */
const sorted = set => [...set].sort();

test('windows below a fullscreen window are covered', () => {
    const stack = [win('game', {covers: 0}), win('editor'), win('browser')];
    equal(sorted(findCovered(stack)), ['browser', 'editor']);
});

test('the covering window itself is not covered', () => {
    const stack = [win('game', {covers: 0})];
    equal(sorted(findCovered(stack)), []);
});

test('windows above the covering window stay visible', () => {
    const stack = [win('dialog'), win('game', {covers: 0}), win('editor')];
    equal(sorted(findCovered(stack)), ['editor']);
});

test('nothing is covered without a covering window', () => {
    const stack = [win('a'), win('b'), win('c')];
    equal(sorted(findCovered(stack)), []);
});

test('only windows on the covered monitor are covered', () => {
    const stack = [
        win('game', {inside: 0, covers: 0}),
        win('left', {inside: 0}),
        win('right', {inside: 1}),
    ];
    equal(sorted(findCovered(stack)), ['left']);
});

test('windows spanning two monitors are never covered', () => {
    const stack = [win('game', {covers: 0}), win('wide', {inside: null})];
    equal(sorted(findCovered(stack)), []);
});

test('a hidden covering window covers nothing', () => {
    const stack = [win('game', {covers: 0, visible: false}), win('editor')];
    equal(sorted(findCovered(stack)), []);
});

test('hidden windows are not reported as covered', () => {
    const stack = [win('game', {covers: 0}), win('minimized', {visible: false})];
    equal(sorted(findCovered(stack)), []);
});

test('a covered window that would cover counts as well', () => {
    const stack = [
        win('game', {covers: 0}),
        win('video', {covers: 0}),
        win('editor'),
    ];
    equal(sorted(findCovered(stack)), ['editor', 'video']);
});

test('two monitors with a fullscreen window each', () => {
    const stack = [
        win('game', {inside: 0, covers: 0}),
        win('video', {inside: 1, covers: 1}),
        win('a', {inside: 0}),
        win('b', {inside: 1}),
    ];
    equal(sorted(findCovered(stack)), ['a', 'b']);
});

await run('coverage.test.js');
