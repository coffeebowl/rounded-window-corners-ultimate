# `effect`

This directory contains the code for applying GLSL effects to windows.

## `texture_filters.js`

Picks the texture filters of the rounded corners effect's offscreen texture
by how much the window is scaled down while it is painted, so previews in
the overview stay sharp.

## `rounded_corners_effect.js`

This effect loads the actual Fragment shader that rounds the corners, draws
the border inside the window edge and the shadow around it. The class applies
the effect and provides functions to change uniforms passed to the effect.
A second, empty effect before it makes room for the shadow in the offscreen
texture.

## `shader`

This is the directory where the Fragment shaders are stored.

If you're interested in implementation details of the shader, you can read the
`shader/rounded_corners.frag` file, which is well commented and explains how
it works in great detail.
