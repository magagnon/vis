/*
 * Custom build for Hexoskin
 *
 * We only need support for datasets and timelines
 *
 * Built using browserify:
 * browserify custom.js -o dist/vis-hexoskin.js -s vis -x moment
 *
 */

// utils
exports.util = require('./lib/util');
exports.DOMutil = require('./lib/DOMutil');

// data
exports.DataSet = require('./lib/DataSet');

// timeline
exports.Timeline = require('./lib/timeline/Timeline');