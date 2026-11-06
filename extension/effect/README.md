# `effect`

This directory contains the code for applying GLSL effects to windows.

## `texture_filters.js`

Picks the texture filters of the rounded corners effect's offscreen texture
by how much the window is scaled down while it is painted, so previews in
the overview stay sharp.

## `rounded_corners_effect.js`

This effect loads the actual Fragment shader that rounds the corners and draws
the border inside the window edge. The class applies the effect and provides a
function to change uniforms passed to the effect.

## `shadow_actor.js`

The actor that draws a window's shadow: a pre-rendered image, 9-sliced around
the window, at the resolution of the monitor's scale. It cross-fades between
the focused and unfocused shadow.

## `shader`

This is the directory where the Fragment shaders are stored.

If you're interested in implementation details of the shader, you can read the
`shader/rounded_corners.frag` file, which is well commented and explains how
it works in great detail.
