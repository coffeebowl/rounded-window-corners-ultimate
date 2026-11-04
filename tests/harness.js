// A tiny test runner for `gjs -m`, so the unit tests need neither Node nor
// npm. Each test file registers tests with `test()` and calls `run()` at the
// end; the process exits with status 1 if any test failed.

import System from 'system';

/** @type {{name: string, fn: () => unknown}[]} */
const tests = [];

/**
 * Register a test.
 *
 * @param {string} name - Name shown in the output.
 * @param {() => unknown} fn - The test, may be async.
 */
export function test(name, fn) {
    tests.push({name, fn});
}

/**
 * Throw if a value is not truthy.
 *
 * @param {unknown} value
 * @param {string} [message]
 */
export function ok(value, message = 'expected a truthy value') {
    if (!value) throw new Error(message);
}

/**
 * Throw if two values differ, compared as JSON.
 *
 * @param {unknown} actual
 * @param {unknown} expected
 * @param {string} [message]
 */
export function equal(actual, expected, message = '') {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) {
        throw new Error(`${message ? `${message}: ` : ''}expected ${e}, got ${a}`);
    }
}

/** Wait until all pending promise callbacks have run. */
export function settle() {
    return new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * Run all registered tests and exit with the result.
 *
 * @param {string} file - Name of the test file, for the output.
 */
export async function run(file) {
    let failed = 0;
    for (const {name, fn} of tests) {
        try {
            // Tests run one after another on purpose.
            await fn();
            print(`ok    ${file}: ${name}`);
        } catch (e) {
            failed++;
            printerr(`FAIL  ${file}: ${name}\n      ${e.message}`);
        }
    }

    if (failed > 0) {
        printerr(`${failed} of ${tests.length} tests failed in ${file}`);
        System.exit(1);
    }
}
