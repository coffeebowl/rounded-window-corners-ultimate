// Based on this shader from Mutter:
// https://gitlab.gnome.org/GNOME/mutter/-/blob/main/src/compositor/meta-background-content.c
//
// The shadow math is based on gsk/gpu/shaders/gskgpuboxshadow.glsl from
// GTK 4.24 (LGPL-2.1-or-later), which draws the shadow of libadwaita
// windows.

// This shader is what actually does the most important part of the extension -
// corner rounding, and the shadow around the window.
//
// The way Fragment shaders work in GNOME is that they receive the information
// about a point on the screen, process it in some way, and set the `cogl_color_out`
// variable which indicates what color should be drawn to the screen at that
// point.
//
// Corner rounding works by measuring how far a point lies inside the visible
// part of the window, and making it invisible (multiplying `cogl_color_out` by
// 0) if it lies outside. Distances are measured in pixels on the screen, so
// edges are antialiased over exactly one pixel at every scale: a 1 px border
// covers 1.5 pixels at 150 % instead of jumping between one and two.

// First, we declare our uniforms.
// Uniforms are parameters that are passed to the shader from external code.

// Bounds of the window as {x, y, z, w}:
//   x - left
//   y - top
//   z - right
//   w - bottom
uniform vec4 bounds;

// The border radius of the corner clipping.
uniform float clipRadius;

// Width and color of the border, which lies inside the window edge.
uniform float borderWidth;
uniform vec4 borderColor;

// Bounds and clip radius of the window area within the border.
uniform vec4 borderedAreaBounds;
uniform float borderedAreaClipRadius;

// 1 to cut off everything outside the rounded window, 0 to only draw the
// border. libadwaita windows round themselves and draw their own shadow
// outside the window, which has to stay.
uniform float clipToWindow;

// Where the offscreen texture lies in actor coordinates, as {x, y, width,
// height}. Clutter pads the texture, and the shadow needs room around the
// window, so it is larger than the actor.
uniform vec4 textureRect;

// The layers of the window's shadow, like CSS box-shadow, as {blur radius,
// spread, alpha}. Every layer is the rounded window box grown by the spread
// and blurred with a Gaussian of sigma = blur / 2, black, and drawn only
// outside the window. A layer with alpha 0 costs nothing.
uniform vec3 shadow0;
uniform vec3 shadow1;
uniform vec3 shadow2;

// Calculate how much of the screen pixel at a point lies within the window.
//
//          p | The point, in window pixels
//      pixel | Size of a screen pixel in window pixels
//     bounds | The bounds of the window
// clipRadius | Border radius
float getPointOpacity(vec2 p, vec2 pixel, vec4 bounds, float clipRadius) {
    // Distances from the left or right and from the top or bottom edge,
    // whichever is closer.
    vec2 inset = min(p - bounds.xy, bounds.zw - p);

    // Near a straight edge, the distance in screen pixels decides.
    float coverage = min(inset.x / pixel.x, inset.y / pixel.y);

    // Within `clipRadius` of two edges, the point lies in a corner, where
    // the distance from the rounded edge decides. `delta` is how far the
    // point lies from the circle's center towards the window edges.
    vec2 delta = vec2(clipRadius) - inset;
    if (delta.x > 0.0 && delta.y > 0.0) {
        float dist = clipRadius - length(delta);
        coverage = dist / (0.5 * (pixel.x + pixel.y));
    }

    // A pixel whose center lies on the edge is half covered.
    return clamp(coverage + 0.5, 0.0, 1.0);
}

// The error function, approximated as in Abramowitz and Stegun 7.1.27.
vec2 erf(vec2 x) {
    vec2 s = sign(x);
    vec2 a = abs(x);
    vec2 d = 1.0 + (0.278393 + (0.230389 + 0.078108 * (a * a)) * a) * a;
    d *= d;
    return s - s / (d * d);
}

// How much of a standard Gaussian lies between range.x and range.y.
float gaussShare(vec2 range) {
    vec2 e = erf(range * 0.70710678);
    return 0.5 * (e.y - e.x);
}

// What a corner takes away from a blurred box: the blurred part of the
// corner square that lies outside the rounded corner. `q` is the point's
// distance from the box corner, positive into the box, and `r` the corner
// radius, both in sigmas. The integral over the rows of the corner is
// summed at a few points; beyond 3 sigmas nothing is left.
float blurredCornerCut(vec2 q, float r) {
    if (r <= 0.0 || min(q.x, q.y) <= -3.0 || max(q.x, q.y) - r >= 3.0)
        return 0.0;

    float start = max(q.y - 3.0, 0.0);
    float end = min(q.y + 3.0, r);
    float step = (end - start) / 8.0;
    float sum = 0.0;
    for (int i = 0; i < 8; i++) {
        float y = start + (float(i) + 0.5) * step;
        // The width of the cut-off part in this row.
        float dy = r - y;
        float cut = r - sqrt(max(r * r - dy * dy, 0.0));
        float density = exp(-0.5 * (q.y - y) * (q.y - y)) * 0.39894228;
        sum += density * gaussShare(vec2(-q.x, cut - q.x));
    }
    return sum * step;
}

// How much one shadow layer covers a point, from 0 to 1.
float getShadowOpacity(vec2 p, vec2 pixel, vec3 layer) {
    float spread = layer.y;
    vec4 box = bounds + vec4(-spread, -spread, spread, spread);
    // The corners grow with the spread, square ones stay square.
    float radius = clipRadius > 0.0 ? max(clipRadius + spread, 0.0) : 0.0;
    if (layer.x <= 0.0)
        return getPointOpacity(p, pixel, box, radius);

    float sigma = layer.x * 0.5;
    // A blurred rectangle is a product of two blurred edges.
    float rect = gaussShare((box.xz - p.x) / sigma) * gaussShare((box.yw - p.y) / sigma);
    // Only the nearest corner is taken away. The others are farther than
    // 3 sigmas, unless the window is tiny.
    vec2 inset = min(p - box.xy, box.zw - p);
    return max(rect - blurredCornerCut(inset / sigma, radius / sigma), 0.0);
}

// How much the shadow covers a point: black layers over each other let
// through the product of their transparencies.
float getShadowAlpha(vec2 p, vec2 pixel) {
    float clear = 1.0;
    if (shadow0.z > 0.0) clear *= 1.0 - shadow0.z * getShadowOpacity(p, pixel, shadow0);
    if (shadow1.z > 0.0) clear *= 1.0 - shadow1.z * getShadowOpacity(p, pixel, shadow1);
    if (shadow2.z > 0.0) clear *= 1.0 - shadow2.z * getShadowOpacity(p, pixel, shadow2);
    return 1.0 - clear;
}

// This is the main function of the shader. It's what is actually being called
// when rendering a point to the screen. It has no return value; as explained
// at the beginning of the file, the `cogl_color_out` variable is used to set
// the point color.
void main() {
    vec2 p = textureRect.xy + cogl_tex_coord0_in.xy * textureRect.zw;

    // How many window pixels one screen pixel covers: 1 at 100 %, 2/3 at
    // 150 %, more in the overview. Derivatives are only defined outside of
    // branches, so this is measured once here.
    vec2 pixel = max(fwidth(p), vec2(0.0001));

    float pointAlpha = getPointOpacity(p, pixel, bounds, clipRadius);

    // Window pixels already include the paint opacity, for example while a
    // window fades in. Apply it to the border too. Colors here are
    // premultiplied, so coverage multiplies all four components.
    vec4 borderPaintColor = vec4(borderColor.rgb, 1.0) * borderColor.a * cogl_color_in.a;

    // The border covers the part of the window outside of the bordered
    // area, the window shows in the rest.
    float borderedAreaAlpha = getPointOpacity(p, pixel, borderedAreaBounds, borderedAreaClipRadius);
    float borderAlpha = max(pointAlpha - borderedAreaAlpha, 0.0);
    float windowAlpha = mix(1.0, pointAlpha, clipToWindow);
    vec4 color = cogl_color_out * (windowAlpha - borderAlpha * borderColor.a)
               + borderPaintColor * borderAlpha;

    // The shadow lies below the window and shows where the window does not
    // cover the pixel, so never through translucent windows. It fades with
    // the window, like the border.
    if (windowAlpha < 1.0)
        color.a += getShadowAlpha(p, pixel) * (1.0 - windowAlpha) * cogl_color_in.a;
    cogl_color_out = color;
}
