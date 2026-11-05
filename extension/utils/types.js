/** @file Provides types used throughout the codebase, mostly for storing settings. */

/**
 * Bounds of rounded corners.
 *
 * @typedef {object} Bounds
 * @property {number} x1
 * @property {number} y1
 * @property {number} x2
 * @property {number} y2
 */

/**
 * Settings for corner rounding.
 *
 * @typedef {object} RoundedCornerSettings
 * @property {{maximized: boolean, fullscreen: boolean}} keepRoundedCorners
 * @property {number} borderRadius
 * @property {number} smoothing
 * @property {{left: number, right: number, top: number, bottom: number}} padding
 * @property {[number, number, number, number]} borderColor
 * @property {boolean} enabled
 */

/**
 * Rounded corner settings exceptions for specific windows, keyed by wmClass.
 *
 * @typedef {Record<string, RoundedCornerSettings>} CustomRoundedCornerSettings
 */

/**
 * Window shadow properties.
 *
 * @typedef {object} BoxShadow
 * @property {number} opacity
 * @property {number} spreadRadius
 * @property {number} blurOffset
 * @property {number} verticalOffset
 * @property {number} horizontalOffset
 */
