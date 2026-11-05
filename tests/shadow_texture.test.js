// Tests for the shadow image in extension/utils/shadow_texture.js.

import {renderShadow, shadowKey} from '../extension/utils/shadow_texture.js';
import {equal, ok, run, test} from './harness.js';

const FOCUSED = {
    radius: 15,
    blur: 28,
    spread: 4,
    offsetX: 0,
    offsetY: 4,
    opacity: 60,
};

/** Alpha of a pixel. */
function alphaAt(image, x, y) {
    return image.pixels[(y * image.width + x) * 4 + 3];
}

test('the middle of the window box is transparent', () => {
    const image = renderShadow(FOCUSED);
    const mid = Math.floor(image.width / 2);
    equal(alphaAt(image, mid, mid), 0);
});

test('the shadow is black, also at the edge of the window box', () => {
    const image = renderShadow(FOCUSED);
    for (let i = 0; i < image.pixels.length; i += 4) {
        const rgb = image.pixels[i] + image.pixels[i + 1] + image.pixels[i + 2];
        if (rgb) throw new Error(`light pixel at ${i / 4}`);
    }
});

test('the shadow reaches one pixel under the window edge', () => {
    const image = renderShadow({...FOCUSED, offsetY: 0});
    const mid = Math.floor(image.width / 2);
    ok(alphaAt(image, image.margin, mid) > 0, 'edge pixel');
    equal(alphaAt(image, image.margin + 2, mid), 0, 'further in');
});

test('slices leave a one pixel middle to stretch', () => {
    const image = renderShadow(FOCUSED);
    equal(image.width, image.slice * 2 + 1);
    equal(image.height, image.slice * 2 + 1);
});

test('the shadow is darkest next to the box and fades outwards', () => {
    const image = renderShadow({...FOCUSED, offsetY: 0});
    const mid = Math.floor(image.width / 2);
    const near = alphaAt(image, image.margin - 2, mid);
    const far = alphaAt(image, 1, mid);
    ok(near > far, `near ${near} > far ${far}`);
    ok(near > 0);
});

test('without offset the shadow is symmetric', () => {
    const image = renderShadow({...FOCUSED, offsetY: 0});
    const mid = Math.floor(image.width / 2);
    for (const d of [2, 10, 20]) {
        equal(
            alphaAt(image, image.margin - d, mid),
            alphaAt(image, image.width - 1 - image.margin + d, mid),
            `distance ${d}`,
        );
    }
});

test('a vertical offset makes the bottom darker than the top', () => {
    const image = renderShadow(FOCUSED);
    const mid = Math.floor(image.width / 2);
    const top = alphaAt(image, mid, image.margin - 4);
    const bottom = alphaAt(image, mid, image.height - 1 - image.margin + 4);
    ok(bottom > top, `bottom ${bottom} > top ${top}`);
});

test('the shadow alpha is squared like the old clip shader did', () => {
    // Far from the box, a fully saturated shadow of opacity 50 % ends up
    // at 25 %: a very wide spread keeps the blurred shape at 1 there.
    const image = renderShadow({
        radius: 0,
        blur: 0,
        spread: 20,
        offsetX: 0,
        offsetY: 0,
        opacity: 50,
    });
    const mid = Math.floor(image.width / 2);
    const alpha = alphaAt(image, image.margin - 10, mid);
    ok(Math.abs(alpha - 64) <= 1, `alpha ${alpha} close to 64`);
});

test('a fixed margin is used as given', () => {
    const image = renderShadow(FOCUSED, 80);
    equal(image.margin, 80);
    equal(image.width, image.slice * 2 + 1);
    equal(alphaAt(image, 0, 0), 0, 'nothing that far out');
});

test('a fixed margin cuts a wide shadow off', () => {
    const image = renderShadow({...FOCUSED, blur: 200}, 80);
    equal(image.margin, 80);
});

test('the key changes with the style', () => {
    ok(shadowKey(FOCUSED) !== shadowKey({...FOCUSED, opacity: 61}));
    equal(shadowKey(FOCUSED), shadowKey({...FOCUSED}));
});

test('rendering is fast enough to run on settings changes', () => {
    const start = Date.now();
    renderShadow(FOCUSED);
    const ms = Date.now() - start;
    print(`      rendering took ${ms} ms`);
    ok(ms < 1000, `${ms} ms`);
});

await run('shadow_texture.test.js');
