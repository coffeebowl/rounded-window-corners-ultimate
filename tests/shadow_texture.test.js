// Tests for the shadow image in extension/utils/shadow_texture.js.

import {
    renderShadow,
    shadowKey,
    shadowLayout,
} from '../extension/utils/shadow_texture.js';
import {equal, ok, run, test} from './harness.js';

/** libadwaita's focused window shadow, see extension/utils/config.js. */
const FOCUSED = {
    radius: 15,
    layers: [
        {blur: 14, spread: 5, alpha: 0.15},
        {blur: 5, spread: 2, alpha: 0.1},
        {blur: 0, spread: 1, alpha: 0.05},
    ],
};

/** Alpha of a pixel, from 0 to 255. */
function alphaAt(image, x, y) {
    return image.pixels[(y * image.width + x) * 4 + 3];
}

test('the middle of the window box is transparent', () => {
    const image = renderShadow(FOCUSED);
    const mid = Math.floor(image.width / 2);
    equal(alphaAt(image, mid, mid), 0);
});

test('the shadow is black', () => {
    const image = renderShadow(FOCUSED);
    for (let i = 0; i < image.pixels.length; i += 4) {
        const rgb = image.pixels[i] + image.pixels[i + 1] + image.pixels[i + 2];
        if (rgb) throw new Error(`light pixel at ${i / 4}`);
    }
});

test('the shadow reaches one pixel under the window edge', () => {
    const image = renderShadow(FOCUSED);
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
    const image = renderShadow(FOCUSED);
    const mid = Math.floor(image.width / 2);
    const near = alphaAt(image, image.margin - 1, mid);
    const far = alphaAt(image, 1, mid);
    ok(near > far, `near ${near} > far ${far}`);
    ok(far <= 1, `far ${far} has faded`);
});

test('the shadow is symmetric on all sides', () => {
    const image = renderShadow(FOCUSED);
    const mid = Math.floor(image.width / 2);
    const last = image.width - 1 - image.margin;
    for (const d of [1, 5, 10, 20]) {
        const left = alphaAt(image, image.margin - d, mid);
        equal(alphaAt(image, last + d, mid), left, `right at ${d}`);
        equal(alphaAt(image, mid, image.margin - d), left, `top at ${d}`);
        equal(alphaAt(image, mid, last + d), left, `bottom at ${d}`);
    }
});

test('a ring without blur is a solid line of its opacity', () => {
    // CSS `0 0 0 1px rgb(0 0 0 / 50%)`: one pixel at 50 % right outside
    // the box, nothing beyond.
    const image = renderShadow({
        radius: 0,
        layers: [{blur: 0, spread: 1, alpha: 0.5}],
    });
    const mid = Math.floor(image.width / 2);
    const alpha = alphaAt(image, image.margin - 1, mid);
    ok(Math.abs(alpha - 128) <= 1, `ring alpha ${alpha} close to 128`);
    equal(alphaAt(image, image.margin - 2, mid), 0, 'nothing outside the ring');
});

test('a blurred edge is half covered where the spread box ends', () => {
    // A Gaussian blur of a straight edge has half its opacity on the edge:
    // spread 5 puts it between the 5th and 6th pixel outside the box.
    const image = renderShadow({
        radius: 0,
        layers: [{blur: 10, spread: 5, alpha: 1}],
    });
    const mid = Math.floor(image.width / 2);
    const inner = alphaAt(image, image.margin - 5, mid);
    const outer = alphaAt(image, image.margin - 6, mid);
    ok(inner > 128 && outer < 128, `inner ${inner}, outer ${outer}`);
    ok(Math.abs((inner + outer) / 2 - 128) <= 4, 'average close to half');
});

test('layers add up like CSS shadows over each other', () => {
    // Two rings of 50 % let 25 % through, so together they are 75 %.
    const ring = {blur: 0, spread: 1, alpha: 0.5};
    const image = renderShadow({radius: 0, layers: [ring, ring]});
    const mid = Math.floor(image.width / 2);
    const alpha = alphaAt(image, image.margin - 1, mid);
    ok(Math.abs(alpha - 191) <= 1, `alpha ${alpha} close to 191`);
});

test('the layout reaches as far as the widest layer', () => {
    const {margin} = shadowLayout(FOCUSED);
    // 5 px spread and three sigmas of 7 px.
    equal(margin, 5 + 21 + 1);
});

test('a fixed margin is used as given', () => {
    const image = renderShadow(FOCUSED, 80);
    equal(image.margin, 80);
    equal(image.width, image.slice * 2 + 1);
    equal(alphaAt(image, 0, 0), 0, 'nothing that far out');
});

test('a fixed margin cuts a wide shadow off', () => {
    const image = renderShadow(
        {radius: 15, layers: [{blur: 200, spread: 0, alpha: 0.5}]},
        80,
    );
    equal(image.margin, 80);
});

test('the key changes with the style', () => {
    const other = {
        ...FOCUSED,
        layers: [...FOCUSED.layers.slice(0, 2), {blur: 0, spread: 1, alpha: 0.06}],
    };
    ok(shadowKey(FOCUSED) !== shadowKey(other));
    ok(shadowKey(FOCUSED) !== shadowKey({...FOCUSED, radius: 16}));
    equal(shadowKey(FOCUSED), shadowKey({...FOCUSED}));
});

test('rendering is fast enough to run when a window first shows', () => {
    const start = Date.now();
    renderShadow(FOCUSED, 80);
    const ms = Date.now() - start;
    print(`      rendering took ${ms} ms`);
    ok(ms < 1000, `${ms} ms`);
});

await run('shadow_texture.test.js');
