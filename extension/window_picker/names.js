/**
 * @file D-Bus names of the window picker, shared by the service in GNOME
 * Shell and the client in the preferences. The interface itself is defined
 * in iface.xml.
 */

export const BUS_NAME = 'org.gnome.Shell';
export const INTERFACE_NAME =
    'org.gnome.Shell.Extensions.RoundedWindowCornersUltimate';
export const OBJECT_PATH =
    '/org/gnome/shell/extensions/RoundedWindowCornersUltimate';

/** Sent instead of a window class when the picked actor is no window. */
export const NO_WINDOW = 'window-not-found';
