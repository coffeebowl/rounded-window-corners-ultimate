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

## `shadow.js`

The shadow as CSS box-shadow layers: how much room it needs around the
window, and the layers between the focused and the unfocused look. Has no
imports, so it can be unit tested.

## `settings.js`

Holds the few settings while the extension is enabled: the focus border and
the debug flag.

## `types.js`

Provides types used throughout the codebase.
