// Based on this shader from Mutter:
// https://gitlab.gnome.org/GNOME/mutter/-/blob/main/src/compositor/meta-background-content.c

// This shader is what actually does the most important part of the extension -
// corner rounding.
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
// height}. Clutter pads the texture, so it is larger than the actor.
uniform vec4 textureRect;

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
    cogl_color_out = cogl_color_out * (windowAlpha - borderAlpha * borderColor.a)
                   + borderPaintColor * borderAlpha;
}
