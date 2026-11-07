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
 * One layer of a CSS box-shadow, always black and centered on the window.
 *
 * @typedef {object} ShadowLayer
 * @property {number} blur - CSS blur radius.
 * @property {number} spread - CSS spread radius, may be negative.
 * @property {number} alpha - Opacity from 0 to 1.
 */
