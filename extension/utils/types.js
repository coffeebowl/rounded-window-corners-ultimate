/** @file Provides types used throughout the codebase. */

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
 * A border drawn inside the window edge, over the contents.
 *
 * @typedef {object} Border
 * @property {number} width - Width in pixels.
 * @property {readonly number[]} color - Red, green, blue and alpha from 0 to 1.
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
