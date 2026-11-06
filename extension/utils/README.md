# `utils`

This directory contains functions which are used in different places throughout
the codebase, so they can't be put anywhere else.

## `config.js`

Fixed values for corners, outline and shadows, after libadwaita windows.

## `constants.js`

Defines the constants used in the codebase.

## `file.js`

Contains utility functions for reading file contents.

## `log.js`

Provides wrapper functions for printing out debug messages.

## `shadow_texture.js`

Renders the shadow image for a shadow style: a blurred rounded box with a
transparent middle, drawn as a 9-slice border image around the window.

## `shadow_files.js`

Stores rendered shadow images as PNG files in the cache directory, one per
shadow style.

## `settings.js`

Holds the few settings while the extension is enabled: the focus border and
the debug flag.

## `types.js`

Provides types used throughout the codebase.
