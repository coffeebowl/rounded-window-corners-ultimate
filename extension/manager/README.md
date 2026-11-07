# `manager`

The rounded corners effect has to react when different events happen. For
example, when a new window is opened, the effect has to detect it and add
rounded corners to it.

This directory contains the code that handles these events.

## `window_state.js`

Keeps the state of each window and the update queue. Signal handlers only
mark what changed; the work runs once per frame before it is painted. Has no
GNOME Shell imports, so it can be unit tested.

## `event_manager.js`

Connects GNOME Shell signals to the update queue, and pauses windows that
are hidden behind an opaque fullscreen window.

## `event_handlers.js`

Applies the pending changes of a window: adds or removes the effect and the
room for its shadow, and updates them.

## `coverage.js`

Decides which windows are hidden behind an opaque window that covers their
monitor. Has no GNOME Shell imports, so it can be unit tested.

## `utils.js`

Provides various utility functions used within signal handling code.
