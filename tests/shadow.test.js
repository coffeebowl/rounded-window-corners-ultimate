// Tests for the shadow layers in extension/utils/shadow.js and for the
// reference renderer in shadow_reference.js, which the smoke tests compare
// the shader with.

import {
    FOCUSED_SHADOW,
    RADIUS,
    UNFOCUSED_SHADOW,
} from '../extension/utils/config.js';
import {readShader} from '../extension/utils/file.js';
import {mixShadows, shadowRoom} from '../extension/utils/shadow.js';
import {equal, ok, run, test} from './harness.js';
import {renderShadow, shadowLayout} from './shadow_reference.js';

/** libadwaita's focused window shadow. */
const FOCUSED = {radius: RADIUS, layers: FOCUSED_SHADOW};

/** Alpha of a pixel, from 0 to 255. */
function alphaAt(image, x, y) {
    return image.pixels[(y * image.size + x) * 4 + 3];
}

test('the middle of the window box is transparent', () => {
    const image = renderShadow(FOCUSED);
    const mid = Math.floor(image.size / 2);
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
    const mid = Math.floor(image.size / 2);
    ok(alphaAt(image, image.margin, mid) > 0, 'edge pixel');
    equal(alphaAt(image, image.margin + 2, mid), 0, 'further in');
});

test('the shadow is darkest next to the box and fades outwards', () => {
    const image = renderShadow(FOCUSED);
    const mid = Math.floor(image.size / 2);
    const near = alphaAt(image, image.margin - 1, mid);
    const far = alphaAt(image, 1, mid);
    ok(near > far, `near ${near} > far ${far}`);
    ok(far <= 1, `far ${far} has faded`);
});

test('the shadow is symmetric on all sides', () => {
    const image = renderShadow(FOCUSED);
    const mid = Math.floor(image.size / 2);
    const last = image.size - 1 - image.margin;
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
    const mid = Math.floor(image.size / 2);
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
    const mid = Math.floor(image.size / 2);
    const inner = alphaAt(image, image.margin - 5, mid);
    const outer = alphaAt(image, image.margin - 6, mid);
    ok(inner > 128 && outer < 128, `inner ${inner}, outer ${outer}`);
    ok(Math.abs((inner + outer) / 2 - 128) <= 4, 'average close to half');
});

test('layers add up like CSS shadows over each other', () => {
    // Two rings of 50 % let 25 % through, so together they are 75 %.
    const ring = {blur: 0, spread: 1, alpha: 0.5};
    const image = renderShadow({radius: 0, layers: [ring, ring]});
    const mid = Math.floor(image.size / 2);
    const alpha = alphaAt(image, image.margin - 1, mid);
    ok(Math.abs(alpha - 191) <= 1, `alpha ${alpha} close to 191`);
});

test('the image reaches as far as the widest layer', () => {
    const {margin} = shadowLayout(FOCUSED);
    // 5 px spread and three sigmas of 7 px.
    equal(margin, 5 + 21 + 1);
});

test('at scale 2 the image has twice the pixels', () => {
    const one = renderShadow(FOCUSED);
    const two = renderShadow(FOCUSED, 2);
    ok(Math.abs(two.margin - 2 * one.margin) <= 2, `margin ${two.margin}`);
    // The same window distance gives about the same alpha.
    const mid1 = Math.floor(one.size / 2);
    const mid2 = Math.floor(two.size / 2);
    for (const d of [3, 8, 15]) {
        const a1 = alphaAt(one, one.margin - d, mid1);
        const a2 = alphaAt(two, two.margin - 2 * d, mid2);
        ok(Math.abs(a1 - a2) <= 3, `distance ${d}: ${a1} and ${a2}`);
    }
    // The ring is still one window pixel, now two image pixels.
    const ring = {radius: 0, layers: [{blur: 0, spread: 1, alpha: 0.5}]};
    const image = renderShadow(ring, 2);
    const mid = Math.floor(image.size / 2);
    ok(alphaAt(image, image.margin - 2, mid) > 120, 'second ring pixel');
    equal(alphaAt(image, image.margin - 3, mid), 0, 'nothing beyond');
});

test('the room fits the shadow and its antialiased edge', () => {
    // As far as the image reaches: 5 px spread and three sigmas of 7 px,
    // plus one pixel.
    equal(shadowRoom(FOCUSED_SHADOW, UNFOCUSED_SHADOW), shadowLayout(FOCUSED).margin);
    equal(shadowRoom([{blur: 10, spread: 5, alpha: 0.08}]), 5 + 15 + 1);
    equal(shadowRoom([]), 1);
});

test('mixing goes layer by layer from one look to the other', () => {
    equal(mixShadows(UNFOCUSED_SHADOW, FOCUSED_SHADOW, 0), [...UNFOCUSED_SHADOW]);
    equal(mixShadows(UNFOCUSED_SHADOW, FOCUSED_SHADOW, 1), [...FOCUSED_SHADOW]);
    const [first, second, ring] = mixShadows(UNFOCUSED_SHADOW, FOCUSED_SHADOW, 0.5);
    equal(first, {blur: 14, spread: 5, alpha: 0.075});
    equal(second, {blur: 7.5, spread: 3.5, alpha: 0.09});
    equal(ring, {...FOCUSED_SHADOW[2]});
});

test('both looks fit the layers of the shader', async () => {
    const [declarations] = await readShader(
        import.meta.url,
        '../extension/effect/shader/rounded_corners.frag',
    );
    const layers = declarations.match(/^uniform vec3 shadow\d;$/gm).length;
    equal(FOCUSED_SHADOW.length, layers);
    equal(UNFOCUSED_SHADOW.length, layers);
});

await run('shadow.test.js');
