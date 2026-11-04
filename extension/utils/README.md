# `utils`

This directory contains functions which are used in different places throughout
the codebase, so they can't be put anywhere else.

## `box_shadow.js`

Contains a function for converting box shadow JS objects into CSS styles for
those shadows.

## `constants.js`

Defines the constants used in the codebase.

## `file.js`

Contains utility functions for reading file contents.

## `log.js`

Provides wrapper functions for printing out debug messages.

## `settings.js`

Provides wrappers around the GSettings object that add type safety and
automatically convert values between JS types and GLib Variant types that are
used for storing GSettings.

## `types.js`

Provides types used throughout the codebase, mostly for storing settings.
