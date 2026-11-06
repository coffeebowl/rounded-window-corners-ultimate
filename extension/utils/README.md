# `utils`

This directory contains functions which are used in different places throughout
the codebase, so they can't be put anywhere else.

## `config.js`

Fixed values for corners, outline and shadows, after libadwaita windows.

## `constants.js`

Defines the constants used in the codebase.

## `file.js`

Contains utility functions for reading files, and removes the shadow images
that older versions kept in the cache directory.

## `log.js`

Provides wrapper functions for printing out debug messages.

## `shadow_texture.js`

Renders the shadow image for a shadow style, like CSS box-shadow in GTK: a
blurred rounded box with a transparent middle, 9-sliced around the window by
`effect/shadow_actor.js`.

## `settings.js`

Holds the few settings while the extension is enabled: the focus border and
the debug flag.

## `types.js`

Provides types used throughout the codebase.
