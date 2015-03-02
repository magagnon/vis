/*
* Custom build for Hexoskin
*
* We only need support for datasets and timelines
*
* Built using browserify:
* browserify custom.js -o vis-custom.js -s vis -x moment
*/

// data
exports.DataSet = require('./lib/DataSet');

// timeline
exports.Timeline = require('./lib/timeline/Timeline');