(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.vis = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
/*
* Custom build for Hexoskin
*
* We only need support for datasets and timelines
*
* Built using browserify:
* browserify custom.js -o dist/vis-hexoskin.js -s vis -x moment
*
*/

// data
exports.DataSet = require('./lib/DataSet');

// timeline
exports.Timeline = require('./lib/timeline/Timeline');
},{"./lib/DataSet":2,"./lib/timeline/Timeline":14}],2:[function(require,module,exports){
var util = require('./util');
var Queue = require('./Queue');

/**
 * DataSet
 *
 * Usage:
 *     var dataSet = new DataSet({
 *         fieldId: '_id',
 *         type: {
 *             // ...
 *         }
 *     });
 *
 *     dataSet.add(item);
 *     dataSet.add(data);
 *     dataSet.update(item);
 *     dataSet.update(data);
 *     dataSet.remove(id);
 *     dataSet.remove(ids);
 *     var data = dataSet.get();
 *     var data = dataSet.get(id);
 *     var data = dataSet.get(ids);
 *     var data = dataSet.get(ids, options, data);
 *     dataSet.clear();
 *
 * A data set can:
 * - add/remove/update data
 * - gives triggers upon changes in the data
 * - can  import/export data in various data formats
 *
 * @param {Array | DataTable} [data]    Optional array with initial data
 * @param {Object} [options]   Available options:
 *                             {String} fieldId Field name of the id in the
 *                                              items, 'id' by default.
 *                             {Object.<String, String} type
 *                                              A map with field names as key,
 *                                              and the field type as value.
 *                             {Object} queue   Queue changes to the DataSet,
 *                                              flush them all at once.
 *                                              Queue options:
 *                                              - {number} delay  Delay in ms, null by default
 *                                              - {number} max    Maximum number of entries in the queue, Infinity by default
 * @constructor DataSet
 */
// TODO: add a DataSet constructor DataSet(data, options)
function DataSet (data, options) {
  // correctly read optional arguments
  if (data && !Array.isArray(data) && !util.isDataTable(data)) {
    options = data;
    data = null;
  }

  this._options = options || {};
  this._data = {};                                 // map with data indexed by id
  this.length = 0;                                 // number of items in the DataSet
  this._fieldId = this._options.fieldId || 'id';   // name of the field containing id
  this._type = {};                                 // internal field types (NOTE: this can differ from this._options.type)

  // all variants of a Date are internally stored as Date, so we can convert
  // from everything to everything (also from ISODate to Number for example)
  if (this._options.type) {
    for (var field in this._options.type) {
      if (this._options.type.hasOwnProperty(field)) {
        var value = this._options.type[field];
        if (value == 'Date' || value == 'ISODate' || value == 'ASPDate') {
          this._type[field] = 'Date';
        }
        else {
          this._type[field] = value;
        }
      }
    }
  }

  // TODO: deprecated since version 1.1.1 (or 2.0.0?)
  if (this._options.convert) {
    throw new Error('Option "convert" is deprecated. Use "type" instead.');
  }

  this._subscribers = {};  // event subscribers

  // add initial data when provided
  if (data) {
    this.add(data);
  }

  this.setOptions(options);
}

/**
 * @param {Object} [options]   Available options:
 *                             {Object} queue   Queue changes to the DataSet,
 *                                              flush them all at once.
 *                                              Queue options:
 *                                              - {number} delay  Delay in ms, null by default
 *                                              - {number} max    Maximum number of entries in the queue, Infinity by default
 * @param options
 */
DataSet.prototype.setOptions = function(options) {
  if (options && options.queue !== undefined) {
    if (options.queue === false) {
      // delete queue if loaded
      if (this._queue) {
        this._queue.destroy();
        delete this._queue;
      }
    }
    else {
      // create queue and update its options
      if (!this._queue) {
        this._queue = Queue.extend(this, {
          replace: ['add', 'update', 'remove']
        });
      }

      if (typeof options.queue === 'object') {
        this._queue.setOptions(options.queue);
      }
    }
  }
};

/**
 * Subscribe to an event, add an event listener
 * @param {String} event        Event name. Available events: 'put', 'update',
 *                              'remove'
 * @param {function} callback   Callback method. Called with three parameters:
 *                                  {String} event
 *                                  {Object | null} params
 *                                  {String | Number} senderId
 */
DataSet.prototype.on = function(event, callback) {
  var subscribers = this._subscribers[event];
  if (!subscribers) {
    subscribers = [];
    this._subscribers[event] = subscribers;
  }

  subscribers.push({
    callback: callback
  });
};

// TODO: make this function deprecated (replaced with `on` since version 0.5)
DataSet.prototype.subscribe = DataSet.prototype.on;

/**
 * Unsubscribe from an event, remove an event listener
 * @param {String} event
 * @param {function} callback
 */
DataSet.prototype.off = function(event, callback) {
  var subscribers = this._subscribers[event];
  if (subscribers) {
    this._subscribers[event] = subscribers.filter(function (listener) {
      return (listener.callback != callback);
    });
  }
};

// TODO: make this function deprecated (replaced with `on` since version 0.5)
DataSet.prototype.unsubscribe = DataSet.prototype.off;

/**
 * Trigger an event
 * @param {String} event
 * @param {Object | null} params
 * @param {String} [senderId]       Optional id of the sender.
 * @private
 */
DataSet.prototype._trigger = function (event, params, senderId) {
  if (event == '*') {
    throw new Error('Cannot trigger event *');
  }

  var subscribers = [];
  if (event in this._subscribers) {
    subscribers = subscribers.concat(this._subscribers[event]);
  }
  if ('*' in this._subscribers) {
    subscribers = subscribers.concat(this._subscribers['*']);
  }

  for (var i = 0; i < subscribers.length; i++) {
    var subscriber = subscribers[i];
    if (subscriber.callback) {
      subscriber.callback(event, params, senderId || null);
    }
  }
};

/**
 * Add data.
 * Adding an item will fail when there already is an item with the same id.
 * @param {Object | Array | DataTable} data
 * @param {String} [senderId] Optional sender id
 * @return {Array} addedIds      Array with the ids of the added items
 */
DataSet.prototype.add = function (data, senderId) {
  var addedIds = [],
      id,
      me = this;

  if (Array.isArray(data)) {
    // Array
    for (var i = 0, len = data.length; i < len; i++) {
      id = me._addItem(data[i]);
      addedIds.push(id);
    }
  }
  else if (util.isDataTable(data)) {
    // Google DataTable
    var columns = this._getColumnNames(data);
    for (var row = 0, rows = data.getNumberOfRows(); row < rows; row++) {
      var item = {};
      for (var col = 0, cols = columns.length; col < cols; col++) {
        var field = columns[col];
        item[field] = data.getValue(row, col);
      }

      id = me._addItem(item);
      addedIds.push(id);
    }
  }
  else if (data instanceof Object) {
    // Single item
    id = me._addItem(data);
    addedIds.push(id);
  }
  else {
    throw new Error('Unknown dataType');
  }

  if (addedIds.length) {
    this._trigger('add', {items: addedIds}, senderId);
  }

  return addedIds;
};

/**
 * Update existing items. When an item does not exist, it will be created
 * @param {Object | Array | DataTable} data
 * @param {String} [senderId] Optional sender id
 * @return {Array} updatedIds     The ids of the added or updated items
 */
DataSet.prototype.update = function (data, senderId) {
  var addedIds = [];
  var updatedIds = [];
  var updatedData = [];
  var me = this;
  var fieldId = me._fieldId;

  var addOrUpdate = function (item) {
    var id = item[fieldId];
    if (me._data[id]) {
      // update item
      id = me._updateItem(item);
      updatedIds.push(id);
      updatedData.push(item);
    }
    else {
      // add new item
      id = me._addItem(item);
      addedIds.push(id);
    }
  };

  if (Array.isArray(data)) {
    // Array
    for (var i = 0, len = data.length; i < len; i++) {
      addOrUpdate(data[i]);
    }
  }
  else if (util.isDataTable(data)) {
    // Google DataTable
    var columns = this._getColumnNames(data);
    for (var row = 0, rows = data.getNumberOfRows(); row < rows; row++) {
      var item = {};
      for (var col = 0, cols = columns.length; col < cols; col++) {
        var field = columns[col];
        item[field] = data.getValue(row, col);
      }

      addOrUpdate(item);
    }
  }
  else if (data instanceof Object) {
    // Single item
    addOrUpdate(data);
  }
  else {
    throw new Error('Unknown dataType');
  }

  if (addedIds.length) {
    this._trigger('add', {items: addedIds}, senderId);
  }
  if (updatedIds.length) {
    this._trigger('update', {items: updatedIds, data: updatedData}, senderId);
  }

  return addedIds.concat(updatedIds);
};

/**
 * Get a data item or multiple items.
 *
 * Usage:
 *
 *     get()
 *     get(options: Object)
 *     get(options: Object, data: Array | DataTable)
 *
 *     get(id: Number | String)
 *     get(id: Number | String, options: Object)
 *     get(id: Number | String, options: Object, data: Array | DataTable)
 *
 *     get(ids: Number[] | String[])
 *     get(ids: Number[] | String[], options: Object)
 *     get(ids: Number[] | String[], options: Object, data: Array | DataTable)
 *
 * Where:
 *
 * {Number | String} id         The id of an item
 * {Number[] | String{}} ids    An array with ids of items
 * {Object} options             An Object with options. Available options:
 *                              {String} [returnType] Type of data to be
 *                                  returned. Can be 'DataTable' or 'Array' (default)
 *                              {Object.<String, String>} [type]
 *                              {String[]} [fields] field names to be returned
 *                              {function} [filter] filter items
 *                              {String | function} [order] Order the items by
 *                                  a field name or custom sort function.
 * {Array | DataTable} [data]   If provided, items will be appended to this
 *                              array or table. Required in case of Google
 *                              DataTable.
 *
 * @throws Error
 */
DataSet.prototype.get = function (args) {
  var me = this;

  // parse the arguments
  var id, ids, options, data;
  var firstType = util.getType(arguments[0]);
  if (firstType == 'String' || firstType == 'Number') {
    // get(id [, options] [, data])
    id = arguments[0];
    options = arguments[1];
    data = arguments[2];
  }
  else if (firstType == 'Array') {
    // get(ids [, options] [, data])
    ids = arguments[0];
    options = arguments[1];
    data = arguments[2];
  }
  else {
    // get([, options] [, data])
    options = arguments[0];
    data = arguments[1];
  }

  // determine the return type
  var returnType;
  if (options && options.returnType) {
    var allowedValues = ["DataTable", "Array", "Object"];
    returnType = allowedValues.indexOf(options.returnType) == -1 ? "Array" : options.returnType;

    if (data && (returnType != util.getType(data))) {
      throw new Error('Type of parameter "data" (' + util.getType(data) + ') ' +
          'does not correspond with specified options.type (' + options.type + ')');
    }
    if (returnType == 'DataTable' && !util.isDataTable(data)) {
      throw new Error('Parameter "data" must be a DataTable ' +
          'when options.type is "DataTable"');
    }
  }
  else if (data) {
    returnType = (util.getType(data) == 'DataTable') ? 'DataTable' : 'Array';
  }
  else {
    returnType = 'Array';
  }

  // build options
  var type = options && options.type || this._options.type;
  var filter = options && options.filter;
  var items = [], item, itemId, i, len;

  // convert items
  if (id != undefined) {
    // return a single item
    item = me._getItem(id, type);
    if (filter && !filter(item)) {
      item = null;
    }
  }
  else if (ids != undefined) {
    // return a subset of items
    for (i = 0, len = ids.length; i < len; i++) {
      item = me._getItem(ids[i], type);
      if (!filter || filter(item)) {
        items.push(item);
      }
    }
  }
  else {
    // return all items
    for (itemId in this._data) {
      if (this._data.hasOwnProperty(itemId)) {
        item = me._getItem(itemId, type);
        if (!filter || filter(item)) {
          items.push(item);
        }
      }
    }
  }

  // order the results
  if (options && options.order && id == undefined) {
    this._sort(items, options.order);
  }

  // filter fields of the items
  if (options && options.fields) {
    var fields = options.fields;
    if (id != undefined) {
      item = this._filterFields(item, fields);
    }
    else {
      for (i = 0, len = items.length; i < len; i++) {
        items[i] = this._filterFields(items[i], fields);
      }
    }
  }

  // return the results
  if (returnType == 'DataTable') {
    var columns = this._getColumnNames(data);
    if (id != undefined) {
      // append a single item to the data table
      me._appendRow(data, columns, item);
    }
    else {
      // copy the items to the provided data table
      for (i = 0; i < items.length; i++) {
        me._appendRow(data, columns, items[i]);
      }
    }
    return data;
  }
  else if (returnType == "Object") {
    var result = {};
    for (i = 0; i < items.length; i++) {
      result[items[i].id] = items[i];
    }
    return result;
  }
  else {
    // return an array
    if (id != undefined) {
      // a single item
      return item;
    }
    else {
      // multiple items
      if (data) {
        // copy the items to the provided array
        for (i = 0, len = items.length; i < len; i++) {
          data.push(items[i]);
        }
        return data;
      }
      else {
        // just return our array
        return items;
      }
    }
  }
};

/**
 * Get ids of all items or from a filtered set of items.
 * @param {Object} [options]    An Object with options. Available options:
 *                              {function} [filter] filter items
 *                              {String | function} [order] Order the items by
 *                                  a field name or custom sort function.
 * @return {Array} ids
 */
DataSet.prototype.getIds = function (options) {
  var data = this._data,
      filter = options && options.filter,
      order = options && options.order,
      type = options && options.type || this._options.type,
      i,
      len,
      id,
      item,
      items,
      ids = [];

  if (filter) {
    // get filtered items
    if (order) {
      // create ordered list
      items = [];
      for (id in data) {
        if (data.hasOwnProperty(id)) {
          item = this._getItem(id, type);
          if (filter(item)) {
            items.push(item);
          }
        }
      }

      this._sort(items, order);

      for (i = 0, len = items.length; i < len; i++) {
        ids[i] = items[i][this._fieldId];
      }
    }
    else {
      // create unordered list
      for (id in data) {
        if (data.hasOwnProperty(id)) {
          item = this._getItem(id, type);
          if (filter(item)) {
            ids.push(item[this._fieldId]);
          }
        }
      }
    }
  }
  else {
    // get all items
    if (order) {
      // create an ordered list
      items = [];
      for (id in data) {
        if (data.hasOwnProperty(id)) {
          items.push(data[id]);
        }
      }

      this._sort(items, order);

      for (i = 0, len = items.length; i < len; i++) {
        ids[i] = items[i][this._fieldId];
      }
    }
    else {
      // create unordered list
      for (id in data) {
        if (data.hasOwnProperty(id)) {
          item = data[id];
          ids.push(item[this._fieldId]);
        }
      }
    }
  }

  return ids;
};

/**
 * Returns the DataSet itself. Is overwritten for example by the DataView,
 * which returns the DataSet it is connected to instead.
 */
DataSet.prototype.getDataSet = function () {
  return this;
};

/**
 * Execute a callback function for every item in the dataset.
 * @param {function} callback
 * @param {Object} [options]    Available options:
 *                              {Object.<String, String>} [type]
 *                              {String[]} [fields] filter fields
 *                              {function} [filter] filter items
 *                              {String | function} [order] Order the items by
 *                                  a field name or custom sort function.
 */
DataSet.prototype.forEach = function (callback, options) {
  var filter = options && options.filter,
      type = options && options.type || this._options.type,
      data = this._data,
      item,
      id;

  if (options && options.order) {
    // execute forEach on ordered list
    var items = this.get(options);

    for (var i = 0, len = items.length; i < len; i++) {
      item = items[i];
      id = item[this._fieldId];
      callback(item, id);
    }
  }
  else {
    // unordered
    for (id in data) {
      if (data.hasOwnProperty(id)) {
        item = this._getItem(id, type);
        if (!filter || filter(item)) {
          callback(item, id);
        }
      }
    }
  }
};

/**
 * Map every item in the dataset.
 * @param {function} callback
 * @param {Object} [options]    Available options:
 *                              {Object.<String, String>} [type]
 *                              {String[]} [fields] filter fields
 *                              {function} [filter] filter items
 *                              {String | function} [order] Order the items by
 *                                  a field name or custom sort function.
 * @return {Object[]} mappedItems
 */
DataSet.prototype.map = function (callback, options) {
  var filter = options && options.filter,
      type = options && options.type || this._options.type,
      mappedItems = [],
      data = this._data,
      item;

  // convert and filter items
  for (var id in data) {
    if (data.hasOwnProperty(id)) {
      item = this._getItem(id, type);
      if (!filter || filter(item)) {
        mappedItems.push(callback(item, id));
      }
    }
  }

  // order items
  if (options && options.order) {
    this._sort(mappedItems, options.order);
  }

  return mappedItems;
};

/**
 * Filter the fields of an item
 * @param {Object | null} item
 * @param {String[]} fields     Field names
 * @return {Object | null} filteredItem or null if no item is provided
 * @private
 */
DataSet.prototype._filterFields = function (item, fields) {
  if (!item) { // item is null
    return item;
  }

  var filteredItem = {};

  if(Array.isArray(fields)){
    for (var field in item) {
      if (item.hasOwnProperty(field) && (fields.indexOf(field) != -1)) {
        filteredItem[field] = item[field];
      }
    }
  }else{
    for (var field in item) {
      if (item.hasOwnProperty(field) && fields.hasOwnProperty(field)) {
        filteredItem[fields[field]] = item[field];
      }
    }
  }

  return filteredItem;
};

/**
 * Sort the provided array with items
 * @param {Object[]} items
 * @param {String | function} order      A field name or custom sort function.
 * @private
 */
DataSet.prototype._sort = function (items, order) {
  if (util.isString(order)) {
    // order by provided field name
    var name = order; // field name
    items.sort(function (a, b) {
      var av = a[name];
      var bv = b[name];
      return (av > bv) ? 1 : ((av < bv) ? -1 : 0);
    });
  }
  else if (typeof order === 'function') {
    // order by sort function
    items.sort(order);
  }
  // TODO: extend order by an Object {field:String, direction:String}
  //       where direction can be 'asc' or 'desc'
  else {
    throw new TypeError('Order must be a function or a string');
  }
};

/**
 * Remove an object by pointer or by id
 * @param {String | Number | Object | Array} id Object or id, or an array with
 *                                              objects or ids to be removed
 * @param {String} [senderId] Optional sender id
 * @return {Array} removedIds
 */
DataSet.prototype.remove = function (id, senderId) {
  var removedIds = [],
      i, len, removedId;

  if (Array.isArray(id)) {
    for (i = 0, len = id.length; i < len; i++) {
      removedId = this._remove(id[i]);
      if (removedId != null) {
        removedIds.push(removedId);
      }
    }
  }
  else {
    removedId = this._remove(id);
    if (removedId != null) {
      removedIds.push(removedId);
    }
  }

  if (removedIds.length) {
    this._trigger('remove', {items: removedIds}, senderId);
  }

  return removedIds;
};

/**
 * Remove an item by its id
 * @param {Number | String | Object} id   id or item
 * @returns {Number | String | null} id
 * @private
 */
DataSet.prototype._remove = function (id) {
  if (util.isNumber(id) || util.isString(id)) {
    if (this._data[id]) {
      delete this._data[id];
      this.length--;
      return id;
    }
  }
  else if (id instanceof Object) {
    var itemId = id[this._fieldId];
    if (itemId && this._data[itemId]) {
      delete this._data[itemId];
      this.length--;
      return itemId;
    }
  }
  return null;
};

/**
 * Clear the data
 * @param {String} [senderId] Optional sender id
 * @return {Array} removedIds    The ids of all removed items
 */
DataSet.prototype.clear = function (senderId) {
  var ids = Object.keys(this._data);

  this._data = {};
  this.length = 0;

  this._trigger('remove', {items: ids}, senderId);

  return ids;
};

/**
 * Find the item with maximum value of a specified field
 * @param {String} field
 * @return {Object | null} item  Item containing max value, or null if no items
 */
DataSet.prototype.max = function (field) {
  var data = this._data,
      max = null,
      maxField = null;

  for (var id in data) {
    if (data.hasOwnProperty(id)) {
      var item = data[id];
      var itemField = item[field];
      if (itemField != null && (!max || itemField > maxField)) {
        max = item;
        maxField = itemField;
      }
    }
  }

  return max;
};

/**
 * Find the item with minimum value of a specified field
 * @param {String} field
 * @return {Object | null} item  Item containing max value, or null if no items
 */
DataSet.prototype.min = function (field) {
  var data = this._data,
      min = null,
      minField = null;

  for (var id in data) {
    if (data.hasOwnProperty(id)) {
      var item = data[id];
      var itemField = item[field];
      if (itemField != null && (!min || itemField < minField)) {
        min = item;
        minField = itemField;
      }
    }
  }

  return min;
};

/**
 * Find all distinct values of a specified field
 * @param {String} field
 * @return {Array} values  Array containing all distinct values. If data items
 *                         do not contain the specified field are ignored.
 *                         The returned array is unordered.
 */
DataSet.prototype.distinct = function (field) {
  var data = this._data;
  var values = [];
  var fieldType = this._options.type && this._options.type[field] || null;
  var count = 0;
  var i;

  for (var prop in data) {
    if (data.hasOwnProperty(prop)) {
      var item = data[prop];
      var value = item[field];
      var exists = false;
      for (i = 0; i < count; i++) {
        if (values[i] == value) {
          exists = true;
          break;
        }
      }
      if (!exists && (value !== undefined)) {
        values[count] = value;
        count++;
      }
    }
  }

  if (fieldType) {
    for (i = 0; i < values.length; i++) {
      values[i] = util.convert(values[i], fieldType);
    }
  }

  return values;
};

/**
 * Add a single item. Will fail when an item with the same id already exists.
 * @param {Object} item
 * @return {String} id
 * @private
 */
DataSet.prototype._addItem = function (item) {
  var id = item[this._fieldId];

  if (id != undefined) {
    // check whether this id is already taken
    if (this._data[id]) {
      // item already exists
      throw new Error('Cannot add item: item with id ' + id + ' already exists');
    }
  }
  else {
    // generate an id
    id = util.randomUUID();
    item[this._fieldId] = id;
  }

  var d = {};
  for (var field in item) {
    if (item.hasOwnProperty(field)) {
      var fieldType = this._type[field];  // type may be undefined
      d[field] = util.convert(item[field], fieldType);
    }
  }
  this._data[id] = d;
  this.length++;

  return id;
};

/**
 * Get an item. Fields can be converted to a specific type
 * @param {String} id
 * @param {Object.<String, String>} [types]  field types to convert
 * @return {Object | null} item
 * @private
 */
DataSet.prototype._getItem = function (id, types) {
  var field, value;

  // get the item from the dataset
  var raw = this._data[id];
  if (!raw) {
    return null;
  }

  // convert the items field types
  var converted = {};
  if (types) {
    for (field in raw) {
      if (raw.hasOwnProperty(field)) {
        value = raw[field];
        converted[field] = util.convert(value, types[field]);
      }
    }
  }
  else {
    // no field types specified, no converting needed
    for (field in raw) {
      if (raw.hasOwnProperty(field)) {
        value = raw[field];
        converted[field] = value;
      }
    }
  }
  return converted;
};

/**
 * Update a single item: merge with existing item.
 * Will fail when the item has no id, or when there does not exist an item
 * with the same id.
 * @param {Object} item
 * @return {String} id
 * @private
 */
DataSet.prototype._updateItem = function (item) {
  var id = item[this._fieldId];
  if (id == undefined) {
    throw new Error('Cannot update item: item has no id (item: ' + JSON.stringify(item) + ')');
  }
  var d = this._data[id];
  if (!d) {
    // item doesn't exist
    throw new Error('Cannot update item: no item with id ' + id + ' found');
  }

  // merge with current item
  for (var field in item) {
    if (item.hasOwnProperty(field)) {
      var fieldType = this._type[field];  // type may be undefined
      d[field] = util.convert(item[field], fieldType);
    }
  }

  return id;
};

/**
 * Get an array with the column names of a Google DataTable
 * @param {DataTable} dataTable
 * @return {String[]} columnNames
 * @private
 */
DataSet.prototype._getColumnNames = function (dataTable) {
  var columns = [];
  for (var col = 0, cols = dataTable.getNumberOfColumns(); col < cols; col++) {
    columns[col] = dataTable.getColumnId(col) || dataTable.getColumnLabel(col);
  }
  return columns;
};

/**
 * Append an item as a row to the dataTable
 * @param dataTable
 * @param columns
 * @param item
 * @private
 */
DataSet.prototype._appendRow = function (dataTable, columns, item) {
  var row = dataTable.addRow();

  for (var col = 0, cols = columns.length; col < cols; col++) {
    var field = columns[col];
    dataTable.setValue(row, col, item[field]);
  }
};

module.exports = DataSet;

},{"./Queue":4,"./util":28}],3:[function(require,module,exports){
var util = require('./util');
var DataSet = require('./DataSet');

/**
 * DataView
 *
 * a dataview offers a filtered view on a dataset or an other dataview.
 *
 * @param {DataSet | DataView} data
 * @param {Object} [options]   Available options: see method get
 *
 * @constructor DataView
 */
function DataView (data, options) {
  this._data = null;
  this._ids = {}; // ids of the items currently in memory (just contains a boolean true)
  this.length = 0; // number of items in the DataView
  this._options = options || {};
  this._fieldId = 'id'; // name of the field containing id
  this._subscribers = {}; // event subscribers

  var me = this;
  this.listener = function () {
    me._onEvent.apply(me, arguments);
  };

  this.setData(data);
}

// TODO: implement a function .config() to dynamically update things like configured filter
// and trigger changes accordingly

/**
 * Set a data source for the view
 * @param {DataSet | DataView} data
 */
DataView.prototype.setData = function (data) {
  var ids, i, len;

  if (this._data) {
    // unsubscribe from current dataset
    if (this._data.unsubscribe) {
      this._data.unsubscribe('*', this.listener);
    }

    // trigger a remove of all items in memory
    ids = [];
    for (var id in this._ids) {
      if (this._ids.hasOwnProperty(id)) {
        ids.push(id);
      }
    }
    this._ids = {};
    this.length = 0;
    this._trigger('remove', {items: ids});
  }

  this._data = data;

  if (this._data) {
    // update fieldId
    this._fieldId = this._options.fieldId ||
        (this._data && this._data.options && this._data.options.fieldId) ||
        'id';

    // trigger an add of all added items
    ids = this._data.getIds({filter: this._options && this._options.filter});
    for (i = 0, len = ids.length; i < len; i++) {
      id = ids[i];
      this._ids[id] = true;
    }
    this.length = ids.length;
    this._trigger('add', {items: ids});

    // subscribe to new dataset
    if (this._data.on) {
      this._data.on('*', this.listener);
    }
  }
};

/**
 * Refresh the DataView. Useful when the DataView has a filter function
 * containing a variable parameter.
 */
DataView.prototype.refresh = function () {
  var id;
  var ids = this._data.getIds({filter: this._options && this._options.filter});
  var newIds = {};
  var added = [];
  var removed = [];

  // check for additions
  for (var i = 0; i < ids.length; i++) {
    id = ids[i];
    newIds[id] = true;
    if (!this._ids[id]) {
      added.push(id);
      this._ids[id] = true;
      this.length++;
    }
  }

  // check for removals
  for (id in this._ids) {
    if (this._ids.hasOwnProperty(id)) {
      if (!newIds[id]) {
        removed.push(id);
        delete this._ids[id];
        this.length--;
      }
    }
  }

  // trigger events
  if (added.length) {
    this._trigger('add', {items: added});
  }
  if (removed.length) {
    this._trigger('remove', {items: removed});
  }
};

/**
 * Get data from the data view
 *
 * Usage:
 *
 *     get()
 *     get(options: Object)
 *     get(options: Object, data: Array | DataTable)
 *
 *     get(id: Number)
 *     get(id: Number, options: Object)
 *     get(id: Number, options: Object, data: Array | DataTable)
 *
 *     get(ids: Number[])
 *     get(ids: Number[], options: Object)
 *     get(ids: Number[], options: Object, data: Array | DataTable)
 *
 * Where:
 *
 * {Number | String} id         The id of an item
 * {Number[] | String{}} ids    An array with ids of items
 * {Object} options             An Object with options. Available options:
 *                              {String} [type] Type of data to be returned. Can
 *                                              be 'DataTable' or 'Array' (default)
 *                              {Object.<String, String>} [convert]
 *                              {String[]} [fields] field names to be returned
 *                              {function} [filter] filter items
 *                              {String | function} [order] Order the items by
 *                                  a field name or custom sort function.
 * {Array | DataTable} [data]   If provided, items will be appended to this
 *                              array or table. Required in case of Google
 *                              DataTable.
 * @param args
 */
DataView.prototype.get = function (args) {
  var me = this;

  // parse the arguments
  var ids, options, data;
  var firstType = util.getType(arguments[0]);
  if (firstType == 'String' || firstType == 'Number' || firstType == 'Array') {
    // get(id(s) [, options] [, data])
    ids = arguments[0];  // can be a single id or an array with ids
    options = arguments[1];
    data = arguments[2];
  }
  else {
    // get([, options] [, data])
    options = arguments[0];
    data = arguments[1];
  }

  // extend the options with the default options and provided options
  var viewOptions = util.extend({}, this._options, options);

  // create a combined filter method when needed
  if (this._options.filter && options && options.filter) {
    viewOptions.filter = function (item) {
      return me._options.filter(item) && options.filter(item);
    }
  }

  // build up the call to the linked data set
  var getArguments = [];
  if (ids != undefined) {
    getArguments.push(ids);
  }
  getArguments.push(viewOptions);
  getArguments.push(data);

  return this._data && this._data.get.apply(this._data, getArguments);
};

/**
 * Get ids of all items or from a filtered set of items.
 * @param {Object} [options]    An Object with options. Available options:
 *                              {function} [filter] filter items
 *                              {String | function} [order] Order the items by
 *                                  a field name or custom sort function.
 * @return {Array} ids
 */
DataView.prototype.getIds = function (options) {
  var ids;

  if (this._data) {
    var defaultFilter = this._options.filter;
    var filter;

    if (options && options.filter) {
      if (defaultFilter) {
        filter = function (item) {
          return defaultFilter(item) && options.filter(item);
        }
      }
      else {
        filter = options.filter;
      }
    }
    else {
      filter = defaultFilter;
    }

    ids = this._data.getIds({
      filter: filter,
      order: options && options.order
    });
  }
  else {
    ids = [];
  }

  return ids;
};

/**
 * Get the DataSet to which this DataView is connected. In case there is a chain
 * of multiple DataViews, the root DataSet of this chain is returned.
 * @return {DataSet} dataSet
 */
DataView.prototype.getDataSet = function () {
  var dataSet = this;
  while (dataSet instanceof DataView) {
    dataSet = dataSet._data;
  }
  return dataSet || null;
};

/**
 * Event listener. Will propagate all events from the connected data set to
 * the subscribers of the DataView, but will filter the items and only trigger
 * when there are changes in the filtered data set.
 * @param {String} event
 * @param {Object | null} params
 * @param {String} senderId
 * @private
 */
DataView.prototype._onEvent = function (event, params, senderId) {
  var i, len, id, item;
  var ids = params && params.items;
  var data = this._data;
  var updatedData = [];
  var added = [];
  var updated = [];
  var removed = [];

  if (ids && data) {
    switch (event) {
      case 'add':
        // filter the ids of the added items
        for (i = 0, len = ids.length; i < len; i++) {
          id = ids[i];
          item = this.get(id);
          if (item) {
            this._ids[id] = true;
            added.push(id);
          }
        }

        break;

      case 'update':
        // determine the event from the views viewpoint: an updated
        // item can be added, updated, or removed from this view.
        for (i = 0, len = ids.length; i < len; i++) {
          id = ids[i];
          item = this.get(id);

          if (item) {
            if (this._ids[id]) {
              updated.push(id);
              updatedData.push(params.data[i]);
            }
            else {
              this._ids[id] = true;
              added.push(id);
            }
          }
          else {
            if (this._ids[id]) {
              delete this._ids[id];
              removed.push(id);
            }
            else {
              // nothing interesting for me :-(
            }
          }
        }

        break;

      case 'remove':
        // filter the ids of the removed items
        for (i = 0, len = ids.length; i < len; i++) {
          id = ids[i];
          if (this._ids[id]) {
            delete this._ids[id];
            removed.push(id);
          }
        }

        break;
    }

    this.length += added.length - removed.length;

    if (added.length) {
      this._trigger('add', {items: added}, senderId);
    }
    if (updated.length) {
      this._trigger('update', {items: updated, data: updatedData}, senderId);
    }
    if (removed.length) {
      this._trigger('remove', {items: removed}, senderId);
    }
  }
};

// copy subscription functionality from DataSet
DataView.prototype.on = DataSet.prototype.on;
DataView.prototype.off = DataSet.prototype.off;
DataView.prototype._trigger = DataSet.prototype._trigger;

// TODO: make these functions deprecated (replaced with `on` and `off` since version 0.5)
DataView.prototype.subscribe = DataView.prototype.on;
DataView.prototype.unsubscribe = DataView.prototype.off;

module.exports = DataView;
},{"./DataSet":2,"./util":28}],4:[function(require,module,exports){
/**
 * A queue
 * @param {Object} options
 *            Available options:
 *            - delay: number    When provided, the queue will be flushed
 *                               automatically after an inactivity of this delay
 *                               in milliseconds.
 *                               Default value is null.
 *            - max: number      When the queue exceeds the given maximum number
 *                               of entries, the queue is flushed automatically.
 *                               Default value of max is Infinity.
 * @constructor
 */
function Queue(options) {
  // options
  this.delay = null;
  this.max = Infinity;

  // properties
  this._queue = [];
  this._timeout = null;
  this._extended = null;

  this.setOptions(options);
}

/**
 * Update the configuration of the queue
 * @param {Object} options
 *            Available options:
 *            - delay: number    When provided, the queue will be flushed
 *                               automatically after an inactivity of this delay
 *                               in milliseconds.
 *                               Default value is null.
 *            - max: number      When the queue exceeds the given maximum number
 *                               of entries, the queue is flushed automatically.
 *                               Default value of max is Infinity.
 * @param options
 */
Queue.prototype.setOptions = function (options) {
  if (options && typeof options.delay !== 'undefined') {
    this.delay = options.delay;
  }
  if (options && typeof options.max !== 'undefined') {
    this.max = options.max;
  }

  this._flushIfNeeded();
};

/**
 * Extend an object with queuing functionality.
 * The object will be extended with a function flush, and the methods provided
 * in options.replace will be replaced with queued ones.
 * @param {Object} object
 * @param {Object} options
 *            Available options:
 *            - replace: Array.<string>
 *                               A list with method names of the methods
 *                               on the object to be replaced with queued ones.
 *            - delay: number    When provided, the queue will be flushed
 *                               automatically after an inactivity of this delay
 *                               in milliseconds.
 *                               Default value is null.
 *            - max: number      When the queue exceeds the given maximum number
 *                               of entries, the queue is flushed automatically.
 *                               Default value of max is Infinity.
 * @return {Queue} Returns the created queue
 */
Queue.extend = function (object, options) {
  var queue = new Queue(options);

  if (object.flush !== undefined) {
    throw new Error('Target object already has a property flush');
  }
  object.flush = function () {
    queue.flush();
  };

  var methods = [{
    name: 'flush',
    original: undefined
  }];

  if (options && options.replace) {
    for (var i = 0; i < options.replace.length; i++) {
      var name = options.replace[i];
      methods.push({
        name: name,
        original: object[name]
      });
      queue.replace(object, name);
    }
  }

  queue._extended = {
    object: object,
    methods: methods
  };

  return queue;
};

/**
 * Destroy the queue. The queue will first flush all queued actions, and in
 * case it has extended an object, will restore the original object.
 */
Queue.prototype.destroy = function () {
  this.flush();

  if (this._extended) {
    var object = this._extended.object;
    var methods = this._extended.methods;
    for (var i = 0; i < methods.length; i++) {
      var method = methods[i];
      if (method.original) {
        object[method.name] = method.original;
      }
      else {
        delete object[method.name];
      }
    }
    this._extended = null;
  }
};

/**
 * Replace a method on an object with a queued version
 * @param {Object} object   Object having the method
 * @param {string} method   The method name
 */
Queue.prototype.replace = function(object, method) {
  var me = this;
  var original = object[method];
  if (!original) {
    throw new Error('Method ' + method + ' undefined');
  }

  object[method] = function () {
    // create an Array with the arguments
    var args = [];
    for (var i = 0; i < arguments.length; i++) {
      args[i] = arguments[i];
    }

    // add this call to the queue
    me.queue({
      args: args,
      fn: original,
      context: this
    });
  };
};

/**
 * Queue a call
 * @param {function | {fn: function, args: Array} | {fn: function, args: Array, context: Object}} entry
 */
Queue.prototype.queue = function(entry) {
  if (typeof entry === 'function') {
    this._queue.push({fn: entry});
  }
  else {
    this._queue.push(entry);
  }

  this._flushIfNeeded();
};

/**
 * Check whether the queue needs to be flushed
 * @private
 */
Queue.prototype._flushIfNeeded = function () {
  // flush when the maximum is exceeded.
  if (this._queue.length > this.max) {
    this.flush();
  }

  // flush after a period of inactivity when a delay is configured
  clearTimeout(this._timeout);
  if (this.queue.length > 0 && typeof this.delay === 'number') {
    var me = this;
    this._timeout = setTimeout(function () {
      me.flush();
    }, this.delay);
  }
};

/**
 * Flush all queued calls
 */
Queue.prototype.flush = function () {
  while (this._queue.length > 0) {
    var entry = this._queue.shift();
    entry.fn.apply(entry.context || entry.fn, entry.args || []);
  }
};

module.exports = Queue;

},{}],5:[function(require,module,exports){
var Hammer = require('./module/hammer');

/**
 * Fake a hammer.js gesture. Event can be a ScrollEvent or MouseMoveEvent
 * @param {Element} element
 * @param {Event} event
 */
exports.fakeGesture = function(element, event) {
  var eventType = null;

  // for hammer.js 1.0.5
  // var gesture = Hammer.event.collectEventData(this, eventType, event);

  // for hammer.js 1.0.6+
  var touches = Hammer.event.getTouchList(event, eventType);
  var gesture = Hammer.event.collectEventData(this, eventType, touches, event);

  // on IE in standards mode, no touches are recognized by hammer.js,
  // resulting in NaN values for center.pageX and center.pageY
  if (isNaN(gesture.center.pageX)) {
    gesture.center.pageX = event.pageX;
  }
  if (isNaN(gesture.center.pageY)) {
    gesture.center.pageY = event.pageY;
  }

  return gesture;
};

},{"./module/hammer":6}],6:[function(require,module,exports){
// Only load hammer.js when in a browser environment
// (loading hammer.js in a node.js environment gives errors)
if (typeof window !== 'undefined') {
  module.exports = window['Hammer'] || require('hammerjs');
}
else {
  module.exports = function () {
    throw Error('hammer.js is only available in a browser, not in node.js.');
  }
}

},{"hammerjs":30}],7:[function(require,module,exports){
// first check if moment.js is already loaded in the browser window, if so,
// use this instance. Else, load via commonjs.
module.exports = (typeof window !== 'undefined') && window['moment'] || require('moment');

},{"moment":"moment"}],8:[function(require,module,exports){
var keycharm = require('keycharm');
var Emitter = require('emitter-component');
var Hammer = require('../module/hammer');
var util = require('../util');

/**
 * Turn an element into an clickToUse element.
 * When not active, the element has a transparent overlay. When the overlay is
 * clicked, the mode is changed to active.
 * When active, the element is displayed with a blue border around it, and
 * the interactive contents of the element can be used. When clicked outside
 * the element, the elements mode is changed to inactive.
 * @param {Element} container
 * @constructor
 */
function Activator(container) {
  this.active = false;

  this.dom = {
    container: container
  };

  this.dom.overlay = document.createElement('div');
  this.dom.overlay.className = 'overlay';

  this.dom.container.appendChild(this.dom.overlay);

  this.hammer = Hammer(this.dom.overlay, {prevent_default: false});
  this.hammer.on('tap', this._onTapOverlay.bind(this));

  // block all touch events (except tap)
  var me = this;
  var events = [
    'touch', 'pinch',
    'doubletap', 'hold',
    'dragstart', 'drag', 'dragend',
    'mousewheel', 'DOMMouseScroll' // DOMMouseScroll is needed for Firefox
  ];
  events.forEach(function (event) {
    me.hammer.on(event, function (event) {
      event.stopPropagation();
    });
  });

  // attach a tap event to the window, in order to deactivate when clicking outside the timeline
  this.windowHammer = Hammer(window, {prevent_default: false});
  this.windowHammer.on('tap', function (event) {
    // deactivate when clicked outside the container
    if (!_hasParent(event.target, container)) {
      me.deactivate();
    }
  });

  if (this.keycharm !== undefined) {
    this.keycharm.destroy();
  }
  this.keycharm = keycharm();

  // keycharm listener only bounded when active)
  this.escListener = this.deactivate.bind(this);
}

// turn into an event emitter
Emitter(Activator.prototype);

// The currently active activator
Activator.current = null;

/**
 * Destroy the activator. Cleans up all created DOM and event listeners
 */
Activator.prototype.destroy = function () {
  this.deactivate();

  // remove dom
  this.dom.overlay.parentNode.removeChild(this.dom.overlay);

  // cleanup hammer instances
  this.hammer = null;
  this.windowHammer = null;
  // FIXME: cleaning up hammer instances doesn't work (Timeline not removed from memory)
};

/**
 * Activate the element
 * Overlay is hidden, element is decorated with a blue shadow border
 */
Activator.prototype.activate = function () {
  // we allow only one active activator at a time
  if (Activator.current) {
    Activator.current.deactivate();
  }
  Activator.current = this;

  this.active = true;
  this.dom.overlay.style.display = 'none';
  util.addClassName(this.dom.container, 'vis-active');

  this.emit('change');
  this.emit('activate');

  // ugly hack: bind ESC after emitting the events, as the Network rebinds all
  // keyboard events on a 'change' event
  this.keycharm.bind('esc', this.escListener);
};

/**
 * Deactivate the element
 * Overlay is displayed on top of the element
 */
Activator.prototype.deactivate = function () {
  this.active = false;
  this.dom.overlay.style.display = '';
  util.removeClassName(this.dom.container, 'vis-active');
  this.keycharm.unbind('esc', this.escListener);

  this.emit('change');
  this.emit('deactivate');
};

/**
 * Handle a tap event: activate the container
 * @param event
 * @private
 */
Activator.prototype._onTapOverlay = function (event) {
  // activate the container
  this.activate();
  event.stopPropagation();
};

/**
 * Test whether the element has the requested parent element somewhere in
 * its chain of parent nodes.
 * @param {HTMLElement} element
 * @param {HTMLElement} parent
 * @returns {boolean} Returns true when the parent is found somewhere in the
 *                    chain of parent nodes.
 * @private
 */
function _hasParent(element, parent) {
  while (element) {
    if (element === parent) {
      return true
    }
    element = element.parentNode;
  }
  return false;
}

module.exports = Activator;

},{"../module/hammer":6,"../util":28,"emitter-component":29,"keycharm":31}],9:[function(require,module,exports){
var Emitter = require('emitter-component');
var Hammer = require('../module/hammer');
var util = require('../util');
var DataSet = require('../DataSet');
var DataView = require('../DataView');
var Range = require('./Range');
var ItemSet = require('./component/ItemSet');
var TimeAxis = require('./component/TimeAxis');
var Activator = require('../shared/Activator');
var DateUtil = require('./DateUtil');
var CustomTime = require('./component/CustomTime');

/**
 * Create a timeline visualization
 * @param {HTMLElement} container
 * @param {vis.DataSet | Array | google.visualization.DataTable} [items]
 * @param {Object} [options]  See Core.setOptions for the available options.
 * @constructor
 */
function Core () {}

// turn Core into an event emitter
Emitter(Core.prototype);

/**
 * Create the main DOM for the Core: a root panel containing left, right,
 * top, bottom, content, and background panel.
 * @param {Element} container  The container element where the Core will
 *                             be attached.
 * @protected
 */
Core.prototype._create = function (container) {
  this.dom = {};

  this.dom.root                 = document.createElement('div');
  this.dom.background           = document.createElement('div');
  this.dom.backgroundVertical   = document.createElement('div');
  this.dom.backgroundHorizontal = document.createElement('div');
  this.dom.centerContainer      = document.createElement('div');
  this.dom.leftContainer        = document.createElement('div');
  this.dom.rightContainer       = document.createElement('div');
  this.dom.center               = document.createElement('div');
  this.dom.left                 = document.createElement('div');
  this.dom.right                = document.createElement('div');
  this.dom.top                  = document.createElement('div');
  this.dom.bottom               = document.createElement('div');
  this.dom.shadowTop            = document.createElement('div');
  this.dom.shadowBottom         = document.createElement('div');
  this.dom.shadowTopLeft        = document.createElement('div');
  this.dom.shadowBottomLeft     = document.createElement('div');
  this.dom.shadowTopRight       = document.createElement('div');
  this.dom.shadowBottomRight    = document.createElement('div');

  this.dom.root.className                 = 'vis timeline root';
  this.dom.background.className           = 'vispanel background';
  this.dom.backgroundVertical.className   = 'vispanel background vertical';
  this.dom.backgroundHorizontal.className = 'vispanel background horizontal';
  this.dom.centerContainer.className      = 'vispanel center';
  this.dom.leftContainer.className        = 'vispanel left';
  this.dom.rightContainer.className       = 'vispanel right';
  this.dom.top.className                  = 'vispanel top';
  this.dom.bottom.className               = 'vispanel bottom';
  this.dom.left.className                 = 'content';
  this.dom.center.className               = 'content';
  this.dom.right.className                = 'content';
  this.dom.shadowTop.className            = 'shadow top';
  this.dom.shadowBottom.className         = 'shadow bottom';
  this.dom.shadowTopLeft.className        = 'shadow top';
  this.dom.shadowBottomLeft.className     = 'shadow bottom';
  this.dom.shadowTopRight.className       = 'shadow top';
  this.dom.shadowBottomRight.className    = 'shadow bottom';

  this.dom.root.appendChild(this.dom.background);
  this.dom.root.appendChild(this.dom.backgroundVertical);
  this.dom.root.appendChild(this.dom.backgroundHorizontal);
  this.dom.root.appendChild(this.dom.centerContainer);
  this.dom.root.appendChild(this.dom.leftContainer);
  this.dom.root.appendChild(this.dom.rightContainer);
  this.dom.root.appendChild(this.dom.top);
  this.dom.root.appendChild(this.dom.bottom);

  this.dom.centerContainer.appendChild(this.dom.center);
  this.dom.leftContainer.appendChild(this.dom.left);
  this.dom.rightContainer.appendChild(this.dom.right);

  this.dom.centerContainer.appendChild(this.dom.shadowTop);
  this.dom.centerContainer.appendChild(this.dom.shadowBottom);
  this.dom.leftContainer.appendChild(this.dom.shadowTopLeft);
  this.dom.leftContainer.appendChild(this.dom.shadowBottomLeft);
  this.dom.rightContainer.appendChild(this.dom.shadowTopRight);
  this.dom.rightContainer.appendChild(this.dom.shadowBottomRight);

  this.on('rangechange', this._redraw.bind(this));
  this.on('touch', this._onTouch.bind(this));
  this.on('pinch', this._onPinch.bind(this));
  this.on('dragstart', this._onDragStart.bind(this));
  this.on('drag', this._onDrag.bind(this));

  var me = this;
  this.on('change', function (properties) {
    if (properties && properties.queue == true) {
      // redraw once on next tick
      if (!me._redrawTimer) {
        me._redrawTimer = setTimeout(function () {
          me._redrawTimer = null;
          me._redraw();
        }, 0)
      }
    }
    else {
      // redraw immediately
      me._redraw();
    }
  });

  // create event listeners for all interesting events, these events will be
  // emitted via emitter
  this.hammer = Hammer(this.dom.root, {
    preventDefault: true
  });
  this.listeners = {};

  var events = [
    'touch', 'pinch',
    'tap', 'doubletap', 'hold',
    'dragstart', 'drag', 'dragend',
    'mousewheel', 'DOMMouseScroll' // DOMMouseScroll is needed for Firefox
  ];
  events.forEach(function (event) {
    var listener = function () {
      var args = [event].concat(Array.prototype.slice.call(arguments, 0));
      if (me.isActive()) {
        me.emit.apply(me, args);
      }
    };
    me.hammer.on(event, listener);
    me.listeners[event] = listener;
  });

  // size properties of each of the panels
  this.props = {
    root: {},
    background: {},
    centerContainer: {},
    leftContainer: {},
    rightContainer: {},
    center: {},
    left: {},
    right: {},
    top: {},
    bottom: {},
    border: {},
    scrollTop: 0,
    scrollTopMin: 0
  };
  this.touch = {}; // store state information needed for touch events

  this.redrawCount = 0;

  // attach the root panel to the provided container
  if (!container) throw new Error('No container provided');
  container.appendChild(this.dom.root);
};

/**
 * Set options. Options will be passed to all components loaded in the Timeline.
 * @param {Object} [options]
 *                           {String} orientation
 *                              Vertical orientation for the Timeline,
 *                              can be 'bottom' (default) or 'top'.
 *                           {String | Number} width
 *                              Width for the timeline, a number in pixels or
 *                              a css string like '1000px' or '75%'. '100%' by default.
 *                           {String | Number} height
 *                              Fixed height for the Timeline, a number in pixels or
 *                              a css string like '400px' or '75%'. If undefined,
 *                              The Timeline will automatically size such that
 *                              its contents fit.
 *                           {String | Number} minHeight
 *                              Minimum height for the Timeline, a number in pixels or
 *                              a css string like '400px' or '75%'.
 *                           {String | Number} maxHeight
 *                              Maximum height for the Timeline, a number in pixels or
 *                              a css string like '400px' or '75%'.
 *                           {Number | Date | String} start
 *                              Start date for the visible window
 *                           {Number | Date | String} end
 *                              End date for the visible window
 */
Core.prototype.setOptions = function (options) {
  if (options) {
    // copy the known options
    var fields = ['width', 'height', 'minHeight', 'maxHeight', 'autoResize', 'start', 'end', 'clickToUse', 'dataAttributes', 'hiddenDates'];
    util.selectiveExtend(fields, this.options, options);

    if ('orientation' in options) {
      if (typeof options.orientation === 'string') {
        this.options.orientation = options.orientation;
      }
      else if (typeof options.orientation === 'object' && 'axis' in options.orientation) {
        this.options.orientation = options.orientation.axis;
      }
    }

    if (this.options.orientation === 'both') {
      if (!this.timeAxis2) {
        var timeAxis2 = this.timeAxis2 = new TimeAxis(this.body);
        timeAxis2.setOptions = function (options) {
          var _options = options ? util.extend({}, options) : {};
          _options.orientation = 'top'; // override the orientation option, always top
          TimeAxis.prototype.setOptions.call(timeAxis2, _options);
        };
        this.components.push(timeAxis2);
      }
    }
    else {
      if (this.timeAxis2) {
        var index = this.components.indexOf(this.timeAxis2);
        if (index !== -1) {
          this.components.splice(index, 1);
        }
        this.timeAxis2.destroy();
        this.timeAxis2 = null;
      }
    }

    if ('hiddenDates' in this.options) {
      DateUtil.convertHiddenOptions(this.body, this.options.hiddenDates);
    }

    if ('clickToUse' in options) {
      if (options.clickToUse) {
        if (!this.activator) {
          this.activator = new Activator(this.dom.root);
        }
      }
      else {
        if (this.activator) {
          this.activator.destroy();
          delete this.activator;
        }
      }
    }

    // enable/disable autoResize
    this._initAutoResize();
  }

  // propagate options to all components
  this.components.forEach(function (component) {
    component.setOptions(options);
  });

  // redraw everything
  this._redraw();
};

/**
 * Returns true when the Timeline is active.
 * @returns {boolean}
 */
Core.prototype.isActive = function () {
  return !this.activator || this.activator.active;
};

/**
 * Destroy the Core, clean up all DOM elements and event listeners.
 */
Core.prototype.destroy = function () {
  // unbind datasets
  this.clear();

  // remove all event listeners
  this.off();

  // stop checking for changed size
  this._stopAutoResize();

  // remove from DOM
  if (this.dom.root.parentNode) {
    this.dom.root.parentNode.removeChild(this.dom.root);
  }
  this.dom = null;

  // remove Activator
  if (this.activator) {
    this.activator.destroy();
    delete this.activator;
  }

  // cleanup hammer touch events
  for (var event in this.listeners) {
    if (this.listeners.hasOwnProperty(event)) {
      delete this.listeners[event];
    }
  }
  this.listeners = null;
  this.hammer = null;

  // give all components the opportunity to cleanup
  this.components.forEach(function (component) {
    component.destroy();
  });

  this.body = null;
};


/**
 * Set a custom time bar
 * @param {Date} time
 * @param {int} id
 */
Core.prototype.setCustomTime = function (time, id) {
  if (!this.customTime) {
    throw new Error('Cannot get custom time: Custom time bar is not enabled');
  }

  var barId = id || 0;

  this.components.forEach(function (element, index, components) {
    if (element instanceof CustomTime && element.options.id === barId) {
      element.setCustomTime(time);
    }
  });
};

/**
 * Retrieve the current custom time.
 * @return {Date} customTime
 * @param {int} id
 */
Core.prototype.getCustomTime = function(id) {
  if (!this.customTime) {
    throw new Error('Cannot get custom time: Custom time bar is not enabled');
  }

  var barId = id || 0,
      customTime = this.customTime.getCustomTime();

  this.components.forEach(function (element, index, components) {
    if (element instanceof CustomTime && element.options.id === barId) {
      customTime = element.getCustomTime();
    }
  });

  return customTime;
};

/**
 * Add custom vertical bar
 * @param {Date | String | Number} time  A Date, unix timestamp, or
 *                                      ISO date string. Time point where the new bar should be placed
 * @param {Number | String} ID of the new bar
 * @return {Number | String} ID of the new bar
 */
Core.prototype.addCustomTime = function (time, id) {
  if (!this.currentTime) {
    throw new Error('Option showCurrentTime must be true');
  }

  if (time === undefined) {
    throw new Error('Time parameter for the custom bar must be provided');
  }

  var ts = util.convert(time, 'Date').valueOf(),
      numIds, customTime, customBarId;

  // All bar IDs are kept in 1 array, mixed types
  // Bar with ID 0 is the default bar.
  if (!this.customBarIds || this.customBarIds.constructor !== Array) {
    this.customBarIds = [0];
  }

  // If the ID is not provided, generate one, otherwise just use it
  if (id === undefined) {

    numIds = this.customBarIds.filter(function (element) {
      return util.isNumber(element);
    });

    customBarId = numIds.length > 0 ? Math.max.apply(null, numIds) + 1 : 1;

  } else {
    
    // Check for duplicates
    this.customBarIds.forEach(function (element) {
      if (element === id) {
        throw new Error('Custom time ID already exists');
      }
    });

    customBarId = id;
  }

  this.customBarIds.push(customBarId);

  customTime = new CustomTime(this.body, {
    showCustomTime : true,
    time : ts,
    id : customBarId
  });

  this.components.push(customTime);
  this.redraw();

  return customBarId;
};

/**
 * Remove previously added custom bar
 * @param {int} id ID of the custom bar to be removed
 * @return {boolean} True if the bar exists and is removed, false otherwise
 */
Core.prototype.removeCustomTime = function (id) {

  var me = this;

  this.components.forEach(function (bar, index, components) {
    if (bar instanceof CustomTime && bar.options.id === id) {
      // Only the lines added by the user will be removed
      if (bar.options.id !== 0) {
        me.customBarIds.splice(me.customBarIds.indexOf(id), 1);
        components.splice(index, 1);
        bar.destroy();
      }
    }
  });
};


/**
 * Get the id's of the currently visible items.
 * @returns {Array} The ids of the visible items
 */
Core.prototype.getVisibleItems = function() {
  return this.itemSet && this.itemSet.getVisibleItems() || [];
};



/**
 * Clear the Core. By Default, items, groups and options are cleared.
 * Example usage:
 *
 *     timeline.clear();                // clear items, groups, and options
 *     timeline.clear({options: true}); // clear options only
 *
 * @param {Object} [what]      Optionally specify what to clear. By default:
 *                             {items: true, groups: true, options: true}
 */
Core.prototype.clear = function(what) {
  // clear items
  if (!what || what.items) {
    this.setItems(null);
  }

  // clear groups
  if (!what || what.groups) {
    this.setGroups(null);
  }

  // clear options of timeline and of each of the components
  if (!what || what.options) {
    this.components.forEach(function (component) {
      component.setOptions(component.defaultOptions);
    });

    this.setOptions(this.defaultOptions); // this will also do a redraw
  }
};

/**
 * Set Core window such that it fits all items
 * @param {Object} [options]  Available options:
 *                            `animate: boolean | number`
 *                                 If true (default), the range is animated
 *                                 smoothly to the new window.
 *                                 If a number, the number is taken as duration
 *                                 for the animation. Default duration is 500 ms.
 */
Core.prototype.fit = function(options) {
  var range = this._getDataRange();

  // skip range set if there is no start and end date
  if (range.start === null && range.end === null) {
    return;
  }

  var animate = (options && options.animate !== undefined) ? options.animate : true;
  this.range.setRange(range.start, range.end, animate);
};

/**
 * Calculate the data range of the items and applies a 5% window around it.
 * @returns {{start: Date | null, end: Date | null}}
 * @protected
 */
Core.prototype._getDataRange = function() {
  // apply the data range as range
  var dataRange = this.getItemRange();

  // add 5% space on both sides
  var start = dataRange.min;
  var end = dataRange.max;
  if (start != null && end != null) {
    var interval = (end.valueOf() - start.valueOf());
    if (interval <= 0) {
      // prevent an empty interval
      interval = 24 * 60 * 60 * 1000; // 1 day
    }
    start = new Date(start.valueOf() - interval * 0.05);
    end = new Date(end.valueOf() + interval * 0.05);
  }

  return {
    start: start,
    end: end
  }
};

/**
 * Set the visible window. Both parameters are optional, you can change only
 * start or only end. Syntax:
 *
 *     TimeLine.setWindow(start, end)
 *     TimeLine.setWindow(start, end, options)
 *     TimeLine.setWindow(range)
 *
 * Where start and end can be a Date, number, or string, and range is an
 * object with properties start and end.
 *
 * @param {Date | Number | String | Object} [start] Start date of visible window
 * @param {Date | Number | String} [end]            End date of visible window
 * @param {Object} [options]  Available options:
 *                            `animate: boolean | number`
 *                                 If true (default), the range is animated
 *                                 smoothly to the new window.
 *                                 If a number, the number is taken as duration
 *                                 for the animation. Default duration is 500 ms.
 */
Core.prototype.setWindow = function(start, end, options) {
  var animate;
  if (arguments.length == 1) {
    var range = arguments[0];
    animate = (range.animate !== undefined) ? range.animate : true;
    this.range.setRange(range.start, range.end, animate);
  }
  else {
    animate = (options && options.animate !== undefined) ? options.animate : true;
    this.range.setRange(start, end, animate);
  }
};

/**
 * Move the window such that given time is centered on screen.
 * @param {Date | Number | String} time
 * @param {Object} [options]  Available options:
 *                            `animate: boolean | number`
 *                                 If true (default), the range is animated
 *                                 smoothly to the new window.
 *                                 If a number, the number is taken as duration
 *                                 for the animation. Default duration is 500 ms.
 */
Core.prototype.moveTo = function(time, options) {
  var interval = this.range.end - this.range.start;
  var t = util.convert(time, 'Date').valueOf();

  var start = t - interval / 2;
  var end = t + interval / 2;
  var animate = (options && options.animate !== undefined) ? options.animate : true;

  this.range.setRange(start, end, animate);
};

/**
 * Get the visible window
 * @return {{start: Date, end: Date}}   Visible range
 */
Core.prototype.getWindow = function() {
  var range = this.range.getRange();
  return {
    start: new Date(range.start),
    end: new Date(range.end)
  };
};

/**
 * Force a redraw. Can be overridden by implementations of Core
 */
Core.prototype.redraw = function() {
  this._redraw();
};

/**
 * Redraw for internal use. Redraws all components. See also the public
 * method redraw.
 * @protected
 */
Core.prototype._redraw = function() {
  var resized = false;
  var options = this.options;
  var props = this.props;
  var dom = this.dom;

  if (!dom) return; // when destroyed

  DateUtil.updateHiddenDates(this.body, this.options.hiddenDates);

  // update class names
  if (options.orientation == 'top') {
    util.addClassName(dom.root, 'top');
    util.removeClassName(dom.root, 'bottom');
  }
  else {
    util.removeClassName(dom.root, 'top');
    util.addClassName(dom.root, 'bottom');
  }

  // update root width and height options
  dom.root.style.maxHeight = util.option.asSize(options.maxHeight, '');
  dom.root.style.minHeight = util.option.asSize(options.minHeight, '');
  dom.root.style.width = util.option.asSize(options.width, '');

  // calculate border widths
  props.border.left   = (dom.centerContainer.offsetWidth - dom.centerContainer.clientWidth) / 2;
  props.border.right  = props.border.left;
  props.border.top    = (dom.centerContainer.offsetHeight - dom.centerContainer.clientHeight) / 2;
  props.border.bottom = props.border.top;
  var borderRootHeight= dom.root.offsetHeight - dom.root.clientHeight;
  var borderRootWidth = dom.root.offsetWidth - dom.root.clientWidth;

  // workaround for a bug in IE: the clientWidth of an element with
  // a height:0px and overflow:hidden is not calculated and always has value 0
  if (dom.centerContainer.clientHeight === 0) {
    props.border.left = props.border.top;
    props.border.right  = props.border.left;
  }
  if (dom.root.clientHeight === 0) {
    borderRootWidth = borderRootHeight;
  }

  // calculate the heights. If any of the side panels is empty, we set the height to
  // minus the border width, such that the border will be invisible
  props.center.height = dom.center.offsetHeight;
  props.left.height   = dom.left.offsetHeight;
  props.right.height  = dom.right.offsetHeight;
  props.top.height    = dom.top.clientHeight    || -props.border.top;
  props.bottom.height = dom.bottom.clientHeight || -props.border.bottom;

  // TODO: compensate borders when any of the panels is empty.

  // apply auto height
  // TODO: only calculate autoHeight when needed (else we cause an extra reflow/repaint of the DOM)
  var contentHeight = Math.max(props.left.height, props.center.height, props.right.height);
  var autoHeight = props.top.height + contentHeight + props.bottom.height +
    borderRootHeight + props.border.top + props.border.bottom;
  dom.root.style.height = util.option.asSize(options.height, autoHeight + 'px');

  // calculate heights of the content panels
  props.root.height = dom.root.offsetHeight;
  props.background.height = props.root.height - borderRootHeight;
  var containerHeight = props.root.height - props.top.height - props.bottom.height -
    borderRootHeight;
  props.centerContainer.height  = containerHeight;
  props.leftContainer.height    = containerHeight;
  props.rightContainer.height   = props.leftContainer.height;

  // calculate the widths of the panels
  props.root.width = dom.root.offsetWidth;
  props.background.width = props.root.width - borderRootWidth;
  props.left.width = dom.leftContainer.clientWidth   || -props.border.left;
  props.leftContainer.width = props.left.width;
  props.right.width = dom.rightContainer.clientWidth || -props.border.right;
  props.rightContainer.width = props.right.width;
  var centerWidth = props.root.width - props.left.width - props.right.width - borderRootWidth;
  props.center.width          = centerWidth;
  props.centerContainer.width = centerWidth;
  props.top.width             = centerWidth;
  props.bottom.width          = centerWidth;

  // resize the panels
  dom.background.style.height           = props.background.height + 'px';
  dom.backgroundVertical.style.height   = props.background.height + 'px';
  dom.backgroundHorizontal.style.height = props.centerContainer.height + 'px';
  dom.centerContainer.style.height      = props.centerContainer.height + 'px';
  dom.leftContainer.style.height        = props.leftContainer.height + 'px';
  dom.rightContainer.style.height       = props.rightContainer.height + 'px';

  dom.background.style.width            = props.background.width + 'px';
  dom.backgroundVertical.style.width    = props.centerContainer.width + 'px';
  dom.backgroundHorizontal.style.width  = props.background.width + 'px';
  dom.centerContainer.style.width       = props.center.width + 'px';
  dom.top.style.width                   = props.top.width + 'px';
  dom.bottom.style.width                = props.bottom.width + 'px';

  // reposition the panels
  dom.background.style.left           = '0';
  dom.background.style.top            = '0';
  dom.backgroundVertical.style.left   = (props.left.width + props.border.left) + 'px';
  dom.backgroundVertical.style.top    = '0';
  dom.backgroundHorizontal.style.left = '0';
  dom.backgroundHorizontal.style.top  = props.top.height + 'px';
  dom.centerContainer.style.left      = props.left.width + 'px';
  dom.centerContainer.style.top       = props.top.height + 'px';
  dom.leftContainer.style.left        = '0';
  dom.leftContainer.style.top         = props.top.height + 'px';
  dom.rightContainer.style.left       = (props.left.width + props.center.width) + 'px';
  dom.rightContainer.style.top        = props.top.height + 'px';
  dom.top.style.left                  = props.left.width + 'px';
  dom.top.style.top                   = '0';
  dom.bottom.style.left               = props.left.width + 'px';
  dom.bottom.style.top                = (props.top.height + props.centerContainer.height) + 'px';

  // update the scrollTop, feasible range for the offset can be changed
  // when the height of the Core or of the contents of the center changed
  this._updateScrollTop();

  // reposition the scrollable contents
  var offset = this.props.scrollTop;
  if (options.orientation == 'bottom') {
    offset += Math.max(this.props.centerContainer.height - this.props.center.height -
      this.props.border.top - this.props.border.bottom, 0);
  }
  dom.center.style.left = '0';
  dom.center.style.top  = offset + 'px';
  dom.left.style.left   = '0';
  dom.left.style.top    = offset + 'px';
  dom.right.style.left  = '0';
  dom.right.style.top   = offset + 'px';

  // show shadows when vertical scrolling is available
  var visibilityTop = this.props.scrollTop == 0 ? 'hidden' : '';
  var visibilityBottom = this.props.scrollTop == this.props.scrollTopMin ? 'hidden' : '';
  dom.shadowTop.style.visibility          = visibilityTop;
  dom.shadowBottom.style.visibility       = visibilityBottom;
  dom.shadowTopLeft.style.visibility      = visibilityTop;
  dom.shadowBottomLeft.style.visibility   = visibilityBottom;
  dom.shadowTopRight.style.visibility     = visibilityTop;
  dom.shadowBottomRight.style.visibility  = visibilityBottom;

  // redraw all components
  this.components.forEach(function (component) {
    resized = component.redraw() || resized;
  });
  if (resized) {
    // keep repainting until all sizes are settled
    var MAX_REDRAWS = 3; // maximum number of consecutive redraws
    if (this.redrawCount < MAX_REDRAWS) {
      this.redrawCount++;
      this._redraw();
    }
    else {
      console.log('WARNING: infinite loop in redraw?');
    }
    this.redrawCount = 0;
  }

  this.emit("finishedRedraw");
};

// TODO: deprecated since version 1.1.0, remove some day
Core.prototype.repaint = function () {
  throw new Error('Function repaint is deprecated. Use redraw instead.');
};

/**
 * Set a current time. This can be used for example to ensure that a client's
 * time is synchronized with a shared server time.
 * Only applicable when option `showCurrentTime` is true.
 * @param {Date | String | Number} time     A Date, unix timestamp, or
 *                                          ISO date string.
 */
Core.prototype.setCurrentTime = function(time) {
  if (!this.currentTime) {
    throw new Error('Option showCurrentTime must be true');
  }

  this.currentTime.setCurrentTime(time);
};

/**
 * Get the current time.
 * Only applicable when option `showCurrentTime` is true.
 * @return {Date} Returns the current time.
 */
Core.prototype.getCurrentTime = function() {
  if (!this.currentTime) {
    throw new Error('Option showCurrentTime must be true');
  }

  return this.currentTime.getCurrentTime();
};

/**
 * Convert a position on screen (pixels) to a datetime
 * @param {int}     x    Position on the screen in pixels
 * @return {Date}   time The datetime the corresponds with given position x
 * @protected
 */
// TODO: move this function to Range
Core.prototype._toTime = function(x) {
  return DateUtil.toTime(this, x, this.props.center.width);
};

/**
 * Convert a position on the global screen (pixels) to a datetime
 * @param {int}     x    Position on the screen in pixels
 * @return {Date}   time The datetime the corresponds with given position x
 * @protected
 */
// TODO: move this function to Range
Core.prototype._toGlobalTime = function(x) {
  return DateUtil.toTime(this, x, this.props.root.width);
  //var conversion = this.range.conversion(this.props.root.width);
  //return new Date(x / conversion.scale + conversion.offset);
};

/**
 * Convert a datetime (Date object) into a position on the screen
 * @param {Date}   time A date
 * @return {int}   x    The position on the screen in pixels which corresponds
 *                      with the given date.
 * @protected
 */
// TODO: move this function to Range
Core.prototype._toScreen = function(time) {
  return DateUtil.toScreen(this, time, this.props.center.width);
};



/**
 * Convert a datetime (Date object) into a position on the root
 * This is used to get the pixel density estimate for the screen, not the center panel
 * @param {Date}   time A date
 * @return {int}   x    The position on root in pixels which corresponds
 *                      with the given date.
 * @protected
 */
// TODO: move this function to Range
Core.prototype._toGlobalScreen = function(time) {
  return DateUtil.toScreen(this, time, this.props.root.width);
  //var conversion = this.range.conversion(this.props.root.width);
  //return (time.valueOf() - conversion.offset) * conversion.scale;
};


/**
 * Initialize watching when option autoResize is true
 * @private
 */
Core.prototype._initAutoResize = function () {
  if (this.options.autoResize == true) {
    this._startAutoResize();
  }
  else {
    this._stopAutoResize();
  }
};

/**
 * Watch for changes in the size of the container. On resize, the Panel will
 * automatically redraw itself.
 * @private
 */
Core.prototype._startAutoResize = function () {
  var me = this;

  this._stopAutoResize();

  this._onResize = function() {
    if (me.options.autoResize != true) {
      // stop watching when the option autoResize is changed to false
      me._stopAutoResize();
      return;
    }

    if (me.dom.root) {
      // check whether the frame is resized
      // Note: we compare offsetWidth here, not clientWidth. For some reason,
      // IE does not restore the clientWidth from 0 to the actual width after
      // changing the timeline's container display style from none to visible
      if ((me.dom.root.offsetWidth != me.props.lastWidth) ||
        (me.dom.root.offsetHeight != me.props.lastHeight)) {
        me.props.lastWidth = me.dom.root.offsetWidth;
        me.props.lastHeight = me.dom.root.offsetHeight;

        me.emit('change');
      }
    }
  };

  // add event listener to window resize
  util.addEventListener(window, 'resize', this._onResize);

  this.watchTimer = setInterval(this._onResize, 1000);
};

/**
 * Stop watching for a resize of the frame.
 * @private
 */
Core.prototype._stopAutoResize = function () {
  if (this.watchTimer) {
    clearInterval(this.watchTimer);
    this.watchTimer = undefined;
  }

  // remove event listener on window.resize
  util.removeEventListener(window, 'resize', this._onResize);
  this._onResize = null;
};

/**
 * Start moving the timeline vertically
 * @param {Event} event
 * @private
 */
Core.prototype._onTouch = function (event) {
  this.touch.allowDragging = true;
};

/**
 * Start moving the timeline vertically
 * @param {Event} event
 * @private
 */
Core.prototype._onPinch = function (event) {
  this.touch.allowDragging = false;
};

/**
 * Start moving the timeline vertically
 * @param {Event} event
 * @private
 */
Core.prototype._onDragStart = function (event) {
  this.touch.initialScrollTop = this.props.scrollTop;
};

/**
 * Move the timeline vertically
 * @param {Event} event
 * @private
 */
Core.prototype._onDrag = function (event) {
  // refuse to drag when we where pinching to prevent the timeline make a jump
  // when releasing the fingers in opposite order from the touch screen
  if (!this.touch.allowDragging) return;

  var delta = event.gesture.deltaY;

  var oldScrollTop = this._getScrollTop();
  var newScrollTop = this._setScrollTop(this.touch.initialScrollTop + delta);


  if (newScrollTop != oldScrollTop) {
    this._redraw(); // TODO: this causes two redraws when dragging, the other is triggered by rangechange already
    this.emit("verticalDrag");
  }
};

/**
 * Apply a scrollTop
 * @param {Number} scrollTop
 * @returns {Number} scrollTop  Returns the applied scrollTop
 * @private
 */
Core.prototype._setScrollTop = function (scrollTop) {
  this.props.scrollTop = scrollTop;
  this._updateScrollTop();
  return this.props.scrollTop;
};

/**
 * Update the current scrollTop when the height of  the containers has been changed
 * @returns {Number} scrollTop  Returns the applied scrollTop
 * @private
 */
Core.prototype._updateScrollTop = function () {
  // recalculate the scrollTopMin
  var scrollTopMin = Math.min(this.props.centerContainer.height - this.props.center.height, 0); // is negative or zero
  if (scrollTopMin != this.props.scrollTopMin) {
    // in case of bottom orientation, change the scrollTop such that the contents
    // do not move relative to the time axis at the bottom
    if (this.options.orientation == 'bottom') {
      this.props.scrollTop += (scrollTopMin - this.props.scrollTopMin);
    }
    this.props.scrollTopMin = scrollTopMin;
  }

  // limit the scrollTop to the feasible scroll range
  if (this.props.scrollTop > 0) this.props.scrollTop = 0;
  if (this.props.scrollTop < scrollTopMin) this.props.scrollTop = scrollTopMin;

  return this.props.scrollTop;
};

/**
 * Get the current scrollTop
 * @returns {number} scrollTop
 * @private
 */
Core.prototype._getScrollTop = function () {
  return this.props.scrollTop;
};

module.exports = Core;

},{"../DataSet":2,"../DataView":3,"../module/hammer":6,"../shared/Activator":8,"../util":28,"./DateUtil":10,"./Range":11,"./component/CustomTime":18,"./component/ItemSet":20,"./component/TimeAxis":21,"emitter-component":29}],10:[function(require,module,exports){
/**
 * Created by Alex on 10/3/2014.
 */
var moment = require('../module/moment');


/**
 * used in Core to convert the options into a volatile variable
 * 
 * @param Core
 */
exports.convertHiddenOptions = function(body, hiddenDates) {
  body.hiddenDates = [];
  if (hiddenDates) {
    if (Array.isArray(hiddenDates) == true) {
      for (var i = 0; i < hiddenDates.length; i++) {
        if (hiddenDates[i].repeat === undefined) {
          var dateItem = {};
          dateItem.start = moment(hiddenDates[i].start).toDate().valueOf();
          dateItem.end = moment(hiddenDates[i].end).toDate().valueOf();
          body.hiddenDates.push(dateItem);
        }
      }
      body.hiddenDates.sort(function (a, b) {
        return a.start - b.start;
      }); // sort by start time
    }
  }
};


/**
 * create new entrees for the repeating hidden dates
 * @param body
 * @param hiddenDates
 */
exports.updateHiddenDates = function (body, hiddenDates) {
  if (hiddenDates && body.domProps.centerContainer.width !== undefined) {
    exports.convertHiddenOptions(body, hiddenDates);

    var start = moment(body.range.start);
    var end = moment(body.range.end);

    var totalRange = (body.range.end - body.range.start);
    var pixelTime = totalRange / body.domProps.centerContainer.width;

    for (var i = 0; i < hiddenDates.length; i++) {
      if (hiddenDates[i].repeat !== undefined) {
        var startDate = moment(hiddenDates[i].start);
        var endDate = moment(hiddenDates[i].end);

        if (startDate._d == "Invalid Date") {
          throw new Error("Supplied start date is not valid: " + hiddenDates[i].start);
        }
        if (endDate._d == "Invalid Date") {
          throw new Error("Supplied end date is not valid: " + hiddenDates[i].end);
        }

        var duration = endDate - startDate;
        if (duration >= 4 * pixelTime) {

          var offset = 0;
          var runUntil = end.clone();
          switch (hiddenDates[i].repeat) {
            case "daily": // case of time
              if (startDate.day() != endDate.day()) {
                offset = 1;
              }
              startDate.dayOfYear(start.dayOfYear());
              startDate.year(start.year());
              startDate.subtract(7,'days');

              endDate.dayOfYear(start.dayOfYear());
              endDate.year(start.year());
              endDate.subtract(7 - offset,'days');

              runUntil.add(1, 'weeks');
              break;
            case "weekly":
              var dayOffset = endDate.diff(startDate,'days')
              var day = startDate.day();

              // set the start date to the range.start
              startDate.date(start.date());
              startDate.month(start.month());
              startDate.year(start.year());
              endDate = startDate.clone();

              // force
              startDate.day(day);
              endDate.day(day);
              endDate.add(dayOffset,'days');

              startDate.subtract(1,'weeks');
              endDate.subtract(1,'weeks');

              runUntil.add(1, 'weeks');
              break
            case "monthly":
              if (startDate.month() != endDate.month()) {
                offset = 1;
              }
              startDate.month(start.month());
              startDate.year(start.year());
              startDate.subtract(1,'months');

              endDate.month(start.month());
              endDate.year(start.year());
              endDate.subtract(1,'months');
              endDate.add(offset,'months');

              runUntil.add(1, 'months');
              break;
            case "yearly":
              if (startDate.year() != endDate.year()) {
                offset = 1;
              }
              startDate.year(start.year());
              startDate.subtract(1,'years');
              endDate.year(start.year());
              endDate.subtract(1,'years');
              endDate.add(offset,'years');

              runUntil.add(1, 'years');
              break;
            default:
              console.log("Wrong repeat format, allowed are: daily, weekly, monthly, yearly. Given:", hiddenDates[i].repeat);
              return;
          }
          while (startDate < runUntil) {
            body.hiddenDates.push({start: startDate.valueOf(), end: endDate.valueOf()});
            switch (hiddenDates[i].repeat) {
              case "daily":
                startDate.add(1, 'days');
                endDate.add(1, 'days');
                break;
              case "weekly":
                startDate.add(1, 'weeks');
                endDate.add(1, 'weeks');
                break
              case "monthly":
                startDate.add(1, 'months');
                endDate.add(1, 'months');
                break;
              case "yearly":
                startDate.add(1, 'y');
                endDate.add(1, 'y');
                break;
              default:
                console.log("Wrong repeat format, allowed are: daily, weekly, monthly, yearly. Given:", hiddenDates[i].repeat);
                return;
            }
          }
          body.hiddenDates.push({start: startDate.valueOf(), end: endDate.valueOf()});
        }
      }
    }
    // remove duplicates, merge where possible
    exports.removeDuplicates(body);
    // ensure the new positions are not on hidden dates
    var startHidden = exports.isHidden(body.range.start, body.hiddenDates);
    var endHidden = exports.isHidden(body.range.end,body.hiddenDates);
    var rangeStart = body.range.start;
    var rangeEnd = body.range.end;
    if (startHidden.hidden == true) {rangeStart = body.range.startToFront == true ? startHidden.startDate - 1 : startHidden.endDate + 1;}
    if (endHidden.hidden == true)   {rangeEnd   = body.range.endToFront == true ?   endHidden.startDate - 1   : endHidden.endDate + 1;}
    if (startHidden.hidden == true || endHidden.hidden == true) {
      body.range._applyRange(rangeStart, rangeEnd);
    }
  }

}


/**
 * remove duplicates from the hidden dates list. Duplicates are evil. They mess everything up.
 * Scales with N^2
 * @param body
 */
exports.removeDuplicates = function(body) {
  var hiddenDates = body.hiddenDates;
  var safeDates = [];
  for (var i = 0; i < hiddenDates.length; i++) {
    for (var j = 0; j < hiddenDates.length; j++) {
      if (i != j && hiddenDates[j].remove != true && hiddenDates[i].remove != true) {
        // j inside i
        if (hiddenDates[j].start >= hiddenDates[i].start && hiddenDates[j].end <= hiddenDates[i].end) {
          hiddenDates[j].remove = true;
        }
        // j start inside i
        else if (hiddenDates[j].start >= hiddenDates[i].start && hiddenDates[j].start <= hiddenDates[i].end) {
          hiddenDates[i].end = hiddenDates[j].end;
          hiddenDates[j].remove = true;
        }
        // j end inside i
        else if (hiddenDates[j].end >= hiddenDates[i].start && hiddenDates[j].end <= hiddenDates[i].end) {
          hiddenDates[i].start = hiddenDates[j].start;
          hiddenDates[j].remove = true;
        }
      }
    }
  }

  for (var i = 0; i < hiddenDates.length; i++) {
    if (hiddenDates[i].remove !== true) {
      safeDates.push(hiddenDates[i]);
    }
  }

  body.hiddenDates = safeDates;
  body.hiddenDates.sort(function (a, b) {
    return a.start - b.start;
  }); // sort by start time
}

exports.printDates = function(dates) {
  for (var i =0; i < dates.length; i++) {
    console.log(i, new Date(dates[i].start),new Date(dates[i].end), dates[i].start, dates[i].end, dates[i].remove);
  }
}

/**
 * Used in TimeStep to avoid the hidden times.
 * @param timeStep
 * @param previousTime
 */
exports.stepOverHiddenDates = function(timeStep, previousTime) {
  var stepInHidden = false;
  var currentValue = timeStep.current.valueOf();
  for (var i = 0; i < timeStep.hiddenDates.length; i++) {
    var startDate = timeStep.hiddenDates[i].start;
    var endDate = timeStep.hiddenDates[i].end;
    if (currentValue >= startDate && currentValue < endDate) {
      stepInHidden = true;
      break;
    }
  }

  if (stepInHidden == true && currentValue < timeStep._end.valueOf() && currentValue != previousTime) {
    var prevValue = moment(previousTime);
    var newValue = moment(endDate);
    //check if the next step should be major
    if (prevValue.year() != newValue.year()) {timeStep.switchedYear = true;}
    else if (prevValue.month() != newValue.month()) {timeStep.switchedMonth = true;}
    else if (prevValue.dayOfYear() != newValue.dayOfYear()) {timeStep.switchedDay = true;}

    timeStep.current = newValue.toDate();
  }
};


///**
// * Used in TimeStep to avoid the hidden times.
// * @param timeStep
// * @param previousTime
// */
//exports.checkFirstStep = function(timeStep) {
//  var stepInHidden = false;
//  var currentValue = timeStep.current.valueOf();
//  for (var i = 0; i < timeStep.hiddenDates.length; i++) {
//    var startDate = timeStep.hiddenDates[i].start;
//    var endDate = timeStep.hiddenDates[i].end;
//    if (currentValue >= startDate && currentValue < endDate) {
//      stepInHidden = true;
//      break;
//    }
//  }
//
//  if (stepInHidden == true && currentValue <= timeStep._end.valueOf()) {
//    var newValue = moment(endDate);
//    timeStep.current = newValue.toDate();
//  }
//};

/**
 * replaces the Core toScreen methods
 * @param Core
 * @param time
 * @param width
 * @returns {number}
 */
exports.toScreen = function(Core, time, width) {
  if (Core.body.hiddenDates.length == 0) {
    var conversion = Core.range.conversion(width);
    return (time.valueOf() - conversion.offset) * conversion.scale;
  }
  else {
    var hidden = exports.isHidden(time, Core.body.hiddenDates)
    if (hidden.hidden == true) {
      time = hidden.startDate;
    }

    var duration = exports.getHiddenDurationBetween(Core.body.hiddenDates, Core.range.start, Core.range.end);
    time = exports.correctTimeForHidden(Core.body.hiddenDates, Core.range, time);

    var conversion = Core.range.conversion(width, duration);
    return (time.valueOf() - conversion.offset) * conversion.scale;
  }
};


/**
 * Replaces the core toTime methods
 * @param body
 * @param range
 * @param x
 * @param width
 * @returns {Date}
 */
exports.toTime = function(Core, x, width) {
  if (Core.body.hiddenDates.length == 0) {
    var conversion = Core.range.conversion(width);
    return new Date(x / conversion.scale + conversion.offset);
  }
  else {
    var hiddenDuration = exports.getHiddenDurationBetween(Core.body.hiddenDates, Core.range.start, Core.range.end);
    var totalDuration = Core.range.end - Core.range.start - hiddenDuration;
    var partialDuration = totalDuration * x / width;
    var accumulatedHiddenDuration = exports.getAccumulatedHiddenDuration(Core.body.hiddenDates, Core.range, partialDuration);

    var newTime = new Date(accumulatedHiddenDuration + partialDuration + Core.range.start);
    return newTime;
  }
};


/**
 * Support function
 *
 * @param hiddenDates
 * @param range
 * @returns {number}
 */
exports.getHiddenDurationBetween = function(hiddenDates, start, end) {
  var duration = 0;
  for (var i = 0; i < hiddenDates.length; i++) {
    var startDate = hiddenDates[i].start;
    var endDate = hiddenDates[i].end;
    // if time after the cutout, and the
    if (startDate >= start && endDate < end) {
      duration += endDate - startDate;
    }
  }
  return duration;
};


/**
 * Support function
 * @param hiddenDates
 * @param range
 * @param time
 * @returns {{duration: number, time: *, offset: number}}
 */
exports.correctTimeForHidden = function(hiddenDates, range, time) {
  time = moment(time).toDate().valueOf();
  time -= exports.getHiddenDurationBefore(hiddenDates,range,time);
  return time;
};

exports.getHiddenDurationBefore = function(hiddenDates, range, time) {
  var timeOffset = 0;
  time = moment(time).toDate().valueOf();

  for (var i = 0; i < hiddenDates.length; i++) {
    var startDate = hiddenDates[i].start;
    var endDate = hiddenDates[i].end;
    // if time after the cutout, and the
    if (startDate >= range.start && endDate < range.end) {
      if (time >= endDate) {
        timeOffset += (endDate - startDate);
      }
    }
  }
  return timeOffset;
}

/**
 * sum the duration from start to finish, including the hidden duration,
 * until the required amount has been reached, return the accumulated hidden duration
 * @param hiddenDates
 * @param range
 * @param time
 * @returns {{duration: number, time: *, offset: number}}
 */
exports.getAccumulatedHiddenDuration = function(hiddenDates, range, requiredDuration) {
  var hiddenDuration = 0;
  var duration = 0;
  var previousPoint = range.start;
  //exports.printDates(hiddenDates)
  for (var i = 0; i < hiddenDates.length; i++) {
    var startDate = hiddenDates[i].start;
    var endDate = hiddenDates[i].end;
    // if time after the cutout, and the
    if (startDate >= range.start && endDate < range.end) {
      duration += startDate - previousPoint;
      previousPoint = endDate;
      if (duration >= requiredDuration) {
        break;
      }
      else {
        hiddenDuration += endDate - startDate;
      }
    }
  }

  return hiddenDuration;
};



/**
 * used to step over to either side of a hidden block. Correction is disabled on tablets, might be set to true
 * @param hiddenDates
 * @param time
 * @param direction
 * @param correctionEnabled
 * @returns {*}
 */
exports.snapAwayFromHidden = function(hiddenDates, time, direction, correctionEnabled) {
  var isHidden = exports.isHidden(time, hiddenDates);
  if (isHidden.hidden == true) {
    if (direction < 0) {
      if (correctionEnabled == true) {
        return isHidden.startDate - (isHidden.endDate - time) - 1;
      }
      else {
        return isHidden.startDate - 1;
      }
    }
    else {
      if (correctionEnabled == true) {
        return isHidden.endDate + (time - isHidden.startDate) + 1;
      }
      else {
        return isHidden.endDate + 1;
      }
    }
  }
  else {
    return time;
  }

}


/**
 * Check if a time is hidden
 *
 * @param time
 * @param hiddenDates
 * @returns {{hidden: boolean, startDate: Window.start, endDate: *}}
 */
exports.isHidden = function(time, hiddenDates) {
  for (var i = 0; i < hiddenDates.length; i++) {
    var startDate = hiddenDates[i].start;
    var endDate = hiddenDates[i].end;

    if (time >= startDate && time < endDate) { // if the start is entering a hidden zone
      return {hidden: true, startDate: startDate, endDate: endDate};
      break;
    }
  }
  return {hidden: false, startDate: startDate, endDate: endDate};
}
},{"../module/moment":7}],11:[function(require,module,exports){
var util = require('../util');
var hammerUtil = require('../hammerUtil');
var moment = require('../module/moment');
var Component = require('./component/Component');
var DateUtil = require('./DateUtil');

/**
 * @constructor Range
 * A Range controls a numeric range with a start and end value.
 * The Range adjusts the range based on mouse events or programmatic changes,
 * and triggers events when the range is changing or has been changed.
 * @param {{dom: Object, domProps: Object, emitter: Emitter}} body
 * @param {Object} [options]    See description at Range.setOptions
 */
function Range(body, options) {
  var now = moment().hours(0).minutes(0).seconds(0).milliseconds(0);
  this.start = now.clone().add(-3, 'days').valueOf(); // Number
  this.end = now.clone().add(4, 'days').valueOf();   // Number

  this.body = body;
  this.deltaDifference = 0;
  this.scaleOffset = 0;
  this.startToFront = false;
  this.endToFront = true;

  // default options
  this.defaultOptions = {
    start: null,
    end: null,
    direction: 'horizontal', // 'horizontal' or 'vertical'
    moveable: true,
    zoomable: true,
    min: null,
    max: null,
    zoomMin: 10,                                // milliseconds
    zoomMax: 1000 * 60 * 60 * 24 * 365 * 10000  // milliseconds
  };
  this.options = util.extend({}, this.defaultOptions);

  this.props = {
    touch: {}
  };
  this.animateTimer = null;

  // drag listeners for dragging
  this.body.emitter.on('dragstart', this._onDragStart.bind(this));
  this.body.emitter.on('drag',      this._onDrag.bind(this));
  this.body.emitter.on('dragend',   this._onDragEnd.bind(this));

  // ignore dragging when holding
  this.body.emitter.on('hold', this._onHold.bind(this));

  // mouse wheel for zooming
  this.body.emitter.on('mousewheel',      this._onMouseWheel.bind(this));
  this.body.emitter.on('DOMMouseScroll',  this._onMouseWheel.bind(this)); // For FF

  // pinch to zoom
  this.body.emitter.on('touch', this._onTouch.bind(this));
  this.body.emitter.on('pinch', this._onPinch.bind(this));

  this.setOptions(options);
}

Range.prototype = new Component();

/**
 * Set options for the range controller
 * @param {Object} options      Available options:
 *                              {Number | Date | String} start  Start date for the range
 *                              {Number | Date | String} end    End date for the range
 *                              {Number} min    Minimum value for start
 *                              {Number} max    Maximum value for end
 *                              {Number} zoomMin    Set a minimum value for
 *                                                  (end - start).
 *                              {Number} zoomMax    Set a maximum value for
 *                                                  (end - start).
 *                              {Boolean} moveable Enable moving of the range
 *                                                 by dragging. True by default
 *                              {Boolean} zoomable Enable zooming of the range
 *                                                 by pinching/scrolling. True by default
 */
Range.prototype.setOptions = function (options) {
  if (options) {
    // copy the options that we know
    var fields = ['direction', 'min', 'max', 'zoomMin', 'zoomMax', 'moveable', 'zoomable', 'activate', 'hiddenDates'];
    util.selectiveExtend(fields, this.options, options);

    if ('start' in options || 'end' in options) {
      // apply a new range. both start and end are optional
      this.setRange(options.start, options.end);
    }
  }
};

/**
 * Test whether direction has a valid value
 * @param {String} direction    'horizontal' or 'vertical'
 */
function validateDirection (direction) {
  if (direction != 'horizontal' && direction != 'vertical') {
    throw new TypeError('Unknown direction "' + direction + '". ' +
        'Choose "horizontal" or "vertical".');
  }
}

/**
 * Set a new start and end range
 * @param {Date | Number | String} [start]
 * @param {Date | Number | String} [end]
 * @param {boolean | number} [animate=false]     If true, the range is animated
 *                                               smoothly to the new window.
 *                                               If animate is a number, the
 *                                               number is taken as duration
 *                                               Default duration is 500 ms.
 * @param {Boolean} [byUser=false]
 *
 */
Range.prototype.setRange = function(start, end, animate, byUser) {
  if (byUser !== true) {
    byUser = false;
  }
  var _start = start != undefined ? util.convert(start, 'Date').valueOf() : null;
  var _end   = end != undefined   ? util.convert(end, 'Date').valueOf()   : null;
  this._cancelAnimation();

  if (animate) {
    var me = this;
    var initStart = this.start;
    var initEnd = this.end;
    var duration = typeof animate === 'number' ? animate : 500;
    var initTime = new Date().valueOf();
    var anyChanged = false;

    var next = function () {
      if (!me.props.touch.dragging) {
        var now = new Date().valueOf();
        var time = now - initTime;
        var done = time > duration;
        var s = (done || _start === null) ? _start : util.easeInOutQuad(time, initStart, _start, duration);
        var e = (done || _end === null)   ? _end   : util.easeInOutQuad(time, initEnd, _end, duration);

        changed = me._applyRange(s, e);
        DateUtil.updateHiddenDates(me.body, me.options.hiddenDates);
        anyChanged = anyChanged || changed;
        if (changed) {
          me.body.emitter.emit('rangechange', {start: new Date(me.start), end: new Date(me.end), byUser:byUser});
        }

        if (done) {
          if (anyChanged) {
            me.body.emitter.emit('rangechanged', {start: new Date(me.start), end: new Date(me.end), byUser:byUser});
          }
        }
        else {
          // animate with as high as possible frame rate, leave 20 ms in between
          // each to prevent the browser from blocking
          me.animateTimer = setTimeout(next, 20);
        }
      }
    };

    return next();
  }
  else {
    var changed = this._applyRange(_start, _end);
    DateUtil.updateHiddenDates(this.body, this.options.hiddenDates);
    if (changed) {
      var params = {start: new Date(this.start), end: new Date(this.end), byUser:byUser};
      this.body.emitter.emit('rangechange', params);
      this.body.emitter.emit('rangechanged', params);
    }
  }
};

/**
 * Stop an animation
 * @private
 */
Range.prototype._cancelAnimation = function () {
  if (this.animateTimer) {
    clearTimeout(this.animateTimer);
    this.animateTimer = null;
  }
};

/**
 * Set a new start and end range. This method is the same as setRange, but
 * does not trigger a range change and range changed event, and it returns
 * true when the range is changed
 * @param {Number} [start]
 * @param {Number} [end]
 * @return {Boolean} changed
 * @private
 */
Range.prototype._applyRange = function(start, end) {
  var newStart = (start != null) ? util.convert(start, 'Date').valueOf() : this.start,
      newEnd   = (end != null)   ? util.convert(end, 'Date').valueOf()   : this.end,
      max = (this.options.max != null) ? util.convert(this.options.max, 'Date').valueOf() : null,
      min = (this.options.min != null) ? util.convert(this.options.min, 'Date').valueOf() : null,
      diff;

  // check for valid number
  if (isNaN(newStart) || newStart === null) {
    throw new Error('Invalid start "' + start + '"');
  }
  if (isNaN(newEnd) || newEnd === null) {
    throw new Error('Invalid end "' + end + '"');
  }

  // prevent start < end
  if (newEnd < newStart) {
    newEnd = newStart;
  }

  // prevent start < min
  if (min !== null) {
    if (newStart < min) {
      diff = (min - newStart);
      newStart += diff;
      newEnd += diff;

      // prevent end > max
      if (max != null) {
        if (newEnd > max) {
          newEnd = max;
        }
      }
    }
  }

  // prevent end > max
  if (max !== null) {
    if (newEnd > max) {
      diff = (newEnd - max);
      newStart -= diff;
      newEnd -= diff;

      // prevent start < min
      if (min != null) {
        if (newStart < min) {
          newStart = min;
        }
      }
    }
  }

  // prevent (end-start) < zoomMin
  if (this.options.zoomMin !== null) {
    var zoomMin = parseFloat(this.options.zoomMin);
    if (zoomMin < 0) {
      zoomMin = 0;
    }
    if ((newEnd - newStart) < zoomMin) {
      if ((this.end - this.start) === zoomMin && newStart > this.start && newEnd < this.end) {
        // ignore this action, we are already zoomed to the minimum
        newStart = this.start;
        newEnd = this.end;
      }
      else {
        // zoom to the minimum
        diff = (zoomMin - (newEnd - newStart));
        newStart -= diff / 2;
        newEnd += diff / 2;
      }
    }
  }

  // prevent (end-start) > zoomMax
  if (this.options.zoomMax !== null) {
    var zoomMax = parseFloat(this.options.zoomMax);
    if (zoomMax < 0) {
      zoomMax = 0;
    }

    if ((newEnd - newStart) > zoomMax) {
      if ((this.end - this.start) === zoomMax && newStart < this.start && newEnd > this.end) {
        // ignore this action, we are already zoomed to the maximum
        newStart = this.start;
        newEnd = this.end;
      }
      else {
        // zoom to the maximum
        diff = ((newEnd - newStart) - zoomMax);
        newStart += diff / 2;
        newEnd -= diff / 2;
      }
    }
  }

  var changed = (this.start != newStart || this.end != newEnd);

  // if the new range does NOT overlap with the old range, emit checkRangedItems to avoid not showing ranged items (ranged meaning has end time, not necessarily of type Range)
  if (!((newStart >= this.start && newStart   <= this.end) || (newEnd   >= this.start && newEnd   <= this.end)) &&
      !((this.start >= newStart && this.start <= newEnd)   || (this.end >= newStart   && this.end <= newEnd) )) {
    this.body.emitter.emit('checkRangedItems');
  }

  this.start = newStart;
  this.end = newEnd;
  return changed;
};

/**
 * Retrieve the current range.
 * @return {Object} An object with start and end properties
 */
Range.prototype.getRange = function() {
  return {
    start: this.start,
    end: this.end
  };
};

/**
 * Calculate the conversion offset and scale for current range, based on
 * the provided width
 * @param {Number} width
 * @returns {{offset: number, scale: number}} conversion
 */
Range.prototype.conversion = function (width, totalHidden) {
  return Range.conversion(this.start, this.end, width, totalHidden);
};

/**
 * Static method to calculate the conversion offset and scale for a range,
 * based on the provided start, end, and width
 * @param {Number} start
 * @param {Number} end
 * @param {Number} width
 * @returns {{offset: number, scale: number}} conversion
 */
Range.conversion = function (start, end, width, totalHidden) {
  if (totalHidden === undefined) {
    totalHidden = 0;
  }
  if (width != 0 && (end - start != 0)) {
    return {
      offset: start,
      scale: width / (end - start - totalHidden)
    }
  }
  else {
    return {
      offset: 0,
      scale: 1
    };
  }
};

/**
 * Start dragging horizontally or vertically
 * @param {Event} event
 * @private
 */
Range.prototype._onDragStart = function(event) {
  this.deltaDifference = 0;
  this.previousDelta = 0;
  // only allow dragging when configured as movable
  if (!this.options.moveable) return;

  // refuse to drag when we where pinching to prevent the timeline make a jump
  // when releasing the fingers in opposite order from the touch screen
  if (!this.props.touch.allowDragging) return;

  this.props.touch.start = this.start;
  this.props.touch.end = this.end;
  this.props.touch.dragging = true;

  if (this.body.dom.root) {
    this.body.dom.root.style.cursor = 'move';
  }
};

/**
 * Perform dragging operation
 * @param {Event} event
 * @private
 */
Range.prototype._onDrag = function (event) {
  // only allow dragging when configured as movable
  if (!this.options.moveable) return;
  // refuse to drag when we where pinching to prevent the timeline make a jump
  // when releasing the fingers in opposite order from the touch screen
  if (!this.props.touch.allowDragging) return;

  var direction = this.options.direction;
  validateDirection(direction);

  var delta = (direction == 'horizontal') ? event.gesture.deltaX : event.gesture.deltaY;
  delta -= this.deltaDifference;
  var interval = (this.props.touch.end - this.props.touch.start);

  // normalize dragging speed if cutout is in between.
  var duration = DateUtil.getHiddenDurationBetween(this.body.hiddenDates, this.start, this.end);
  interval -= duration;

  var width = (direction == 'horizontal') ? this.body.domProps.center.width : this.body.domProps.center.height;
  var diffRange = -delta / width * interval;
  var newStart = this.props.touch.start + diffRange;
  var newEnd = this.props.touch.end + diffRange;


  // snapping times away from hidden zones
  var safeStart = DateUtil.snapAwayFromHidden(this.body.hiddenDates, newStart, this.previousDelta-delta, true);
  var safeEnd = DateUtil.snapAwayFromHidden(this.body.hiddenDates, newEnd, this.previousDelta-delta, true);
  if (safeStart != newStart || safeEnd != newEnd) {
    this.deltaDifference += delta;
    this.props.touch.start = safeStart;
    this.props.touch.end = safeEnd;
    this._onDrag(event);
    return;
  }

  this.previousDelta = delta;
  this._applyRange(newStart, newEnd);

  // fire a rangechange event
  this.body.emitter.emit('rangechange', {
    start: new Date(this.start),
    end:   new Date(this.end),
    byUser: true
  });
};

/**
 * Stop dragging operation
 * @param {event} event
 * @private
 */
Range.prototype._onDragEnd = function (event) {
  // only allow dragging when configured as movable
  if (!this.options.moveable) return;

  // refuse to drag when we where pinching to prevent the timeline make a jump
  // when releasing the fingers in opposite order from the touch screen
  if (!this.props.touch.allowDragging) return;

  this.props.touch.dragging = false;
  if (this.body.dom.root) {
    this.body.dom.root.style.cursor = 'auto';
  }

  // fire a rangechanged event
  this.body.emitter.emit('rangechanged', {
    start: new Date(this.start),
    end:   new Date(this.end),
    byUser: true
  });
};

/**
 * Event handler for mouse wheel event, used to zoom
 * Code from http://adomas.org/javascript-mouse-wheel/
 * @param {Event} event
 * @private
 */
Range.prototype._onMouseWheel = function(event) {
  // only allow zooming when configured as zoomable and moveable
  if (!(this.options.zoomable && this.options.moveable)) return;

  // retrieve delta
  var delta = 0;
  if (event.wheelDelta) { /* IE/Opera. */
    delta = event.wheelDelta / 120;
  } else if (event.detail) { /* Mozilla case. */
    // In Mozilla, sign of delta is different than in IE.
    // Also, delta is multiple of 3.
    delta = -event.detail / 3;
  }

  // If delta is nonzero, handle it.
  // Basically, delta is now positive if wheel was scrolled up,
  // and negative, if wheel was scrolled down.
  if (delta) {
    // perform the zoom action. Delta is normally 1 or -1

    // adjust a negative delta such that zooming in with delta 0.1
    // equals zooming out with a delta -0.1
    var scale;
    if (delta < 0) {
      scale = 1 - (delta / 5);
    }
    else {
      scale = 1 / (1 + (delta / 5)) ;
    }

    // calculate center, the date to zoom around
    var gesture = hammerUtil.fakeGesture(this, event),
        pointer = getPointer(gesture.center, this.body.dom.center),
        pointerDate = this._pointerToDate(pointer);

    this.zoom(scale, pointerDate, delta);
  }

  // Prevent default actions caused by mouse wheel
  // (else the page and timeline both zoom and scroll)
  event.preventDefault();
};

/**
 * Start of a touch gesture
 * @private
 */
Range.prototype._onTouch = function (event) {
  this.props.touch.start = this.start;
  this.props.touch.end = this.end;
  this.props.touch.allowDragging = true;
  this.props.touch.center = null;
  this.scaleOffset = 0;
  this.deltaDifference = 0;
};

/**
 * On start of a hold gesture
 * @private
 */
Range.prototype._onHold = function () {
  this.props.touch.allowDragging = false;
};

/**
 * Handle pinch event
 * @param {Event} event
 * @private
 */
Range.prototype._onPinch = function (event) {
  // only allow zooming when configured as zoomable and moveable
  if (!(this.options.zoomable && this.options.moveable)) return;

  this.props.touch.allowDragging = false;

  if (event.gesture.touches.length > 1) {
    if (!this.props.touch.center) {
      this.props.touch.center = getPointer(event.gesture.center, this.body.dom.center);
    }

    var scale = 1 / (event.gesture.scale + this.scaleOffset);
    var centerDate = this._pointerToDate(this.props.touch.center);

    var hiddenDuration = DateUtil.getHiddenDurationBetween(this.body.hiddenDates, this.start, this.end);
    var hiddenDurationBefore = DateUtil.getHiddenDurationBefore(this.body.hiddenDates, this, centerDate);
    var hiddenDurationAfter = hiddenDuration - hiddenDurationBefore;

    // calculate new start and end
    var newStart = (centerDate - hiddenDurationBefore) + (this.props.touch.start - (centerDate - hiddenDurationBefore)) * scale;
    var newEnd = (centerDate + hiddenDurationAfter) + (this.props.touch.end - (centerDate + hiddenDurationAfter)) * scale;

    // snapping times away from hidden zones
    this.startToFront = 1 - scale > 0 ? false : true; // used to do the right autocorrection with periodic hidden times
    this.endToFront = scale - 1 > 0 ? false : true; // used to do the right autocorrection with periodic hidden times

    var safeStart = DateUtil.snapAwayFromHidden(this.body.hiddenDates, newStart, 1 - scale, true);
    var safeEnd = DateUtil.snapAwayFromHidden(this.body.hiddenDates, newEnd, scale - 1, true);
    if (safeStart != newStart || safeEnd != newEnd) {
      this.props.touch.start = safeStart;
      this.props.touch.end = safeEnd;
      this.scaleOffset = 1 - event.gesture.scale;
      newStart = safeStart;
      newEnd = safeEnd;
    }

    this.setRange(newStart, newEnd, false, true);

    this.startToFront = false; // revert to default
    this.endToFront = true; // revert to default
  }
};

/**
 * Helper function to calculate the center date for zooming
 * @param {{x: Number, y: Number}} pointer
 * @return {number} date
 * @private
 */
Range.prototype._pointerToDate = function (pointer) {
  var conversion;
  var direction = this.options.direction;

  validateDirection(direction);

  if (direction == 'horizontal') {
    return this.body.util.toTime(pointer.x).valueOf();
  }
  else {
    var height = this.body.domProps.center.height;
    conversion = this.conversion(height);
    return pointer.y / conversion.scale + conversion.offset;
  }
};

/**
 * Get the pointer location relative to the location of the dom element
 * @param {{pageX: Number, pageY: Number}} touch
 * @param {Element} element   HTML DOM element
 * @return {{x: Number, y: Number}} pointer
 * @private
 */
function getPointer (touch, element) {
  return {
    x: touch.pageX - util.getAbsoluteLeft(element),
    y: touch.pageY - util.getAbsoluteTop(element)
  };
}

/**
 * Zoom the range the given scale in or out. Start and end date will
 * be adjusted, and the timeline will be redrawn. You can optionally give a
 * date around which to zoom.
 * For example, try scale = 0.9 or 1.1
 * @param {Number} scale      Scaling factor. Values above 1 will zoom out,
 *                            values below 1 will zoom in.
 * @param {Number} [center]   Value representing a date around which will
 *                            be zoomed.
 */
Range.prototype.zoom = function(scale, center, delta) {
  // if centerDate is not provided, take it half between start Date and end Date
  if (center == null) {
    center = (this.start + this.end) / 2;
  }

  var hiddenDuration = DateUtil.getHiddenDurationBetween(this.body.hiddenDates, this.start, this.end);
  var hiddenDurationBefore = DateUtil.getHiddenDurationBefore(this.body.hiddenDates, this, center);
  var hiddenDurationAfter = hiddenDuration - hiddenDurationBefore;

  // calculate new start and end
  var newStart = (center-hiddenDurationBefore) + (this.start - (center-hiddenDurationBefore)) * scale;
  var newEnd   = (center+hiddenDurationAfter) + (this.end - (center+hiddenDurationAfter)) * scale;

  // snapping times away from hidden zones
  this.startToFront = delta > 0 ? false : true; // used to do the right autocorrection with periodic hidden times
  this.endToFront = -delta  > 0 ? false : true; // used to do the right autocorrection with periodic hidden times
  var safeStart = DateUtil.snapAwayFromHidden(this.body.hiddenDates, newStart, delta, true);
  var safeEnd = DateUtil.snapAwayFromHidden(this.body.hiddenDates, newEnd, -delta, true);
  if (safeStart != newStart || safeEnd != newEnd) {
    newStart = safeStart;
    newEnd = safeEnd;
  }

  this.setRange(newStart, newEnd, false, true);

  this.startToFront = false; // revert to default
  this.endToFront = true; // revert to default
};



/**
 * Move the range with a given delta to the left or right. Start and end
 * value will be adjusted. For example, try delta = 0.1 or -0.1
 * @param {Number}  delta     Moving amount. Positive value will move right,
 *                            negative value will move left
 */
Range.prototype.move = function(delta) {
  // zoom start Date and end Date relative to the centerDate
  var diff = (this.end - this.start);

  // apply new values
  var newStart = this.start + diff * delta;
  var newEnd = this.end + diff * delta;

  // TODO: reckon with min and max range

  this.start = newStart;
  this.end = newEnd;
};

/**
 * Move the range to a new center point
 * @param {Number} moveTo      New center point of the range
 */
Range.prototype.moveTo = function(moveTo) {
  var center = (this.start + this.end) / 2;

  var diff = center - moveTo;

  // calculate new start and end
  var newStart = this.start - diff;
  var newEnd = this.end - diff;

  this.setRange(newStart, newEnd);
};

module.exports = Range;

},{"../hammerUtil":5,"../module/moment":7,"../util":28,"./DateUtil":10,"./component/Component":16}],12:[function(require,module,exports){
// Utility functions for ordering and stacking of items
var EPSILON = 0.001; // used when checking collisions, to prevent round-off errors

/**
 * Order items by their start data
 * @param {Item[]} items
 */
exports.orderByStart = function(items) {
  items.sort(function (a, b) {
    return a.data.start - b.data.start;
  });
};

/**
 * Order items by their end date. If they have no end date, their start date
 * is used.
 * @param {Item[]} items
 */
exports.orderByEnd = function(items) {
  items.sort(function (a, b) {
    var aTime = ('end' in a.data) ? a.data.end : a.data.start,
        bTime = ('end' in b.data) ? b.data.end : b.data.start;

    return aTime - bTime;
  });
};

/**
 * Adjust vertical positions of the items such that they don't overlap each
 * other.
 * @param {Item[]} items
 *            All visible items
 * @param {{item: {horizontal: number, vertical: number}, axis: number}} margin
 *            Margins between items and between items and the axis.
 * @param {boolean} [force=false]
 *            If true, all items will be repositioned. If false (default), only
 *            items having a top===null will be re-stacked
 */
exports.stack = function(items, margin, force) {
  var i, iMax;

  if (force) {
    // reset top position of all items
    for (i = 0, iMax = items.length; i < iMax; i++) {
      items[i].top = null;
    }
  }

  // calculate new, non-overlapping positions
  for (i = 0, iMax = items.length; i < iMax; i++) {
    var item = items[i];
    if (item.stack && item.top === null) {
      // initialize top position
      item.top = margin.axis;

      do {
        // TODO: optimize checking for overlap. when there is a gap without items,
        //       you only need to check for items from the next item on, not from zero
        var collidingItem = null;
        for (var j = 0, jj = items.length; j < jj; j++) {
          var other = items[j];
          if (other.top !== null && other !== item && other.stack && exports.collision(item, other, margin.item)) {
            collidingItem = other;
            break;
          }
        }

        if (collidingItem != null) {
          // There is a collision. Reposition the items above the colliding element
          item.top = collidingItem.top + collidingItem.height + margin.item.vertical;
        }
      } while (collidingItem);
    }
  }
};


/**
 * Adjust vertical positions of the items without stacking them
 * @param {Item[]} items
 *            All visible items
 * @param {{item: {horizontal: number, vertical: number}, axis: number}} margin
 *            Margins between items and between items and the axis.
 */
exports.nostack = function(items, margin, subgroups) {
  var i, iMax, newTop;

  // reset top position of all items
  for (i = 0, iMax = items.length; i < iMax; i++) {
    if (items[i].data.subgroup !== undefined) {
      newTop = margin.axis;
      for (var subgroup in subgroups) {
        if (subgroups.hasOwnProperty(subgroup)) {
          if (subgroups[subgroup].visible == true && subgroups[subgroup].index < subgroups[items[i].data.subgroup].index) {
            newTop += subgroups[subgroup].height + margin.item.vertical;
          }
        }
      }
      items[i].top = newTop;
    }
    else {
      items[i].top = margin.axis;
    }
  }
};

/**
 * Test if the two provided items collide
 * The items must have parameters left, width, top, and height.
 * @param {Item} a          The first item
 * @param {Item} b          The second item
 * @param {{horizontal: number, vertical: number}} margin
 *                          An object containing a horizontal and vertical
 *                          minimum required margin.
 * @return {boolean}        true if a and b collide, else false
 */
exports.collision = function(a, b, margin) {
  return ((a.left - margin.horizontal + EPSILON)       < (b.left + b.width) &&
      (a.left + a.width + margin.horizontal - EPSILON) > b.left &&
      (a.top - margin.vertical + EPSILON)              < (b.top + b.height) &&
      (a.top + a.height + margin.vertical - EPSILON)   > b.top);
};

},{}],13:[function(require,module,exports){
var moment = require('../module/moment');
var DateUtil = require('./DateUtil');
var util = require('../util');

/**
 * @constructor  TimeStep
 * The class TimeStep is an iterator for dates. You provide a start date and an
 * end date. The class itself determines the best scale (step size) based on the
 * provided start Date, end Date, and minimumStep.
 *
 * If minimumStep is provided, the step size is chosen as close as possible
 * to the minimumStep but larger than minimumStep. If minimumStep is not
 * provided, the scale is set to 1 DAY.
 * The minimumStep should correspond with the onscreen size of about 6 characters
 *
 * Alternatively, you can set a scale by hand.
 * After creation, you can initialize the class by executing first(). Then you
 * can iterate from the start date to the end date via next(). You can check if
 * the end date is reached with the function hasNext(). After each step, you can
 * retrieve the current date via getCurrent().
 * The TimeStep has scales ranging from milliseconds, seconds, minutes, hours,
 * days, to years.
 *
 * Version: 1.2
 *
 * @param {Date} [start]         The start date, for example new Date(2010, 9, 21)
 *                               or new Date(2010, 9, 21, 23, 45, 00)
 * @param {Date} [end]           The end date
 * @param {Number} [minimumStep] Optional. Minimum step size in milliseconds
 */
function TimeStep(start, end, minimumStep, hiddenDates) {
  // variables
  this.current = new Date();
  this._start = new Date();
  this._end = new Date();

  this.autoScale  = true;
  this.scale = 'day';
  this.step = 1;

  // initialize the range
  this.setRange(start, end, minimumStep);

  // hidden Dates options
  this.switchedDay = false;
  this.switchedMonth = false;
  this.switchedYear = false;
  this.hiddenDates = hiddenDates;
  if (hiddenDates === undefined) {
    this.hiddenDates = [];
  }

  this.format = TimeStep.FORMAT; // default formatting
}

// Time formatting
TimeStep.FORMAT = {
  minorLabels: {
    millisecond:'SSS',
    second:     's',
    minute:     'HH:mm',
    hour:       'HH:mm',
    weekday:    'ddd D',
    day:        'D',
    month:      'MMM',
    year:       'YYYY'
  },
  majorLabels: {
    millisecond:'HH:mm:ss',
    second:     'D MMMM HH:mm',
    minute:     'ddd D MMMM',
    hour:       'ddd D MMMM',
    weekday:    'MMMM YYYY',
    day:        'MMMM YYYY',
    month:      'YYYY',
    year:       ''
  }
};

/**
 * Set custom formatting for the minor an major labels of the TimeStep.
 * Both `minorLabels` and `majorLabels` are an Object with properties:
 * 'millisecond, 'second, 'minute', 'hour', 'weekday, 'day, 'month, 'year'.
 * @param {{minorLabels: Object, majorLabels: Object}} format
 */
TimeStep.prototype.setFormat = function (format) {
  var defaultFormat = util.deepExtend({}, TimeStep.FORMAT);
  this.format = util.deepExtend(defaultFormat, format);
};

/**
 * Set a new range
 * If minimumStep is provided, the step size is chosen as close as possible
 * to the minimumStep but larger than minimumStep. If minimumStep is not
 * provided, the scale is set to 1 DAY.
 * The minimumStep should correspond with the onscreen size of about 6 characters
 * @param {Date} [start]      The start date and time.
 * @param {Date} [end]        The end date and time.
 * @param {int} [minimumStep] Optional. Minimum step size in milliseconds
 */
TimeStep.prototype.setRange = function(start, end, minimumStep) {
  if (!(start instanceof Date) || !(end instanceof Date)) {
    throw  "No legal start or end date in method setRange";
  }

  this._start = (start != undefined) ? new Date(start.valueOf()) : new Date();
  this._end = (end != undefined) ? new Date(end.valueOf()) : new Date();

  if (this.autoScale) {
    this.setMinimumStep(minimumStep);
  }
};

/**
 * Set the range iterator to the start date.
 */
TimeStep.prototype.first = function() {
  this.current = new Date(this._start.valueOf());
  this.roundToMinor();
};

/**
 * Round the current date to the first minor date value
 * This must be executed once when the current date is set to start Date
 */
TimeStep.prototype.roundToMinor = function() {
  // round to floor
  // IMPORTANT: we have no breaks in this switch! (this is no bug)
  // noinspection FallThroughInSwitchStatementJS
  switch (this.scale) {
    case 'year':
      this.current.setFullYear(this.step * Math.floor(this.current.getFullYear() / this.step));
      this.current.setMonth(0);
    case 'month':        this.current.setDate(1);
    case 'day':          // intentional fall through
    case 'weekday':      this.current.setHours(0);
    case 'hour':         this.current.setMinutes(0);
    case 'minute':       this.current.setSeconds(0);
    case 'second':       this.current.setMilliseconds(0);
    //case 'millisecond': // nothing to do for milliseconds
  }

  if (this.step != 1) {
    // round down to the first minor value that is a multiple of the current step size
    switch (this.scale) {
      case 'millisecond':  this.current.setMilliseconds(this.current.getMilliseconds() - this.current.getMilliseconds() % this.step);  break;
      case 'second':       this.current.setSeconds(this.current.getSeconds() - this.current.getSeconds() % this.step); break;
      case 'minute':       this.current.setMinutes(this.current.getMinutes() - this.current.getMinutes() % this.step); break;
      case 'hour':         this.current.setHours(this.current.getHours() - this.current.getHours() % this.step); break;
      case 'weekday':      // intentional fall through
      case 'day':          this.current.setDate((this.current.getDate()-1) - (this.current.getDate()-1) % this.step + 1); break;
      case 'month':        this.current.setMonth(this.current.getMonth() - this.current.getMonth() % this.step);  break;
      case 'year':         this.current.setFullYear(this.current.getFullYear() - this.current.getFullYear() % this.step); break;
      default: break;
    }
  }
};

/**
 * Check if the there is a next step
 * @return {boolean}  true if the current date has not passed the end date
 */
TimeStep.prototype.hasNext = function () {
  return (this.current.valueOf() <= this._end.valueOf());
};

/**
 * Do the next step
 */
TimeStep.prototype.next = function() {
  var prev = this.current.valueOf();

  // Two cases, needed to prevent issues with switching daylight savings
  // (end of March and end of October)
  if (this.current.getMonth() < 6)   {
    switch (this.scale) {
      case 'millisecond':

        this.current = new Date(this.current.valueOf() + this.step); break;
      case 'second':       this.current = new Date(this.current.valueOf() + this.step * 1000); break;
      case 'minute':       this.current = new Date(this.current.valueOf() + this.step * 1000 * 60); break;
      case 'hour':
        this.current = new Date(this.current.valueOf() + this.step * 1000 * 60 * 60);
        // in case of skipping an hour for daylight savings, adjust the hour again (else you get: 0h 5h 9h ... instead of 0h 4h 8h ...)
        var h = this.current.getHours();
        this.current.setHours(h - (h % this.step));
        break;
      case 'weekday':      // intentional fall through
      case 'day':          this.current.setDate(this.current.getDate() + this.step); break;
      case 'month':        this.current.setMonth(this.current.getMonth() + this.step); break;
      case 'year':         this.current.setFullYear(this.current.getFullYear() + this.step); break;
      default:                      break;
    }
  }
  else {
    switch (this.scale) {
      case 'millisecond':  this.current = new Date(this.current.valueOf() + this.step); break;
      case 'second':       this.current.setSeconds(this.current.getSeconds() + this.step); break;
      case 'minute':       this.current.setMinutes(this.current.getMinutes() + this.step); break;
      case 'hour':         this.current.setHours(this.current.getHours() + this.step); break;
      case 'weekday':      // intentional fall through
      case 'day':          this.current.setDate(this.current.getDate() + this.step); break;
      case 'month':        this.current.setMonth(this.current.getMonth() + this.step); break;
      case 'year':         this.current.setFullYear(this.current.getFullYear() + this.step); break;
      default:                      break;
    }
  }

  if (this.step != 1) {
    // round down to the correct major value
    switch (this.scale) {
      case 'millisecond':  if(this.current.getMilliseconds() < this.step) this.current.setMilliseconds(0);  break;
      case 'second':       if(this.current.getSeconds() < this.step) this.current.setSeconds(0);  break;
      case 'minute':       if(this.current.getMinutes() < this.step) this.current.setMinutes(0);  break;
      case 'hour':         if(this.current.getHours() < this.step) this.current.setHours(0);  break;
      case 'weekday':      // intentional fall through
      case 'day':          if(this.current.getDate() < this.step+1) this.current.setDate(1); break;
      case 'month':        if(this.current.getMonth() < this.step) this.current.setMonth(0);  break;
      case 'year':         break; // nothing to do for year
      default:                break;
    }
  }

  // safety mechanism: if current time is still unchanged, move to the end
  if (this.current.valueOf() == prev) {
    this.current = new Date(this._end.valueOf());
  }

  DateUtil.stepOverHiddenDates(this, prev);
};


/**
 * Get the current datetime
 * @return {Date}  current The current date
 */
TimeStep.prototype.getCurrent = function() {
  return this.current;
};

/**
 * Set a custom scale. Autoscaling will be disabled.
 * For example setScale('minute', 5) will result
 * in minor steps of 5 minutes, and major steps of an hour.
 *
 * @param {{scale: string, step: number}} params
 *                               An object containing two properties:
 *                               - A string 'scale'. Choose from 'millisecond', 'second',
 *                                 'minute', 'hour', 'weekday, 'day, 'month, 'year'.
 *                               - A number 'step'. A step size, by default 1.
 *                                 Choose for example 1, 2, 5, or 10.
 */
TimeStep.prototype.setScale = function(params) {
  if (params && typeof params.scale == 'string') {
    this.scale = params.scale;
    this.step = params.step > 0 ? params.step : 1;
    this.autoScale = false;
  }
};

/**
 * Enable or disable autoscaling
 * @param {boolean} enable  If true, autoascaling is set true
 */
TimeStep.prototype.setAutoScale = function (enable) {
  this.autoScale = enable;
};


/**
 * Automatically determine the scale that bests fits the provided minimum step
 * @param {Number} [minimumStep]  The minimum step size in milliseconds
 */
TimeStep.prototype.setMinimumStep = function(minimumStep) {
  if (minimumStep == undefined) {
    return;
  }

  //var b = asc + ds;

  var stepYear       = (1000 * 60 * 60 * 24 * 30 * 12);
  var stepMonth      = (1000 * 60 * 60 * 24 * 30);
  var stepDay        = (1000 * 60 * 60 * 24);
  var stepHour       = (1000 * 60 * 60);
  var stepMinute     = (1000 * 60);
  var stepSecond     = (1000);
  var stepMillisecond= (1);

  // find the smallest step that is larger than the provided minimumStep
  if (stepYear*1000 > minimumStep)        {this.scale = 'year';        this.step = 1000;}
  if (stepYear*500 > minimumStep)         {this.scale = 'year';        this.step = 500;}
  if (stepYear*100 > minimumStep)         {this.scale = 'year';        this.step = 100;}
  if (stepYear*50 > minimumStep)          {this.scale = 'year';        this.step = 50;}
  if (stepYear*10 > minimumStep)          {this.scale = 'year';        this.step = 10;}
  if (stepYear*5 > minimumStep)           {this.scale = 'year';        this.step = 5;}
  if (stepYear > minimumStep)             {this.scale = 'year';        this.step = 1;}
  if (stepMonth*3 > minimumStep)          {this.scale = 'month';       this.step = 3;}
  if (stepMonth > minimumStep)            {this.scale = 'month';       this.step = 1;}
  if (stepDay*5 > minimumStep)            {this.scale = 'day';         this.step = 5;}
  if (stepDay*2 > minimumStep)            {this.scale = 'day';         this.step = 2;}
  if (stepDay > minimumStep)              {this.scale = 'day';         this.step = 1;}
  if (stepDay/2 > minimumStep)            {this.scale = 'weekday';     this.step = 1;}
  if (stepHour*4 > minimumStep)           {this.scale = 'hour';        this.step = 4;}
  if (stepHour > minimumStep)             {this.scale = 'hour';        this.step = 1;}
  if (stepMinute*15 > minimumStep)        {this.scale = 'minute';      this.step = 15;}
  if (stepMinute*10 > minimumStep)        {this.scale = 'minute';      this.step = 10;}
  if (stepMinute*5 > minimumStep)         {this.scale = 'minute';      this.step = 5;}
  if (stepMinute > minimumStep)           {this.scale = 'minute';      this.step = 1;}
  if (stepSecond*15 > minimumStep)        {this.scale = 'second';      this.step = 15;}
  if (stepSecond*10 > minimumStep)        {this.scale = 'second';      this.step = 10;}
  if (stepSecond*5 > minimumStep)         {this.scale = 'second';      this.step = 5;}
  if (stepSecond > minimumStep)           {this.scale = 'second';      this.step = 1;}
  if (stepMillisecond*200 > minimumStep)  {this.scale = 'millisecond'; this.step = 200;}
  if (stepMillisecond*100 > minimumStep)  {this.scale = 'millisecond'; this.step = 100;}
  if (stepMillisecond*50 > minimumStep)   {this.scale = 'millisecond'; this.step = 50;}
  if (stepMillisecond*10 > minimumStep)   {this.scale = 'millisecond'; this.step = 10;}
  if (stepMillisecond*5 > minimumStep)    {this.scale = 'millisecond'; this.step = 5;}
  if (stepMillisecond > minimumStep)      {this.scale = 'millisecond'; this.step = 1;}
};

/**
 * Snap a date to a rounded value.
 * The snap intervals are dependent on the current scale and step.
 * Static function
 * @param {Date} date    the date to be snapped.
 * @param {string} scale Current scale, can be 'millisecond', 'second',
 *                       'minute', 'hour', 'weekday, 'day, 'month, 'year'.
 * @param {number} step  Current step (1, 2, 4, 5, ...
 * @return {Date} snappedDate
 */
TimeStep.snap = function(date, scale, step) {
  var clone = new Date(date.valueOf());

  if (scale == 'year') {
    var year = clone.getFullYear() + Math.round(clone.getMonth() / 12);
    clone.setFullYear(Math.round(year / step) * step);
    clone.setMonth(0);
    clone.setDate(0);
    clone.setHours(0);
    clone.setMinutes(0);
    clone.setSeconds(0);
    clone.setMilliseconds(0);
  }
  else if (scale == 'month') {
    if (clone.getDate() > 15) {
      clone.setDate(1);
      clone.setMonth(clone.getMonth() + 1);
      // important: first set Date to 1, after that change the month.
    }
    else {
      clone.setDate(1);
    }

    clone.setHours(0);
    clone.setMinutes(0);
    clone.setSeconds(0);
    clone.setMilliseconds(0);
  }
  else if (scale == 'day') {
    //noinspection FallthroughInSwitchStatementJS
    switch (step) {
      case 5:
      case 2:
        clone.setHours(Math.round(clone.getHours() / 24) * 24); break;
      default:
        clone.setHours(Math.round(clone.getHours() / 12) * 12); break;
    }
    clone.setMinutes(0);
    clone.setSeconds(0);
    clone.setMilliseconds(0);
  }
  else if (scale == 'weekday') {
    //noinspection FallthroughInSwitchStatementJS
    switch (step) {
      case 5:
      case 2:
        clone.setHours(Math.round(clone.getHours() / 12) * 12); break;
      default:
        clone.setHours(Math.round(clone.getHours() / 6) * 6); break;
    }
    clone.setMinutes(0);
    clone.setSeconds(0);
    clone.setMilliseconds(0);
  }
  else if (scale == 'hour') {
    switch (step) {
      case 4:
        clone.setMinutes(Math.round(clone.getMinutes() / 60) * 60); break;
      default:
        clone.setMinutes(Math.round(clone.getMinutes() / 30) * 30); break;
    }
    clone.setSeconds(0);
    clone.setMilliseconds(0);
  } else if (scale == 'minute') {
    //noinspection FallthroughInSwitchStatementJS
    switch (step) {
      case 15:
      case 10:
        clone.setMinutes(Math.round(clone.getMinutes() / 5) * 5);
        clone.setSeconds(0);
        break;
      case 5:
        clone.setSeconds(Math.round(clone.getSeconds() / 60) * 60); break;
      default:
        clone.setSeconds(Math.round(clone.getSeconds() / 30) * 30); break;
    }
    clone.setMilliseconds(0);
  }
  else if (scale == 'second') {
    //noinspection FallthroughInSwitchStatementJS
    switch (step) {
      case 15:
      case 10:
        clone.setSeconds(Math.round(clone.getSeconds() / 5) * 5);
        clone.setMilliseconds(0);
        break;
      case 5:
        clone.setMilliseconds(Math.round(clone.getMilliseconds() / 1000) * 1000); break;
      default:
        clone.setMilliseconds(Math.round(clone.getMilliseconds() / 500) * 500); break;
    }
  }
  else if (scale == 'millisecond') {
    var _step = step > 5 ? step / 2 : 1;
    clone.setMilliseconds(Math.round(clone.getMilliseconds() / _step) * _step);
  }
  
  return clone;
};

/**
 * Check if the current value is a major value (for example when the step
 * is DAY, a major value is each first day of the MONTH)
 * @return {boolean} true if current date is major, else false.
 */
TimeStep.prototype.isMajor = function() {
  if (this.switchedYear == true) {
    this.switchedYear = false;
    switch (this.scale) {
      case 'year':
      case 'month':
      case 'weekday':
      case 'day':
      case 'hour':
      case 'minute':
      case 'second':
      case 'millisecond':
        return true;
      default:
        return false;
    }
  }
  else if (this.switchedMonth == true) {
    this.switchedMonth = false;
    switch (this.scale) {
      case 'weekday':
      case 'day':
      case 'hour':
      case 'minute':
      case 'second':
      case 'millisecond':
        return true;
      default:
        return false;
    }
  }
  else if (this.switchedDay == true) {
    this.switchedDay = false;
    switch (this.scale) {
      case 'millisecond':
      case 'second':
      case 'minute':
      case 'hour':
        return true;
      default:
        return false;
    }
  }

  switch (this.scale) {
    case 'millisecond':
      return (this.current.getMilliseconds() == 0);
    case 'second':
      return (this.current.getSeconds() == 0);
    case 'minute':
      return (this.current.getHours() == 0) && (this.current.getMinutes() == 0);
    case 'hour':
      return (this.current.getHours() == 0);
    case 'weekday': // intentional fall through
    case 'day':
      return (this.current.getDate() == 1);
    case 'month':
      return (this.current.getMonth() == 0);
    case 'year':
      return false;
    default:
      return false;
  }
};


/**
 * Returns formatted text for the minor axislabel, depending on the current
 * date and the scale. For example when scale is MINUTE, the current time is
 * formatted as "hh:mm".
 * @param {Date} [date] custom date. if not provided, current date is taken
 */
TimeStep.prototype.getLabelMinor = function(date) {
  if (date == undefined) {
    date = this.current;
  }

  var format = this.format.minorLabels[this.scale];
  return (format && format.length > 0) ? moment(date).format(format) : '';
};

/**
 * Returns formatted text for the major axis label, depending on the current
 * date and the scale. For example when scale is MINUTE, the major scale is
 * hours, and the hour will be formatted as "hh".
 * @param {Date} [date] custom date. if not provided, current date is taken
 */
TimeStep.prototype.getLabelMajor = function(date) {
  if (date == undefined) {
    date = this.current;
  }

  var format = this.format.majorLabels[this.scale];
  return (format && format.length > 0) ? moment(date).format(format) : '';
};

TimeStep.prototype.getClassName = function() {
  var m = moment(this.current);
  var date = m.locale ? m.locale('en') : m.lang('en'); // old versions of moment have .lang() function
  var step = this.step;

  function even(value) {
    return (value / step % 2 == 0) ? ' even' : ' odd';
  }

  function today(date) {
    if (date.isSame(new Date(), 'day')) {
      return ' today';
    }
    if (date.isSame(moment().add(1, 'day'), 'day')) {
      return ' tomorrow';
    }
    if (date.isSame(moment().add(-1, 'day'), 'day')) {
      return ' yesterday';
    }
    return '';
  }

  function currentWeek(date) {
    return date.isSame(new Date(), 'week') ? ' current-week' : '';
  }

  function currentMonth(date) {
    return date.isSame(new Date(), 'month') ? ' current-month' : '';
  }

  function currentYear(date) {
    return date.isSame(new Date(), 'year') ? ' current-year' : '';
  }

  switch (this.scale) {
    case 'millisecond':
      return even(date.milliseconds()).trim();

    case 'second':
      return even(date.seconds()).trim();

    case 'minute':
      return even(date.minutes()).trim();

    case 'hour':
      var hours = date.hours();
      if (this.step == 4) {
        hours = hours + '-' + (hours + 4);
      }
      return hours + 'h' + today(date) + even(date.hours());

    case 'weekday':
      return date.format('dddd').toLowerCase() +
          today(date) + currentWeek(date) + even(date.date());

    case 'day':
      var day = date.date();
      var month = date.format('MMMM').toLowerCase();
      return 'day' + day + ' ' + month + currentMonth(date) + even(day - 1);

    case 'month':
      return date.format('MMMM').toLowerCase() +
          currentMonth(date) + even(date.month());

    case 'year':
      var year = date.year();
      return 'year' + year + currentYear(date)+ even(year);

    default:
      return '';
  }
};

module.exports = TimeStep;

},{"../module/moment":7,"../util":28,"./DateUtil":10}],14:[function(require,module,exports){
var Emitter = require('emitter-component');
var Hammer = require('../module/hammer');
var util = require('../util');
var DataSet = require('../DataSet');
var DataView = require('../DataView');
var Range = require('./Range');
var Core = require('./Core');
var TimeAxis = require('./component/TimeAxis');
var CurrentTime = require('./component/CurrentTime');
var CustomTime = require('./component/CustomTime');
var ItemSet = require('./component/ItemSet');

/**
 * Create a timeline visualization
 * @param {HTMLElement} container
 * @param {vis.DataSet | vis.DataView | Array | google.visualization.DataTable} [items]
 * @param {vis.DataSet | vis.DataView | Array | google.visualization.DataTable} [groups]
 * @param {Object} [options]  See Timeline.setOptions for the available options.
 * @constructor
 * @extends Core
 */
function Timeline (container, items, groups, options) {
  if (!(this instanceof Timeline)) {
    throw new SyntaxError('Constructor must be called with the new operator');
  }

  // if the third element is options, the forth is groups (optionally);
  if (!(Array.isArray(groups) || groups instanceof DataSet || groups instanceof DataView) && groups instanceof Object) {
    var forthArgument = options;
    options = groups;
    groups = forthArgument;
  }

  var me = this;
  this.defaultOptions = {
    start: null,
    end:   null,

    autoResize: true,

    orientation: 'bottom',  // axis orientation: 'bottom', 'top', or 'both'
    width: null,
    height: null,
    maxHeight: null,
    minHeight: null
  };
  this.options = util.deepExtend({}, this.defaultOptions);

  // Create the DOM, props, and emitter
  this._create(container);

  // all components listed here will be repainted automatically
  this.components = [];

  this.body = {
    dom: this.dom,
    domProps: this.props,
    emitter: {
      on: this.on.bind(this),
      off: this.off.bind(this),
      emit: this.emit.bind(this)
    },
    hiddenDates: [],
    util: {
      getScale: function () {
        return me.timeAxis.step.scale;
      },
      getStep: function () {
        return me.timeAxis.step.step;
      },

      toScreen: me._toScreen.bind(me),
      toGlobalScreen: me._toGlobalScreen.bind(me), // this refers to the root.width
      toTime: me._toTime.bind(me),
      toGlobalTime : me._toGlobalTime.bind(me)
    }
  };

  // range
  this.range = new Range(this.body);
  this.components.push(this.range);
  this.body.range = this.range;

  // time axis
  this.timeAxis = new TimeAxis(this.body);
  this.timeAxis2 = null; // used in case of orientation option 'both'
  this.components.push(this.timeAxis);

  // current time bar
  this.currentTime = new CurrentTime(this.body);
  this.components.push(this.currentTime);

  // custom time bar
  // Note: time bar will be attached in this.setOptions when selected
  this.customTime = new CustomTime(this.body);
  this.components.push(this.customTime);

  // item set
  this.itemSet = new ItemSet(this.body);
  this.components.push(this.itemSet);

  this.itemsData = null;      // DataSet
  this.groupsData = null;     // DataSet

  this.on('tap', function (event) {
    me.emit('click', me.getEventProperties(event))
  });
  this.on('doubletap', function (event) {
    me.emit('doubleClick', me.getEventProperties(event))
  });
  this.dom.root.oncontextmenu = function (event) {
    me.emit('contextmenu', me.getEventProperties(event))
  };

  // apply options
  if (options) {
    this.setOptions(options);
  }

  // IMPORTANT: THIS HAPPENS BEFORE SET ITEMS!
  if (groups) {
    this.setGroups(groups);
  }

  // create itemset
  if (items) {
    this.setItems(items);
  }
  else {
    this._redraw();
  }
}

// Extend the functionality from Core
Timeline.prototype = new Core();

/**
 * Force a redraw. The size of all items will be recalculated.
 * Can be useful to manually redraw when option autoResize=false and the window
 * has been resized, or when the items CSS has been changed.
 */
Timeline.prototype.redraw = function() {
  this.itemSet && this.itemSet.markDirty({refreshItems: true});
  this._redraw();
};

/**
 * Set items
 * @param {vis.DataSet | Array | google.visualization.DataTable | null} items
 */
Timeline.prototype.setItems = function(items) {
  var initialLoad = (this.itemsData == null);

  // convert to type DataSet when needed
  var newDataSet;
  if (!items) {
    newDataSet = null;
  }
  else if (items instanceof DataSet || items instanceof DataView) {
    newDataSet = items;
  }
  else {
    // turn an array into a dataset
    newDataSet = new DataSet(items, {
      type: {
        start: 'Date',
        end: 'Date'
      }
    });
  }

  // set items
  this.itemsData = newDataSet;
  this.itemSet && this.itemSet.setItems(newDataSet);

  if (initialLoad) {
    if (this.options.start != undefined || this.options.end != undefined) {
      if (this.options.start == undefined || this.options.end == undefined) {
        var dataRange = this._getDataRange();
      }

      var start = this.options.start != undefined ? this.options.start : dataRange.start;
      var end   = this.options.end != undefined   ? this.options.end   : dataRange.end;

      this.setWindow(start, end, {animate: false});
    }
    else {
      this.fit({animate: false});
    }
  }
};

/**
 * Set groups
 * @param {vis.DataSet | Array | google.visualization.DataTable} groups
 */
Timeline.prototype.setGroups = function(groups) {
  // convert to type DataSet when needed
  var newDataSet;
  if (!groups) {
    newDataSet = null;
  }
  else if (groups instanceof DataSet || groups instanceof DataView) {
    newDataSet = groups;
  }
  else {
    // turn an array into a dataset
    newDataSet = new DataSet(groups);
  }

  this.groupsData = newDataSet;
  this.itemSet.setGroups(newDataSet);
};

/**
 * Set selected items by their id. Replaces the current selection
 * Unknown id's are silently ignored.
 * @param {string[] | string} [ids]  An array with zero or more id's of the items to be
 *                                selected. If ids is an empty array, all items will be
 *                                unselected.
 * @param {Object} [options]      Available options:
 *                                `focus: boolean`
 *                                    If true, focus will be set to the selected item(s)
 *                                `animate: boolean | number`
 *                                    If true (default), the range is animated
 *                                    smoothly to the new window.
 *                                    If a number, the number is taken as duration
 *                                    for the animation. Default duration is 500 ms.
 *                                    Only applicable when option focus is true.
 */
Timeline.prototype.setSelection = function(ids, options) {
  this.itemSet && this.itemSet.setSelection(ids);

  if (options && options.focus) {
    this.focus(ids, options);
  }
};

/**
 * Get the selected items by their id
 * @return {Array} ids  The ids of the selected items
 */
Timeline.prototype.getSelection = function() {
  return this.itemSet && this.itemSet.getSelection() || [];
};

/**
 * Adjust the visible window such that the selected item (or multiple items)
 * are centered on screen.
 * @param {String | String[]} id     An item id or array with item ids
 * @param {Object} [options]      Available options:
 *                                `animate: boolean | number`
 *                                    If true (default), the range is animated
 *                                    smoothly to the new window.
 *                                    If a number, the number is taken as duration
 *                                    for the animation. Default duration is 500 ms.
 *                                    Only applicable when option focus is true
 */
Timeline.prototype.focus = function(id, options) {
  if (!this.itemsData || id == undefined) return;

  var ids = Array.isArray(id) ? id : [id];

  // get the specified item(s)
  var itemsData = this.itemsData.getDataSet().get(ids, {
    type: {
      start: 'Date',
      end: 'Date'
    }
  });

  // calculate minimum start and maximum end of specified items
  var start = null;
  var end = null;
  itemsData.forEach(function (itemData) {
    var s = itemData.start.valueOf();
    var e = 'end' in itemData ? itemData.end.valueOf() : itemData.start.valueOf();

    if (start === null || s < start) {
      start = s;
    }

    if (end === null || e > end) {
      end = e;
    }
  });

  if (start !== null && end !== null) {
    // calculate the new middle and interval for the window
    var middle = (start + end) / 2;
    var interval = Math.max((this.range.end - this.range.start), (end - start) * 1.1);

    var animate = (options && options.animate !== undefined) ? options.animate : true;
    this.range.setRange(middle - interval / 2, middle + interval / 2, animate);
  }
};

/**
 * Get the data range of the item set.
 * @returns {{min: Date, max: Date}} range  A range with a start and end Date.
 *                                          When no minimum is found, min==null
 *                                          When no maximum is found, max==null
 */
Timeline.prototype.getItemRange = function() {
  // calculate min from start filed
  var dataset = this.itemsData.getDataSet(),
    min = null,
    max = null;

  if (dataset) {
    // calculate the minimum value of the field 'start'
    var minItem = dataset.min('start');
    min = minItem ? util.convert(minItem.start, 'Date').valueOf() : null;
    // Note: we convert first to Date and then to number because else
    // a conversion from ISODate to Number will fail

    // calculate maximum value of fields 'start' and 'end'
    var maxStartItem = dataset.max('start');
    if (maxStartItem) {
      max = util.convert(maxStartItem.start, 'Date').valueOf();
    }
    var maxEndItem = dataset.max('end');
    if (maxEndItem) {
      if (max == null) {
        max = util.convert(maxEndItem.end, 'Date').valueOf();
      }
      else {
        max = Math.max(max, util.convert(maxEndItem.end, 'Date').valueOf());
      }
    }
  }

  return {
    min: (min != null) ? new Date(min) : null,
    max: (max != null) ? new Date(max) : null
  };
};

/**
 * Generate Timeline related information from an event
 * @param {Event} event
 * @return {Object} An object with related information, like on which area
 *                  The event happened, whether clicked on an item, etc.
 */
Timeline.prototype.getEventProperties = function (event) {
  var item  = this.itemSet.itemFromTarget(event);
  var group = this.itemSet.groupFromTarget(event);
  var pageX = event.gesture ? event.gesture.center.pageX : event.pageX;
  var pageY = event.gesture ? event.gesture.center.pageY : event.pageY;
  var x = pageX - util.getAbsoluteLeft(this.dom.centerContainer);
  var y = pageY - util.getAbsoluteTop(this.dom.centerContainer);

  var snap = this.itemSet.options.snap || null;
  var scale = this.body.util.getScale();
  var step = this.body.util.getStep();
  var time = this._toTime(x);
  var snappedTime = snap ? snap(time, scale, step) : time;

  var element = util.getTarget(event);
  var what = null;
  if (item != null)                                                    {what = 'item';}
  else if (util.hasParent(element, this.timeAxis.dom.foreground))      {what = 'axis';}
  else if (this.timeAxis2 && util.hasParent(element, this.timeAxis2.dom.foreground)) {what = 'axis';}
  else if (util.hasParent(element, this.itemSet.dom.labelSet))         {what = 'group-label';}
  else if (util.hasParent(element, this.customTime.bar))               {what = 'custom-time';} // TODO: fix for multiple custom time bars
  else if (util.hasParent(element, this.currentTime.bar))              {what = 'current-time';}
  else if (util.hasParent(element, this.dom.center))                   {what = 'background';}

  return {
    event: event,
    item: item ? item.id : null,
    group: group ? group.groupId : null,
    what: what,
    pageX: pageX,
    pageY: pageY,
    x: x,
    y: y,
    time: time,
    snappedTime: snappedTime
  }
};

module.exports = Timeline;

},{"../DataSet":2,"../DataView":3,"../module/hammer":6,"../util":28,"./Core":9,"./Range":11,"./component/CurrentTime":17,"./component/CustomTime":18,"./component/ItemSet":20,"./component/TimeAxis":21,"emitter-component":29}],15:[function(require,module,exports){
var util = require('../../util');
var Group = require('./Group');

/**
 * @constructor BackgroundGroup
 * @param {Number | String} groupId
 * @param {Object} data
 * @param {ItemSet} itemSet
 */
function BackgroundGroup (groupId, data, itemSet) {
  Group.call(this, groupId, data, itemSet);

  this.width = 0;
  this.height = 0;
  this.top = 0;
  this.left = 0;
}

BackgroundGroup.prototype = Object.create(Group.prototype);

/**
 * Repaint this group
 * @param {{start: number, end: number}} range
 * @param {{item: {horizontal: number, vertical: number}, axis: number}} margin
 * @param {boolean} [restack=false]  Force restacking of all items
 * @return {boolean} Returns true if the group is resized
 */
BackgroundGroup.prototype.redraw = function(range, margin, restack) {
  var resized = false;

  this.visibleItems = this._updateVisibleItems(this.orderedItems, this.visibleItems, range);

  // calculate actual size
  this.width = this.dom.background.offsetWidth;

  // apply new height (just always zero for BackgroundGroup
  this.dom.background.style.height  = '0';

  // update vertical position of items after they are re-stacked and the height of the group is calculated
  for (var i = 0, ii = this.visibleItems.length; i < ii; i++) {
    var item = this.visibleItems[i];
    item.repositionY(margin);
  }

  return resized;
};

/**
 * Show this group: attach to the DOM
 */
BackgroundGroup.prototype.show = function() {
  if (!this.dom.background.parentNode) {
    this.itemSet.dom.background.appendChild(this.dom.background);
  }
};

module.exports = BackgroundGroup;

},{"../../util":28,"./Group":19}],16:[function(require,module,exports){
/**
 * Prototype for visual components
 * @param {{dom: Object, domProps: Object, emitter: Emitter, range: Range}} [body]
 * @param {Object} [options]
 */
function Component (body, options) {
  this.options = null;
  this.props = null;
}

/**
 * Set options for the component. The new options will be merged into the
 * current options.
 * @param {Object} options
 */
Component.prototype.setOptions = function(options) {
  if (options) {
    util.extend(this.options, options);
  }
};

/**
 * Repaint the component
 * @return {boolean} Returns true if the component is resized
 */
Component.prototype.redraw = function() {
  // should be implemented by the component
  return false;
};

/**
 * Destroy the component. Cleanup DOM and event listeners
 */
Component.prototype.destroy = function() {
  // should be implemented by the component
};

/**
 * Test whether the component is resized since the last time _isResized() was
 * called.
 * @return {Boolean} Returns true if the component is resized
 * @protected
 */
Component.prototype._isResized = function() {
  var resized = (this.props._previousWidth !== this.props.width ||
      this.props._previousHeight !== this.props.height);

  this.props._previousWidth = this.props.width;
  this.props._previousHeight = this.props.height;

  return resized;
};

module.exports = Component;

},{}],17:[function(require,module,exports){
var util = require('../../util');
var Component = require('./Component');
var moment = require('../../module/moment');
var locales = require('../locales');

/**
 * A current time bar
 * @param {{range: Range, dom: Object, domProps: Object}} body
 * @param {Object} [options]        Available parameters:
 *                                  {Boolean} [showCurrentTime]
 * @constructor CurrentTime
 * @extends Component
 */
function CurrentTime (body, options) {
  this.body = body;

  // default options
  this.defaultOptions = {
    showCurrentTime: true,

    locales: locales,
    locale: 'en'
  };
  this.options = util.extend({}, this.defaultOptions);
  this.offset = 0;

  this._create();

  this.setOptions(options);
}

CurrentTime.prototype = new Component();

/**
 * Create the HTML DOM for the current time bar
 * @private
 */
CurrentTime.prototype._create = function() {
  var bar = document.createElement('div');
  bar.className = 'currenttime';
  bar.style.position = 'absolute';
  bar.style.top = '0px';
  bar.style.height = '100%';

  this.bar = bar;
};

/**
 * Destroy the CurrentTime bar
 */
CurrentTime.prototype.destroy = function () {
  this.options.showCurrentTime = false;
  this.redraw(); // will remove the bar from the DOM and stop refreshing

  this.body = null;
};

/**
 * Set options for the component. Options will be merged in current options.
 * @param {Object} options  Available parameters:
 *                          {boolean} [showCurrentTime]
 */
CurrentTime.prototype.setOptions = function(options) {
  if (options) {
    // copy all options that we know
    util.selectiveExtend(['showCurrentTime', 'locale', 'locales'], this.options, options);
  }
};

/**
 * Repaint the component
 * @return {boolean} Returns true if the component is resized
 */
CurrentTime.prototype.redraw = function() {
  if (this.options.showCurrentTime) {
    var parent = this.body.dom.backgroundVertical;
    if (this.bar.parentNode != parent) {
      // attach to the dom
      if (this.bar.parentNode) {
        this.bar.parentNode.removeChild(this.bar);
      }
      parent.appendChild(this.bar);

      this.start();
    }

    var now = new Date(new Date().valueOf() + this.offset);
    var x = this.body.util.toScreen(now);

    var locale = this.options.locales[this.options.locale];
    var title = locale.current + ' ' + locale.time + ': ' + moment(now).format('dddd, MMMM Do YYYY, H:mm:ss');
    title = title.charAt(0).toUpperCase() + title.substring(1);

    this.bar.style.left = x + 'px';
    this.bar.title = title;
  }
  else {
    // remove the line from the DOM
    if (this.bar.parentNode) {
      this.bar.parentNode.removeChild(this.bar);
    }
    this.stop();
  }

  return false;
};

/**
 * Start auto refreshing the current time bar
 */
CurrentTime.prototype.start = function() {
  var me = this;

  function update () {
    me.stop();

    // determine interval to refresh
    var scale = me.body.range.conversion(me.body.domProps.center.width).scale;
    var interval = 1 / scale / 10;
    if (interval < 30)   interval = 30;
    if (interval > 1000) interval = 1000;

    me.redraw();

    // start a timer to adjust for the new time
    me.currentTimeTimer = setTimeout(update, interval);
  }

  update();
};

/**
 * Stop auto refreshing the current time bar
 */
CurrentTime.prototype.stop = function() {
  if (this.currentTimeTimer !== undefined) {
    clearTimeout(this.currentTimeTimer);
    delete this.currentTimeTimer;
  }
};

/**
 * Set a current time. This can be used for example to ensure that a client's
 * time is synchronized with a shared server time.
 * @param {Date | String | Number} time     A Date, unix timestamp, or
 *                                          ISO date string.
 */
CurrentTime.prototype.setCurrentTime = function(time) {
  var t = util.convert(time, 'Date').valueOf();
  var now = new Date().valueOf();
  this.offset = t - now;
  this.redraw();
};

/**
 * Get the current time.
 * @return {Date} Returns the current time.
 */
CurrentTime.prototype.getCurrentTime = function() {
  return new Date(new Date().valueOf() + this.offset);
};

module.exports = CurrentTime;

},{"../../module/moment":7,"../../util":28,"../locales":27,"./Component":16}],18:[function(require,module,exports){
var Hammer = require('../../module/hammer');
var util = require('../../util');
var Component = require('./Component');
var moment = require('../../module/moment');
var locales = require('../locales');

/**
 * A custom time bar
 * @param {{range: Range, dom: Object}} body
 * @param {Object} [options]        Available parameters:
 *                                  {Boolean} [showCustomTime]
 * @constructor CustomTime
 * @extends Component
 */

function CustomTime (body, options) {
  this.body = body;

  // default options
  this.defaultOptions = {
    showCustomTime: false,
    locales: locales,
    locale: 'en',
    id: 0
  };
  this.options = util.extend({}, this.defaultOptions);

  if (options && options.time) {
    this.customTime = options.time;
  } else {
    this.customTime = new Date();  
  }
  
  this.eventParams = {}; // stores state parameters while dragging the bar

  // create the DOM
  this._create();

  this.setOptions(options);
}

CustomTime.prototype = new Component();

/**
 * Set options for the component. Options will be merged in current options.
 * @param {Object} options  Available parameters:
 *                          {boolean} [showCustomTime]
 */
CustomTime.prototype.setOptions = function(options) {
  if (options) {
    // copy all options that we know
    util.selectiveExtend(['showCustomTime', 'locale', 'locales', 'id'], this.options, options);

    // Triggered by addCustomTimeBar, redraw to add new bar
    if (this.options.id) {
      this.redraw();
    }
  }
};

/**
 * Create the DOM for the custom time
 * @private
 */
CustomTime.prototype._create = function() {
  var bar = document.createElement('div');
  bar.className = 'customtime';
  bar.style.position = 'absolute';
  bar.style.top = '0px';
  bar.style.height = '100%';
  this.bar = bar;

  var drag = document.createElement('div');
  drag.style.position = 'relative';
  drag.style.top = '0px';
  drag.style.left = '-10px';
  drag.style.height = '100%';
  drag.style.width = '20px';
  bar.appendChild(drag);

  // attach event listeners
  this.hammer = Hammer(bar, {
    prevent_default: true
  });
  this.hammer.on('dragstart', this._onDragStart.bind(this));
  this.hammer.on('drag',      this._onDrag.bind(this));
  this.hammer.on('dragend',   this._onDragEnd.bind(this));
};

/**
 * Destroy the CustomTime bar
 */
CustomTime.prototype.destroy = function () {
  this.options.showCustomTime = false;
  this.redraw(); // will remove the bar from the DOM

  this.hammer.enable(false);
  this.hammer = null;

  this.body = null;
};

/**
 * Repaint the component
 * @return {boolean} Returns true if the component is resized
 */
CustomTime.prototype.redraw = function () {
  if (this.options.showCustomTime) {
    var parent = this.body.dom.backgroundVertical;
    if (this.bar.parentNode != parent) {
      // attach to the dom
      if (this.bar.parentNode) {
        this.bar.parentNode.removeChild(this.bar);
      }
      parent.appendChild(this.bar);
    }

    var x = this.body.util.toScreen(this.customTime);

    var locale = this.options.locales[this.options.locale];
    var title = locale.time + ': ' + moment(this.customTime).format('dddd, MMMM Do YYYY, H:mm:ss');
    title = title.charAt(0).toUpperCase() + title.substring(1);

    this.bar.style.left = x + 'px';
    this.bar.title = title;
  }
  else {
    // remove the line from the DOM
    if (this.bar.parentNode) {
      this.bar.parentNode.removeChild(this.bar);
    }
  }

  return false;
};

/**
 * Set custom time.
 * @param {Date | number | string} time
 */
CustomTime.prototype.setCustomTime = function(time) {
  this.customTime = util.convert(time, 'Date');
  this.redraw();
};

/**
 * Retrieve the current custom time.
 * @return {Date} customTime
 */
CustomTime.prototype.getCustomTime = function() {
  return new Date(this.customTime.valueOf());
};

/**
 * Start moving horizontally
 * @param {Event} event
 * @private
 */
CustomTime.prototype._onDragStart = function(event) {
  this.eventParams.dragging = true;
  this.eventParams.customTime = this.customTime;

  event.stopPropagation();
  event.preventDefault();
};

/**
 * Perform moving operating.
 * @param {Event} event
 * @private
 */
CustomTime.prototype._onDrag = function (event) {
  if (!this.eventParams.dragging) return;

  var deltaX = event.gesture.deltaX,
      x = this.body.util.toScreen(this.eventParams.customTime) + deltaX,
      time = this.body.util.toTime(x);

  this.setCustomTime(time);

  // fire a timechange event
  this.body.emitter.emit('timechange', {
    id: this.options.id,
    time: new Date(this.customTime.valueOf())
  });

  event.stopPropagation();
  event.preventDefault();
};

/**
 * Stop moving operating.
 * @param {event} event
 * @private
 */
CustomTime.prototype._onDragEnd = function (event) {
  if (!this.eventParams.dragging) return;

  // fire a timechanged event
  this.body.emitter.emit('timechanged', {
    id: this.options.id,
    time: new Date(this.customTime.valueOf())
  });

  event.stopPropagation();
  event.preventDefault();
};

module.exports = CustomTime;

},{"../../module/hammer":6,"../../module/moment":7,"../../util":28,"../locales":27,"./Component":16}],19:[function(require,module,exports){
var util = require('../../util');
var stack = require('../Stack');
var RangeItem = require('./item/RangeItem');

/**
 * @constructor Group
 * @param {Number | String} groupId
 * @param {Object} data
 * @param {ItemSet} itemSet
 */
function Group (groupId, data, itemSet) {
  this.groupId = groupId;
  this.subgroups = {};
  this.subgroupIndex = 0;
  this.subgroupOrderer = data && data.subgroupOrder;
  this.itemSet = itemSet;

  this.dom = {};
  this.props = {
    label: {
      width: 0,
      height: 0
    }
  };
  this.className = null;

  this.items = {};        // items filtered by groupId of this group
  this.visibleItems = []; // items currently visible in window
  this.orderedItems = {
    byStart: [],
    byEnd: []
  };
  this.checkRangedItems = false; // needed to refresh the ranged items if the window is programatically changed with NO overlap.
  var me = this;
  this.itemSet.body.emitter.on("checkRangedItems", function () {
    me.checkRangedItems = true;
  })

  this._create();

  this.setData(data);
}

/**
 * Create DOM elements for the group
 * @private
 */
Group.prototype._create = function() {
  var label = document.createElement('div');
  label.className = 'vlabel';
  this.dom.label = label;

  var inner = document.createElement('div');
  inner.className = 'inner';
  label.appendChild(inner);
  this.dom.inner = inner;

  var foreground = document.createElement('div');
  foreground.className = 'group';
  foreground['timeline-group'] = this;
  this.dom.foreground = foreground;

  this.dom.background = document.createElement('div');
  this.dom.background.className = 'group';

  this.dom.axis = document.createElement('div');
  this.dom.axis.className = 'group';

  // create a hidden marker to detect when the Timelines container is attached
  // to the DOM, or the style of a parent of the Timeline is changed from
  // display:none is changed to visible.
  this.dom.marker = document.createElement('div');
  this.dom.marker.style.visibility = 'hidden'; // TODO: ask jos why this is not none?
  this.dom.marker.innerHTML = '?';
  this.dom.background.appendChild(this.dom.marker);
};

/**
 * Set the group data for this group
 * @param {Object} data   Group data, can contain properties content and className
 */
Group.prototype.setData = function(data) {
  // update contents
  var content = data && data.content;
  if (content instanceof Element) {
    this.dom.inner.appendChild(content);
  }
  else if (content !== undefined && content !== null) {
    this.dom.inner.innerHTML = content;
  }
  else {
    this.dom.inner.innerHTML = this.groupId || ''; // groupId can be null
  }

  // update title
  this.dom.label.title = data && data.title || '';

  if (!this.dom.inner.firstChild) {
    util.addClassName(this.dom.inner, 'hidden');
  }
  else {
    util.removeClassName(this.dom.inner, 'hidden');
  }

  // update className
  var className = data && data.className || null;
  if (className != this.className) {
    if (this.className) {
      util.removeClassName(this.dom.label, this.className);
      util.removeClassName(this.dom.foreground, this.className);
      util.removeClassName(this.dom.background, this.className);
      util.removeClassName(this.dom.axis, this.className);
    }
    util.addClassName(this.dom.label, className);
    util.addClassName(this.dom.foreground, className);
    util.addClassName(this.dom.background, className);
    util.addClassName(this.dom.axis, className);
    this.className = className;
  }

  // update style
  if (this.style) {
    util.removeCssText(this.dom.label, this.style);
    this.style = null;
  }
  if (data && data.style) {
    util.addCssText(this.dom.label, data.style);
    this.style = data.style;
  }
};

/**
 * Get the width of the group label
 * @return {number} width
 */
Group.prototype.getLabelWidth = function() {
  return this.props.label.width;
};


/**
 * Repaint this group
 * @param {{start: number, end: number}} range
 * @param {{item: {horizontal: number, vertical: number}, axis: number}} margin
 * @param {boolean} [restack=false]  Force restacking of all items
 * @return {boolean} Returns true if the group is resized
 */
Group.prototype.redraw = function(range, margin, restack) {
  var resized = false;

  // force recalculation of the height of the items when the marker height changed
  // (due to the Timeline being attached to the DOM or changed from display:none to visible)
  var markerHeight = this.dom.marker.clientHeight;
  if (markerHeight != this.lastMarkerHeight) {
    this.lastMarkerHeight = markerHeight;

    util.forEach(this.items, function (item) {
      item.dirty = true;
      if (item.displayed) item.redraw();
    });

    restack = true;
  }

  // reposition visible items vertically
  if (typeof this.itemSet.options.order === 'function') {
    // a custom order function

    if (restack) {
      // brute force restack of all items

      // show all items
      var me = this;
      var limitSize = false;
      util.forEach(this.items, function (item) {
        if (!item.displayed) {
          item.redraw();
          me.visibleItems.push(item);
        }
        item.repositionX(limitSize);
      });

      // order all items and force a restacking
      var customOrderedItems = this.orderedItems.byStart.slice().sort(function (a, b) {
        return me.itemSet.options.order(a.data, b.data);
      });
      stack.stack(customOrderedItems, margin, true /* restack=true */);
    }

    this.visibleItems = this._updateVisibleItems(this.orderedItems, this.visibleItems, range);
  }
  else {
    // no custom order function, lazy stacking
    this.visibleItems = this._updateVisibleItems(this.orderedItems, this.visibleItems, range);

    if (this.itemSet.options.stack) { // TODO: ugly way to access options...
      stack.stack(this.visibleItems, margin, restack);
    }
    else { // no stacking
      stack.nostack(this.visibleItems, margin, this.subgroups);
    }
  }

  // recalculate the height of the group
  var height = this._calculateHeight(margin);

  // calculate actual size and position
  var foreground = this.dom.foreground;
  this.top = foreground.offsetTop;
  this.left = foreground.offsetLeft;
  this.width = foreground.offsetWidth;
  resized = util.updateProperty(this, 'height', height) || resized;

  // recalculate size of label
  resized = util.updateProperty(this.props.label, 'width', this.dom.inner.clientWidth) || resized;
  resized = util.updateProperty(this.props.label, 'height', this.dom.inner.clientHeight) || resized;

  // apply new height
  this.dom.background.style.height  = height + 'px';
  this.dom.foreground.style.height  = height + 'px';
  this.dom.label.style.height = height + 'px';

  // update vertical position of items after they are re-stacked and the height of the group is calculated
  for (var i = 0, ii = this.visibleItems.length; i < ii; i++) {
    var item = this.visibleItems[i];
    item.repositionY(margin);
  }

  return resized;
};

/**
 * recalculate the height of the group
 * @param {{item: {horizontal: number, vertical: number}, axis: number}} margin
 * @returns {number} Returns the height
 * @private
 */
Group.prototype._calculateHeight = function (margin) {
  // recalculate the height of the group
  var height;
  var visibleItems = this.visibleItems;
  //var visibleSubgroups = [];
  //this.visibleSubgroups = 0;
  this.resetSubgroups();
  var me = this;
  if (visibleItems.length) {
    var min = visibleItems[0].top;
    var max = visibleItems[0].top + visibleItems[0].height;
    util.forEach(visibleItems, function (item) {
      min = Math.min(min, item.top);
      max = Math.max(max, (item.top + item.height));
      if (item.data.subgroup !== undefined) {
        me.subgroups[item.data.subgroup].height = Math.max(me.subgroups[item.data.subgroup].height,item.height);
        me.subgroups[item.data.subgroup].visible = true;
        //if (visibleSubgroups.indexOf(item.data.subgroup) == -1){
        //  visibleSubgroups.push(item.data.subgroup);
        //  me.visibleSubgroups += 1;
        //}
      }
    });
    if (min > margin.axis) {
      // there is an empty gap between the lowest item and the axis
      var offset = min - margin.axis;
      max -= offset;
      util.forEach(visibleItems, function (item) {
        item.top -= offset;
      });
    }
    height = max + margin.item.vertical / 2;
  }
  else {
    height = 0;
  }
  height = Math.max(height, this.props.label.height);

  return height;
};

/**
 * Show this group: attach to the DOM
 */
Group.prototype.show = function() {
  if (!this.dom.label.parentNode) {
    this.itemSet.dom.labelSet.appendChild(this.dom.label);
  }

  if (!this.dom.foreground.parentNode) {
    this.itemSet.dom.foreground.appendChild(this.dom.foreground);
  }

  if (!this.dom.background.parentNode) {
    this.itemSet.dom.background.appendChild(this.dom.background);
  }

  if (!this.dom.axis.parentNode) {
    this.itemSet.dom.axis.appendChild(this.dom.axis);
  }
};

/**
 * Hide this group: remove from the DOM
 */
Group.prototype.hide = function() {
  var label = this.dom.label;
  if (label.parentNode) {
    label.parentNode.removeChild(label);
  }

  var foreground = this.dom.foreground;
  if (foreground.parentNode) {
    foreground.parentNode.removeChild(foreground);
  }

  var background = this.dom.background;
  if (background.parentNode) {
    background.parentNode.removeChild(background);
  }

  var axis = this.dom.axis;
  if (axis.parentNode) {
    axis.parentNode.removeChild(axis);
  }
};

/**
 * Add an item to the group
 * @param {Item} item
 */
Group.prototype.add = function(item) {
  this.items[item.id] = item;
  item.setParent(this);

  // add to
  if (item.data.subgroup !== undefined) {
    if (this.subgroups[item.data.subgroup] === undefined) {
      this.subgroups[item.data.subgroup] = {height:0, visible: false, index:this.subgroupIndex, items: []};
      this.subgroupIndex++;
    }
    this.subgroups[item.data.subgroup].items.push(item);
  }
  this.orderSubgroups();

  if (this.visibleItems.indexOf(item) == -1) {
    var range = this.itemSet.body.range; // TODO: not nice accessing the range like this
    this._checkIfVisible(item, this.visibleItems, range);
  }
};

Group.prototype.orderSubgroups = function() {
  if (this.subgroupOrderer !== undefined) {
    var sortArray = [];
    if (typeof this.subgroupOrderer == 'string') {
      for (var subgroup in this.subgroups) {
        sortArray.push({subgroup: subgroup, sortField: this.subgroups[subgroup].items[0].data[this.subgroupOrderer]})
      }
      sortArray.sort(function (a, b) {
        return a.sortField - b.sortField;
      })
    }
    else if (typeof this.subgroupOrderer == 'function') {
      for (var subgroup in this.subgroups) {
        sortArray.push(this.subgroups[subgroup].items[0].data);
      }
      sortArray.sort(this.subgroupOrderer);
    }

    if (sortArray.length > 0) {
      for (var i = 0; i < sortArray.length; i++) {
        this.subgroups[sortArray[i].subgroup].index = i;
      }
    }
  }
};

Group.prototype.resetSubgroups = function() {
  for (var subgroup in this.subgroups) {
    if (this.subgroups.hasOwnProperty(subgroup)) {
      this.subgroups[subgroup].visible = false;
    }
  }
};

/**
 * Remove an item from the group
 * @param {Item} item
 */
Group.prototype.remove = function(item) {
  delete this.items[item.id];
  item.setParent(null);

  // remove from visible items
  var index = this.visibleItems.indexOf(item);
  if (index != -1) this.visibleItems.splice(index, 1);

  // TODO: also remove from ordered items?
};


/**
 * Remove an item from the corresponding DataSet
 * @param {Item} item
 */
Group.prototype.removeFromDataSet = function(item) {
  this.itemSet.removeItem(item.id);
};


/**
 * Reorder the items
 */
Group.prototype.order = function() {
  var array = util.toArray(this.items);
  var startArray = [];
  var endArray = [];

  for (var i = 0; i < array.length; i++) {
    if (array[i].data.end !== undefined) {
      endArray.push(array[i]);
    }
    startArray.push(array[i]);
  }
  this.orderedItems = {
    byStart: startArray,
    byEnd: endArray
  };

  stack.orderByStart(this.orderedItems.byStart);
  stack.orderByEnd(this.orderedItems.byEnd);
};


/**
 * Update the visible items
 * @param {{byStart: Item[], byEnd: Item[]}} orderedItems   All items ordered by start date and by end date
 * @param {Item[]} visibleItems                             The previously visible items.
 * @param {{start: number, end: number}} range              Visible range
 * @return {Item[]} visibleItems                            The new visible items.
 * @private
 */
Group.prototype._updateVisibleItems = function(orderedItems, oldVisibleItems, range) {
  var visibleItems = [];
  var visibleItemsLookup = {}; // we keep this to quickly look up if an item already exists in the list without using indexOf on visibleItems
  var interval = (range.end - range.start) / 4;
  var lowerBound = range.start - interval;
  var upperBound = range.end + interval;
  var item, i;

  // this function is used to do the binary search.
  var searchFunction = function (value) {
    if      (value < lowerBound)  {return -1;}
    else if (value <= upperBound) {return  0;}
    else                          {return  1;}
  }

  // first check if the items that were in view previously are still in view.
  // IMPORTANT: this handles the case for the items with startdate before the window and enddate after the window!
  // also cleans up invisible items.
  if (oldVisibleItems.length > 0) {
    for (i = 0; i < oldVisibleItems.length; i++) {
      this._checkIfVisibleWithReference(oldVisibleItems[i], visibleItems, visibleItemsLookup, range);
    }
  }

  // we do a binary search for the items that have only start values.
  var initialPosByStart = util.binarySearchCustom(orderedItems.byStart, searchFunction, 'data','start');

  // trace the visible items from the inital start pos both ways until an invisible item is found, we only look at the start values.
  this._traceVisible(initialPosByStart, orderedItems.byStart, visibleItems, visibleItemsLookup, function (item) {
    return (item.data.start < lowerBound || item.data.start > upperBound);
  });

  // if the window has changed programmatically without overlapping the old window, the ranged items with start < lowerBound and end > upperbound are not shown.
  // We therefore have to brute force check all items in the byEnd list
  if (this.checkRangedItems == true) {
    this.checkRangedItems = false;
    for (i = 0; i < orderedItems.byEnd.length; i++) {
      this._checkIfVisibleWithReference(orderedItems.byEnd[i], visibleItems, visibleItemsLookup, range);
    }
  }
  else {
    // we do a binary search for the items that have defined end times.
    var initialPosByEnd = util.binarySearchCustom(orderedItems.byEnd, searchFunction, 'data','end');

    // trace the visible items from the inital start pos both ways until an invisible item is found, we only look at the end values.
    this._traceVisible(initialPosByEnd, orderedItems.byEnd, visibleItems, visibleItemsLookup, function (item) {
      return (item.data.end < lowerBound || item.data.end > upperBound);
    });
  }


  // finally, we reposition all the visible items.
  for (i = 0; i < visibleItems.length; i++) {
    item = visibleItems[i];
    if (!item.displayed) item.show();
    // reposition item horizontally
    item.repositionX();
  }

  // debug
  //console.log("new line")
  //if (this.groupId == null) {
  //  for (i = 0; i < orderedItems.byStart.length; i++) {
  //    item = orderedItems.byStart[i].data;
  //    console.log('start',i,initialPosByStart, item.start.valueOf(), item.content, item.start >= lowerBound && item.start <= upperBound,i == initialPosByStart ? "<------------------- HEREEEE" : "")
  //  }
  //  for (i = 0; i < orderedItems.byEnd.length; i++) {
  //    item = orderedItems.byEnd[i].data;
  //    console.log('rangeEnd',i,initialPosByEnd, item.end.valueOf(), item.content, item.end >= range.start && item.end <= range.end,i == initialPosByEnd ? "<------------------- HEREEEE" : "")
  //  }
  //}

  return visibleItems;
};

Group.prototype._traceVisible = function (initialPos, items, visibleItems, visibleItemsLookup, breakCondition) {
  var item;
  var i;

  if (initialPos != -1) {
    for (i = initialPos; i >= 0; i--) {
      item = items[i];
      if (breakCondition(item)) {
        break;
      }
      else {
        if (visibleItemsLookup[item.id] === undefined) {
          visibleItemsLookup[item.id] = true;
          visibleItems.push(item);
        }
      }
    }

    for (i = initialPos + 1; i < items.length; i++) {
      item = items[i];
      if (breakCondition(item)) {
        break;
      }
      else {
        if (visibleItemsLookup[item.id] === undefined) {
          visibleItemsLookup[item.id] = true;
          visibleItems.push(item);
        }
      }
    }
  }
}


/**
 * this function is very similar to the _checkIfInvisible() but it does not
 * return booleans, hides the item if it should not be seen and always adds to
 * the visibleItems.
 * this one is for brute forcing and hiding.
 *
 * @param {Item} item
 * @param {Array} visibleItems
 * @param {{start:number, end:number}} range
 * @private
 */
Group.prototype._checkIfVisible = function(item, visibleItems, range) {
    if (item.isVisible(range)) {
      if (!item.displayed) item.show();
      // reposition item horizontally
      item.repositionX();
      visibleItems.push(item);
    }
    else {
      if (item.displayed) item.hide();
    }
};


/**
 * this function is very similar to the _checkIfInvisible() but it does not
 * return booleans, hides the item if it should not be seen and always adds to
 * the visibleItems.
 * this one is for brute forcing and hiding.
 *
 * @param {Item} item
 * @param {Array} visibleItems
 * @param {{start:number, end:number}} range
 * @private
 */
Group.prototype._checkIfVisibleWithReference = function(item, visibleItems, visibleItemsLookup, range) {
  if (item.isVisible(range)) {
    if (visibleItemsLookup[item.id] === undefined) {
      visibleItemsLookup[item.id] = true;
      visibleItems.push(item);
    }
  }
  else {
    if (item.displayed) item.hide();
  }
};



module.exports = Group;

},{"../../util":28,"../Stack":12,"./item/RangeItem":26}],20:[function(require,module,exports){
var Hammer = require('../../module/hammer');
var util = require('../../util');
var DataSet = require('../../DataSet');
var DataView = require('../../DataView');
var TimeStep = require('../TimeStep');
var Component = require('./Component');
var Group = require('./Group');
var BackgroundGroup = require('./BackgroundGroup');
var BoxItem = require('./item/BoxItem');
var PointItem = require('./item/PointItem');
var RangeItem = require('./item/RangeItem');
var BackgroundItem = require('./item/BackgroundItem');


var UNGROUPED = '__ungrouped__';   // reserved group id for ungrouped items
var BACKGROUND = '__background__'; // reserved group id for background items without group

/**
 * An ItemSet holds a set of items and ranges which can be displayed in a
 * range. The width is determined by the parent of the ItemSet, and the height
 * is determined by the size of the items.
 * @param {{dom: Object, domProps: Object, emitter: Emitter, range: Range}} body
 * @param {Object} [options]      See ItemSet.setOptions for the available options.
 * @constructor ItemSet
 * @extends Component
 */
function ItemSet(body, options) {
  this.body = body;

  this.defaultOptions = {
    type: null,  // 'box', 'point', 'range', 'background'
    orientation: 'bottom',  // item orientation: 'top' or 'bottom'
    align: 'auto', // alignment of box items
    stack: true,
    groupOrder: null,

    selectable: true,
    editable: {
      updateTime: false,
      updateGroup: false,
      add: false,
      edit: false,
      show: false,
      remove: false
    },

    snap:  TimeStep.snap,

    onAdd: function (item, callback) {
      callback(item);
    },
    onUpdate: function (item, callback) {
      callback(item);
    },
    onMove: function (item, callback) {
      callback(item);
    },
    onShow: function (item, callback) {
      callback(item);
    },
    onRemove: function (item, callback) {
      callback(item);
    },
    onMoving: function (item, callback) {
      callback(item);
    },

    margin: {
      item: {
        horizontal: 10,
        vertical: 10
      },
      axis: 20
    },
    padding: 5
  };

  // options is shared by this ItemSet and all its items
  this.options = util.extend({}, this.defaultOptions);

  // options for getting items from the DataSet with the correct type
  this.itemOptions = {
    type: {start: 'Date', end: 'Date'}
  };

  this.conversion = {
    toScreen: body.util.toScreen,
    toTime: body.util.toTime
  };
  this.dom = {};
  this.props = {};
  this.hammer = null;

  var me = this;
  this.itemsData = null;    // DataSet
  this.groupsData = null;   // DataSet

  // listeners for the DataSet of the items
  this.itemListeners = {
    'add': function (event, params, senderId) {
      me._onAdd(params.items);
    },
    'update': function (event, params, senderId) {
      me._onUpdate(params.items);
    },
    'remove': function (event, params, senderId) {
      me._onRemove(params.items);
    }
  };

  // listeners for the DataSet of the groups
  this.groupListeners = {
    'add': function (event, params, senderId) {
      me._onAddGroups(params.items);
    },
    'update': function (event, params, senderId) {
      me._onUpdateGroups(params.items);
    },
    'remove': function (event, params, senderId) {
      me._onRemoveGroups(params.items);
    }
  };

  this.items = {};      // object with an Item for every data item
  this.groups = {};     // Group object for every group
  this.groupIds = [];

  this.selection = [];  // list with the ids of all selected nodes
  this.stackDirty = true; // if true, all items will be restacked on next redraw

  this.touchParams = {}; // stores properties while dragging
  // create the HTML DOM

  this._create();

  this.setOptions(options);
}

ItemSet.prototype = new Component();

// available item types will be registered here
ItemSet.types = {
  background: BackgroundItem,
  box: BoxItem,
  range: RangeItem,
  point: PointItem
};

/**
 * Create the HTML DOM for the ItemSet
 */
ItemSet.prototype._create = function(){
  var frame = document.createElement('div');
  frame.className = 'itemset';
  frame['timeline-itemset'] = this;
  this.dom.frame = frame;

  // create background panel
  var background = document.createElement('div');
  background.className = 'background';
  frame.appendChild(background);
  this.dom.background = background;

  // create foreground panel
  var foreground = document.createElement('div');
  foreground.className = 'foreground';
  frame.appendChild(foreground);
  this.dom.foreground = foreground;

  // create axis panel
  var axis = document.createElement('div');
  axis.className = 'axis';
  this.dom.axis = axis;

  // create labelset
  var labelSet = document.createElement('div');
  labelSet.className = 'labelset';
  this.dom.labelSet = labelSet;

  // create ungrouped Group
  this._updateUngrouped();

  // create background Group
  var backgroundGroup = new BackgroundGroup(BACKGROUND, null, this);
  backgroundGroup.show();
  this.groups[BACKGROUND] = backgroundGroup;

  // attach event listeners
  // Note: we bind to the centerContainer for the case where the height
  //       of the center container is larger than of the ItemSet, so we
  //       can click in the empty area to create a new item or deselect an item.
  this.hammer = Hammer(this.body.dom.centerContainer, {
    preventDefault: true
  });

  // drag items when selected
  this.hammer.on('touch',     this._onTouch.bind(this));
  this.hammer.on('dragstart', this._onDragStart.bind(this));
  this.hammer.on('drag',      this._onDrag.bind(this));
  this.hammer.on('dragend',   this._onDragEnd.bind(this));

  // single select (or unselect) when tapping an item
  this.hammer.on('tap',  this._onSelectItem.bind(this));

  // multi select when holding mouse/touch, or on ctrl+click
  this.hammer.on('hold', this._onMultiSelectItem.bind(this));

  // add item on doubletap
  this.hammer.on('doubletap', this._onAddItem.bind(this));

  // attach to the DOM
  this.show();
};

/**
 * Set options for the ItemSet. Existing options will be extended/overwritten.
 * @param {Object} [options] The following options are available:
 *                           {String} type
 *                              Default type for the items. Choose from 'box'
 *                              (default), 'point', 'range', or 'background'.
 *                              The default style can be overwritten by
 *                              individual items.
 *                           {String} align
 *                              Alignment for the items, only applicable for
 *                              BoxItem. Choose 'center' (default), 'left', or
 *                              'right'.
 *                           {String} orientation
 *                              Orientation of the item set. Choose 'top' or
 *                              'bottom' (default).
 *                           {Function} groupOrder
 *                              A sorting function for ordering groups
 *                           {Boolean} stack
 *                              If true (deafult), items will be stacked on
 *                              top of each other.
 *                           {Number} margin.axis
 *                              Margin between the axis and the items in pixels.
 *                              Default is 20.
 *                           {Number} margin.item.horizontal
 *                              Horizontal margin between items in pixels.
 *                              Default is 10.
 *                           {Number} margin.item.vertical
 *                              Vertical Margin between items in pixels.
 *                              Default is 10.
 *                           {Number} margin.item
 *                              Margin between items in pixels in both horizontal
 *                              and vertical direction. Default is 10.
 *                           {Number} margin
 *                              Set margin for both axis and items in pixels.
 *                           {Number} padding
 *                              Padding of the contents of an item in pixels.
 *                              Must correspond with the items css. Default is 5.
 *                           {Boolean} selectable
 *                              If true (default), items can be selected.
 *                           {Boolean} editable
 *                              Set all editable options to true or false
 *                           {Boolean} editable.updateTime
 *                              Allow dragging an item to an other moment in time
 *                           {Boolean} editable.updateGroup
 *                              Allow dragging an item to an other group
 *                           {Boolean} editable.add
 *                              Allow creating new items on double tap
 *                           {Boolean} editable.remove
 *                              Allow removing items by clicking the delete button
 *                              top right of a selected item.
 *                           {Function(item: Item, callback: Function)} onAdd
 *                              Callback function triggered when an item is about to be added:
 *                              when the user double taps an empty space in the Timeline.
 *                           {Function(item: Item, callback: Function)} onUpdate
 *                              Callback function fired when an item is about to be updated.
 *                              This function typically has to show a dialog where the user
 *                              change the item. If not implemented, nothing happens.
 *                           {Function(item: Item, callback: Function)} onMove
 *                              Fired when an item has been moved. If not implemented,
 *                              the move action will be accepted.
 *                           {Function(item: Item, callback: Function)} onRemove
 *                              Fired when an item is about to be deleted.
 *                              If not implemented, the item will be always removed.
 */
ItemSet.prototype.setOptions = function(options) {
  if (options) {
    // copy all options that we know
    var fields = ['type', 'align', 'order', 'padding', 'stack', 'selectable', 'groupOrder', 'dataAttributes', 'template','hide', 'snap'];
    util.selectiveExtend(fields, this.options, options);

    if ('orientation' in options) {
      if (typeof options.orientation === 'string') {
        this.options.orientation = options.orientation;
      }
      else if (typeof options.orientation === 'object' && 'item' in options.orientation) {
        this.options.orientation = options.orientation.item;
      }
    }

    if ('margin' in options) {
      if (typeof options.margin === 'number') {
        this.options.margin.axis = options.margin;
        this.options.margin.item.horizontal = options.margin;
        this.options.margin.item.vertical = options.margin;
      }
      else if (typeof options.margin === 'object') {
        util.selectiveExtend(['axis'], this.options.margin, options.margin);
        if ('item' in options.margin) {
          if (typeof options.margin.item === 'number') {
            this.options.margin.item.horizontal = options.margin.item;
            this.options.margin.item.vertical = options.margin.item;
          }
          else if (typeof options.margin.item === 'object') {
            util.selectiveExtend(['horizontal', 'vertical'], this.options.margin.item, options.margin.item);
          }
        }
      }
    }

    if ('editable' in options) {
      if (typeof options.editable === 'boolean') {
        this.options.editable.updateTime  = options.editable;
        this.options.editable.updateGroup = options.editable;
        this.options.editable.add         = options.editable;
        this.options.editable.edit        = options.editable;
        this.options.editable.show        = options.editable;
        this.options.editable.remove      = options.editable;
      }
      else if (typeof options.editable === 'object') {
        util.selectiveExtend(['updateTime', 'updateGroup', 'add', 'edit', 'show', 'remove'], this.options.editable, options.editable);
      }
    }

    // callback functions
    var addCallback = (function (name) {
      var fn = options[name];
      if (fn) {
        if (!(fn instanceof Function)) {
          throw new Error('option ' + name + ' must be a function ' + name + '(item, callback)');
        }
        this.options[name] = fn;
      }
    }).bind(this);
    ['onAdd', 'onUpdate', 'onRemove', 'onMove', 'onMoving'].forEach(addCallback);

    // force the itemSet to refresh: options like orientation and margins may be changed
    this.markDirty();
  }
};

/**
 * Mark the ItemSet dirty so it will refresh everything with next redraw.
 * Optionally, all items can be marked as dirty and be refreshed.
 * @param {{refreshItems: boolean}} [options]
 */
ItemSet.prototype.markDirty = function(options) {
  this.groupIds = [];
  this.stackDirty = true;

  if (options && options.refreshItems) {
    util.forEach(this.items, function (item) {
      item.dirty = true;
      if (item.displayed) item.redraw();
    });
  }
};

/**
 * Destroy the ItemSet
 */
ItemSet.prototype.destroy = function() {
  this.hide();
  this.setItems(null);
  this.setGroups(null);

  this.hammer = null;

  this.body = null;
  this.conversion = null;
};

/**
 * Hide the component from the DOM
 */
ItemSet.prototype.hide = function() {
  // remove the frame containing the items
  if (this.dom.frame.parentNode) {
    this.dom.frame.parentNode.removeChild(this.dom.frame);
  }

  // remove the axis with dots
  if (this.dom.axis.parentNode) {
    this.dom.axis.parentNode.removeChild(this.dom.axis);
  }

  // remove the labelset containing all group labels
  if (this.dom.labelSet.parentNode) {
    this.dom.labelSet.parentNode.removeChild(this.dom.labelSet);
  }
};

/**
 * Show the component in the DOM (when not already visible).
 * @return {Boolean} changed
 */
ItemSet.prototype.show = function() {
  // show frame containing the items
  if (!this.dom.frame.parentNode) {
    this.body.dom.center.appendChild(this.dom.frame);
  }

  // show axis with dots
  if (!this.dom.axis.parentNode) {
    this.body.dom.backgroundVertical.appendChild(this.dom.axis);
  }

  // show labelset containing labels
  if (!this.dom.labelSet.parentNode) {
    this.body.dom.left.appendChild(this.dom.labelSet);
  }
};

/**
 * Set selected items by their id. Replaces the current selection
 * Unknown id's are silently ignored.
 * @param {string[] | string} [ids] An array with zero or more id's of the items to be
 *                                  selected, or a single item id. If ids is undefined
 *                                  or an empty array, all items will be unselected.
 */
ItemSet.prototype.setSelection = function(ids) {
  var i, ii, id, item;

  if (ids == undefined) ids = [];
  if (!Array.isArray(ids)) ids = [ids];

  // unselect currently selected items
  for (i = 0, ii = this.selection.length; i < ii; i++) {
    id = this.selection[i];
    item = this.items[id];
    if (item) item.unselect();
  }

  // select items
  this.selection = [];
  for (i = 0, ii = ids.length; i < ii; i++) {
    id = ids[i];
    item = this.items[id];
    if (item) {
      this.selection.push(id);
      item.select();
    }
  }
};

/**
 * Get the selected items by their id
 * @return {Array} ids  The ids of the selected items
 */
ItemSet.prototype.getSelection = function() {
  return this.selection.concat([]);
};

/**
 * Get the id's of the currently visible items.
 * @returns {Array} The ids of the visible items
 */
ItemSet.prototype.getVisibleItems = function() {
  var range = this.body.range.getRange();
  var left  = this.body.util.toScreen(range.start);
  var right = this.body.util.toScreen(range.end);

  var ids = [];
  for (var groupId in this.groups) {
    if (this.groups.hasOwnProperty(groupId)) {
      var group = this.groups[groupId];
      var rawVisibleItems = group.visibleItems;

      // filter the "raw" set with visibleItems into a set which is really
      // visible by pixels
      for (var i = 0; i < rawVisibleItems.length; i++) {
        var item = rawVisibleItems[i];
        // TODO: also check whether visible vertically
        if ((item.left < right) && (item.left + item.width > left)) {
          ids.push(item.id);
        }
      }
    }
  }

  return ids;
};

/**
 * Deselect a selected item
 * @param {String | Number} id
 * @private
 */
ItemSet.prototype._deselect = function(id) {
  var selection = this.selection;
  for (var i = 0, ii = selection.length; i < ii; i++) {
    if (selection[i] == id) { // non-strict comparison!
      selection.splice(i, 1);
      break;
    }
  }
};

/**
 * Repaint the component
 * @return {boolean} Returns true if the component is resized
 */
ItemSet.prototype.redraw = function() {
  var margin = this.options.margin,
      range = this.body.range,
      asSize = util.option.asSize,
      options = this.options,
      orientation = options.orientation,
      resized = false,
      frame = this.dom.frame,
      editable = options.editable.updateTime || options.editable.updateGroup;

  // recalculate absolute position (before redrawing groups)
  this.props.top = this.body.domProps.top.height + this.body.domProps.border.top;
  this.props.left = this.body.domProps.left.width + this.body.domProps.border.left;

  // update class name
  frame.className = 'itemset' + (editable ? ' editable' : '');

  // reorder the groups (if needed)
  resized = this._orderGroups() || resized;

  // check whether zoomed (in that case we need to re-stack everything)
  // TODO: would be nicer to get this as a trigger from Range
  var visibleInterval = range.end - range.start;
  var zoomed = (visibleInterval != this.lastVisibleInterval) || (this.props.width != this.props.lastWidth);
  if (zoomed) this.stackDirty = true;
  this.lastVisibleInterval = visibleInterval;
  this.props.lastWidth = this.props.width;

  var restack = this.stackDirty;
  var firstGroup = this._firstGroup();
  var firstMargin = {
    item: margin.item,
    axis: margin.axis
  };
  var nonFirstMargin = {
    item: margin.item,
    axis: margin.item.vertical / 2
  };
  var height = 0;
  var minHeight = margin.axis + margin.item.vertical;

  // redraw the background group
  this.groups[BACKGROUND].redraw(range, nonFirstMargin, restack);

  // redraw all regular groups
  util.forEach(this.groups, function (group) {
    var groupMargin = (group == firstGroup) ? firstMargin : nonFirstMargin;
    var groupResized = group.redraw(range, groupMargin, restack);
    resized = groupResized || resized;
    height += group.height;
  });
  height = Math.max(height, minHeight);
  this.stackDirty = false;

  // update frame height
  frame.style.height  = asSize(height);

  // calculate actual size
  this.props.width = frame.offsetWidth;
  this.props.height = height;

  // reposition axis
  this.dom.axis.style.top = asSize((orientation == 'top') ?
      (this.body.domProps.top.height + this.body.domProps.border.top) :
      (this.body.domProps.top.height + this.body.domProps.centerContainer.height));
  this.dom.axis.style.left = '0';

  // check if this component is resized
  resized = this._isResized() || resized;

  return resized;
};

/**
 * Get the first group, aligned with the axis
 * @return {Group | null} firstGroup
 * @private
 */
ItemSet.prototype._firstGroup = function() {
  var firstGroupIndex = (this.options.orientation == 'top') ? 0 : (this.groupIds.length - 1);
  var firstGroupId = this.groupIds[firstGroupIndex];
  var firstGroup = this.groups[firstGroupId] || this.groups[UNGROUPED];

  return firstGroup || null;
};

/**
 * Create or delete the group holding all ungrouped items. This group is used when
 * there are no groups specified.
 * @protected
 */
ItemSet.prototype._updateUngrouped = function() {
  var ungrouped = this.groups[UNGROUPED];
  var background = this.groups[BACKGROUND];
  var item, itemId;

  if (this.groupsData) {
    // remove the group holding all ungrouped items
    if (ungrouped) {
      ungrouped.hide();
      delete this.groups[UNGROUPED];

      for (itemId in this.items) {
        if (this.items.hasOwnProperty(itemId)) {
          item = this.items[itemId];
          item.parent && item.parent.remove(item);
          var groupId = this._getGroupId(item.data);
          var group = this.groups[groupId];
          group && group.add(item) || item.hide();
        }
      }
    }
  }
  else {
    // create a group holding all (unfiltered) items
    if (!ungrouped) {
      var id = null;
      var data = null;
      ungrouped = new Group(id, data, this);
      this.groups[UNGROUPED] = ungrouped;

      for (itemId in this.items) {
        if (this.items.hasOwnProperty(itemId)) {
          item = this.items[itemId];
          ungrouped.add(item);
        }
      }

      ungrouped.show();
    }
  }
};

/**
 * Get the element for the labelset
 * @return {HTMLElement} labelSet
 */
ItemSet.prototype.getLabelSet = function() {
  return this.dom.labelSet;
};

/**
 * Set items
 * @param {vis.DataSet | null} items
 */
ItemSet.prototype.setItems = function(items) {
  var me = this,
      ids,
      oldItemsData = this.itemsData;

  // replace the dataset
  if (!items) {
    this.itemsData = null;
  }
  else if (items instanceof DataSet || items instanceof DataView) {
    this.itemsData = items;
  }
  else {
    throw new TypeError('Data must be an instance of DataSet or DataView');
  }

  if (oldItemsData) {
    // unsubscribe from old dataset
    util.forEach(this.itemListeners, function (callback, event) {
      oldItemsData.off(event, callback);
    });

    // remove all drawn items
    ids = oldItemsData.getIds();
    this._onRemove(ids);
  }

  if (this.itemsData) {
    // subscribe to new dataset
    var id = this.id;
    util.forEach(this.itemListeners, function (callback, event) {
      me.itemsData.on(event, callback, id);
    });

    // add all new items
    ids = this.itemsData.getIds();
    this._onAdd(ids);

    // update the group holding all ungrouped items
    this._updateUngrouped();
  }
};

/**
 * Get the current items
 * @returns {vis.DataSet | null}
 */
ItemSet.prototype.getItems = function() {
  return this.itemsData;
};

/**
 * Set groups
 * @param {vis.DataSet} groups
 */
ItemSet.prototype.setGroups = function(groups) {
  var me = this,
      ids;

  // unsubscribe from current dataset
  if (this.groupsData) {
    util.forEach(this.groupListeners, function (callback, event) {
      me.groupsData.unsubscribe(event, callback);
    });

    // remove all drawn groups
    ids = this.groupsData.getIds();
    this.groupsData = null;
    this._onRemoveGroups(ids); // note: this will cause a redraw
  }

  // replace the dataset
  if (!groups) {
    this.groupsData = null;
  }
  else if (groups instanceof DataSet || groups instanceof DataView) {
    this.groupsData = groups;
  }
  else {
    throw new TypeError('Data must be an instance of DataSet or DataView');
  }

  if (this.groupsData) {
    // subscribe to new dataset
    var id = this.id;
    util.forEach(this.groupListeners, function (callback, event) {
      me.groupsData.on(event, callback, id);
    });

    // draw all ms
    ids = this.groupsData.getIds();
    this._onAddGroups(ids);
  }

  // update the group holding all ungrouped items
  this._updateUngrouped();

  // update the order of all items in each group
  this._order();

  this.body.emitter.emit('change', {queue: true});
};

/**
 * Get the current groups
 * @returns {vis.DataSet | null} groups
 */
ItemSet.prototype.getGroups = function() {
  return this.groupsData;
};

/**
 * Remove an item by its id
 * @param {String | Number} id
 */
ItemSet.prototype.removeItem = function(id) {
  var item = this.itemsData.get(id),
      dataset = this.itemsData.getDataSet();

  if (item) {
    // confirm deletion
    this.options.onRemove(item, function (item) {
      if (item) {
        // remove by id here, it is possible that an item has no id defined
        // itself, so better not delete by the item itself
        dataset.remove(id);
      }
    });
  }
};

/**
 * Get the time of an item based on it's data and options.type
 * @param {Object} itemData
 * @returns {string} Returns the type
 * @private
 */
ItemSet.prototype._getType = function (itemData) {
  return itemData.type || this.options.type || (itemData.end ? 'range' : 'box');
};


/**
 * Get the group id for an item
 * @param {Object} itemData
 * @returns {string} Returns the groupId
 * @private
 */
ItemSet.prototype._getGroupId = function (itemData) {
  var type = this._getType(itemData);
  if (type == 'background' && itemData.group == undefined) {
   return BACKGROUND;
  }
  else {
    return this.groupsData ? itemData.group : UNGROUPED;
  }
};

/**
 * Handle updated items
 * @param {Number[]} ids
 * @protected
 */
ItemSet.prototype._onUpdate = function(ids) {
  var me = this;

  ids.forEach(function (id) {
    var itemData = me.itemsData.get(id, me.itemOptions);
    var item = me.items[id];
    var type = me._getType(itemData);

    var constructor = ItemSet.types[type];

    if (item) {
      // update item
      if (!constructor || !(item instanceof constructor)) {
        // item type has changed, delete the item and recreate it
        me._removeItem(item);
        item = null;
      }
      else {
        me._updateItem(item, itemData);
      }
    }

    if (!item) {
      // create item
      if (constructor) {
        item = new constructor(itemData, me.conversion, me.options);
        item.id = id; // TODO: not so nice setting id afterwards
        me._addItem(item);
      }
      else if (type == 'rangeoverflow') {
        // TODO: deprecated since version 2.1.0 (or 3.0.0?). cleanup some day
        throw new TypeError('Item type "rangeoverflow" is deprecated. Use css styling instead: ' +
            '.vis.timeline .item.range .content {overflow: visible;}');
      }
      else {
        throw new TypeError('Unknown item type "' + type + '"');
      }
    }
  });

  this._order();
  this.stackDirty = true; // force re-stacking of all items next redraw
  this.body.emitter.emit('change', {queue: true});
};

/**
 * Handle added items
 * @param {Number[]} ids
 * @protected
 */
ItemSet.prototype._onAdd = ItemSet.prototype._onUpdate;

/**
 * Handle removed items
 * @param {Number[]} ids
 * @protected
 */
ItemSet.prototype._onRemove = function(ids) {
  var count = 0;
  var me = this;
  ids.forEach(function (id) {
    var item = me.items[id];
    if (item) {
      count++;
      me._removeItem(item);
    }
  });

  if (count) {
    // update order
    this._order();
    this.stackDirty = true; // force re-stacking of all items next redraw
    this.body.emitter.emit('change', {queue: true});
  }
};

/**
 * Update the order of item in all groups
 * @private
 */
ItemSet.prototype._order = function() {
  // reorder the items in all groups
  // TODO: optimization: only reorder groups affected by the changed items
  util.forEach(this.groups, function (group) {
    group.order();
  });
};

/**
 * Handle updated groups
 * @param {Number[]} ids
 * @private
 */
ItemSet.prototype._onUpdateGroups = function(ids) {
  this._onAddGroups(ids);
};

/**
 * Handle changed groups (added or updated)
 * @param {Number[]} ids
 * @private
 */
ItemSet.prototype._onAddGroups = function(ids) {
  var me = this;

  ids.forEach(function (id) {
    var groupData = me.groupsData.get(id);
    var group = me.groups[id];

    if (!group) {
      // check for reserved ids
      if (id == UNGROUPED || id == BACKGROUND) {
        throw new Error('Illegal group id. ' + id + ' is a reserved id.');
      }

      var groupOptions = Object.create(me.options);
      util.extend(groupOptions, {
        height: null
      });

      group = new Group(id, groupData, me);
      me.groups[id] = group;

      // add items with this groupId to the new group
      for (var itemId in me.items) {
        if (me.items.hasOwnProperty(itemId)) {
          var item = me.items[itemId];
          if (item.data.group == id) {
            group.add(item);
          }
        }
      }

      group.order();
      group.show();
    }
    else {
      // update group
      group.setData(groupData);
    }
  });

  this.body.emitter.emit('change', {queue: true});
};

/**
 * Handle removed groups
 * @param {Number[]} ids
 * @private
 */
ItemSet.prototype._onRemoveGroups = function(ids) {
  var groups = this.groups;
  ids.forEach(function (id) {
    var group = groups[id];

    if (group) {
      group.hide();
      delete groups[id];
    }
  });

  this.markDirty();

  this.body.emitter.emit('change', {queue: true});
};

/**
 * Reorder the groups if needed
 * @return {boolean} changed
 * @private
 */
ItemSet.prototype._orderGroups = function () {
  if (this.groupsData) {
    // reorder the groups
    var groupIds = this.groupsData.getIds({
      order: this.options.groupOrder
    });

    var changed = !util.equalArray(groupIds, this.groupIds);
    if (changed) {
      // hide all groups, removes them from the DOM
      var groups = this.groups;
      groupIds.forEach(function (groupId) {
        groups[groupId].hide();
      });

      // show the groups again, attach them to the DOM in correct order
      groupIds.forEach(function (groupId) {
        groups[groupId].show();
      });

      this.groupIds = groupIds;
    }

    return changed;
  }
  else {
    return false;
  }
};

/**
 * Add a new item
 * @param {Item} item
 * @private
 */
ItemSet.prototype._addItem = function(item) {
  this.items[item.id] = item;

  // add to group
  var groupId = this._getGroupId(item.data);
  var group = this.groups[groupId];
  if (group) group.add(item);
};

/**
 * Update an existing item
 * @param {Item} item
 * @param {Object} itemData
 * @private
 */
ItemSet.prototype._updateItem = function(item, itemData) {
  var oldGroupId = item.data.group;

  // update the items data (will redraw the item when displayed)
  item.setData(itemData);

  // update group
  if (oldGroupId != item.data.group) {
    var oldGroup = this.groups[oldGroupId];
    if (oldGroup) oldGroup.remove(item);

    var groupId = this._getGroupId(item.data);
    var group = this.groups[groupId];
    if (group) group.add(item);
  }
};

/**
 * Delete an item from the ItemSet: remove it from the DOM, from the map
 * with items, and from the map with visible items, and from the selection
 * @param {Item} item
 * @private
 */
ItemSet.prototype._removeItem = function(item) {
  // remove from DOM
  item.hide();

  // remove from items
  delete this.items[item.id];

  // remove from selection
  var index = this.selection.indexOf(item.id);
  if (index != -1) this.selection.splice(index, 1);

  // remove from group
  item.parent && item.parent.remove(item);
};

/**
 * Create an array containing all items being a range (having an end date)
 * @param array
 * @returns {Array}
 * @private
 */
ItemSet.prototype._constructByEndArray = function(array) {
  var endArray = [];

  for (var i = 0; i < array.length; i++) {
    if (array[i] instanceof RangeItem) {
      endArray.push(array[i]);
    }
  }
  return endArray;
};

/**
 * Register the clicked item on touch, before dragStart is initiated.
 *
 * dragStart is initiated from a mousemove event, which can have left the item
 * already resulting in an item == null
 *
 * @param {Event} event
 * @private
 */
ItemSet.prototype._onTouch = function (event) {
  // store the touched item, used in _onDragStart
  this.touchParams.item = this.itemFromTarget(event);
};

/**
 * Start dragging the selected events
 * @param {Event} event
 * @private
 */
ItemSet.prototype._onDragStart = function (event) {
  if (!this.options.editable.updateTime && !this.options.editable.updateGroup) {
    return;
  }

  var item = this.touchParams.item || null;
  var me = this;
  var props;

  if (item && item.selected) {
    var dragLeftItem = event.target.dragLeftItem;
    var dragRightItem = event.target.dragRightItem;

    if (dragLeftItem) {
      props = {
        item: dragLeftItem,
        initialX: event.gesture.center.pageX,
        dragLeft:  true,
        data: util.extend({}, item.data) // clone the items data
      };

      this.touchParams.itemProps = [props];
    }
    else if (dragRightItem) {
      props = {
        item: dragRightItem,
        initialX: event.gesture.center.pageX,
        dragRight: true,
        data: util.extend({}, item.data) // clone the items data
      };

      this.touchParams.itemProps = [props];
    }
    else {
      this.touchParams.itemProps = this.getSelection().map(function (id) {
        var item = me.items[id];
        var props = {
          item: item,
          initialX: event.gesture.center.pageX,
          data: util.extend({}, item.data) // clone the items data
        };

        return props;
      });
    }

    event.stopPropagation();
  }
  else if (this.options.editable.add && event.gesture.srcEvent.ctrlKey) {
    // create a new range item when dragging with ctrl key down
    this._onDragStartAddItem(event);
  }
};

/**
 * Start creating a new range item by dragging.
 * @param {Event} event
 * @private
 */
ItemSet.prototype._onDragStartAddItem = function (event) {
  var snap = this.options.snap || null;
  var xAbs = util.getAbsoluteLeft(this.dom.frame);
  var x = event.gesture.center.pageX - xAbs - 10;  // minus 10 to compensate for the drag starting as soon as you've moved 10px
  var time = this.body.util.toTime(x);
  var scale = this.body.util.getScale();
  var step = this.body.util.getStep();
  var start = snap ? snap(time, scale, step) : start;
  var end = start;

  var itemData = {
    type: 'range',
    start: start,
    end: end,
    content: 'new item'
  };

  var id = util.randomUUID();
  itemData[this.itemsData._fieldId] = id;

  var group = this.groupFromTarget(event);
  if (group) {
    itemData.group = group.groupId;
  }

  var newItem = new RangeItem(itemData, this.conversion, this.options);
  newItem.id = id; // TODO: not so nice setting id afterwards
  newItem.data = itemData;
  this._addItem(newItem);

  var props = {
    item: newItem,
    dragRight: true,
    initialX: event.gesture.center.pageX,
    data: util.extend({}, itemData)
  };
  this.touchParams.itemProps = [props];

  event.stopPropagation();
};

/**
 * Drag selected items
 * @param {Event} event
 * @private
 */
ItemSet.prototype._onDrag = function (event) {
  event.preventDefault();

  if (this.touchParams.itemProps) {
    event.stopPropagation();

    var me = this;
    var snap = this.options.snap || null;
    var xOffset = this.body.dom.root.offsetLeft + this.body.domProps.left.width;
    var scale = this.body.util.getScale();
    var step = this.body.util.getStep();

    // move
    this.touchParams.itemProps.forEach(function (props) {
      var current = me.body.util.toTime(event.gesture.center.pageX - xOffset);
      var initial = me.body.util.toTime(props.initialX - xOffset);
      var offset = current - initial;

      var itemData = util.extend({}, props.item.data); // clone the data

      if (me.options.editable.updateTime) {
        if (props.dragLeft) {
          // drag left side of a range item
          if (itemData.start != undefined) {
            var initialStart = util.convert(props.data.start, 'Date');
            var start = new Date(initialStart.valueOf() + offset);
            itemData.start = snap ? snap(start, scale, step) : start;
          }
        }
        else if (props.dragRight) {
          // drag right side of a range item
          if (itemData.end != undefined) {
            var initialEnd = util.convert(props.data.end, 'Date');
            var end = new Date(initialEnd.valueOf() + offset);
            itemData.end = snap ? snap(end, scale, step) : end;
          }
        }
        else {
          // drag both start and end
          if (itemData.start != undefined) {
            var initialStart = util.convert(props.data.start, 'Date').valueOf();
            var start = new Date(initialStart + offset);

            if (itemData.end != undefined) {
              var initialEnd = util.convert(props.data.end, 'Date');
              var duration  = initialEnd.valueOf() - initialStart.valueOf();

              itemData.start = snap ? snap(start, scale, step) : start;
              itemData.end   = new Date(itemData.start.valueOf() + duration);
            }
            else {
              itemData.start = snap ? snap(start, scale, step) : start;
            }
          }
        }
      }

      if (me.options.editable.updateGroup && (!props.dragLeft && !props.dragRight)) {
        if (itemData.group != undefined) {
          // drag from one group to another
          var group = me.groupFromTarget(event);
          if (group) {
            itemData.group = group.groupId;
          }
        }
      }

      // confirm moving the item
      me.options.onMoving(itemData, function (itemData) {
        if (itemData) {
          props.item.setData(itemData);
        }
      });
    });

    this.stackDirty = true; // force re-stacking of all items next redraw
    this.body.emitter.emit('change');
  }
};

/**
 * Move an item to another group
 * @param {Item} item
 * @param {String | Number} groupId
 * @private
 */
ItemSet.prototype._moveToGroup = function(item, groupId) {
  var group = this.groups[groupId];
  if (group && group.groupId != item.data.group) {
    var oldGroup = item.parent;
    oldGroup.remove(item);
    oldGroup.order();
    group.add(item);
    group.order();

    item.data.group = group.groupId;
  }
};

/**
 * End of dragging selected items
 * @param {Event} event
 * @private
 */
ItemSet.prototype._onDragEnd = function (event) {
  event.preventDefault();

  if (this.touchParams.itemProps) {
    event.stopPropagation();

    // prepare a change set for the changed items
    var changes = [];
    var me = this;
    var dataset = this.itemsData.getDataSet();

    var itemProps = this.touchParams.itemProps ;
    this.touchParams.itemProps = null;
    itemProps.forEach(function (props) {
      var id = props.item.id;
      var exists = me.itemsData.get(id, me.itemOptions) != null;

      if (!exists) {
        // add a new item
        me.options.onAdd(props.item.data, function (itemData) {
          me._removeItem(props.item); // remove temporary item
          if (itemData) {
            me.itemsData.getDataSet().add(itemData);
          }

          // force re-stacking of all items next redraw
          me.stackDirty = true;
          me.body.emitter.emit('change');
        });
      }
      else {
        // update existing item
        var itemData = util.extend({}, props.item.data); // clone the data
        me.options.onMove(itemData, function (itemData) {
          if (itemData) {
            // apply changes
            itemData[dataset._fieldId] = id; // ensure the item contains its id (can be undefined)
            changes.push(itemData);
          }
          else {
            // restore original values
            props.item.setData(props.data);

            me.stackDirty = true; // force re-stacking of all items next redraw
            me.body.emitter.emit('change');
          }
        });
      }
    });

    // apply the changes to the data (if there are changes)
    if (changes.length) {
      dataset.update(changes);
    }
  }
};

/**
 * Handle selecting/deselecting an item when tapping it
 * @param {Event} event
 * @private
 */
ItemSet.prototype._onSelectItem = function (event) {
  if (!this.options.selectable) return;

  var ctrlKey  = event.gesture.srcEvent && event.gesture.srcEvent.ctrlKey;
  var shiftKey = event.gesture.srcEvent && event.gesture.srcEvent.shiftKey;
  if (ctrlKey || shiftKey) {
    this._onMultiSelectItem(event);
    return;
  }

  var oldSelection = this.getSelection();

  var item = this.itemFromTarget(event);
  var selection = item ? [item.id] : [];
  this.setSelection(selection);

  var newSelection = this.getSelection();

  // emit a select event,
  // except when old selection is empty and new selection is still empty
  if (newSelection.length > 0 || oldSelection.length > 0) {
    this.body.emitter.emit('select', {
      items: newSelection,
      event: event
    });
  }
};

/**
 * Handle creation and updates of an item on double tap
 * @param event
 * @private
 */
ItemSet.prototype._onAddItem = function (event) {
  if (!this.options.selectable) return;
  if (!this.options.editable.add) return;

  var me = this,
      snap = this.options.snap || null,
      item = this.itemFromTarget(event);

  if (item) {
    // update item

    // execute async handler to update the item (or cancel it)
    var itemData = me.itemsData.get(item.id); // get a clone of the data from the dataset
    this.options.onUpdate(itemData, function (itemData) {
      if (itemData) {
        me.itemsData.getDataSet().update(itemData);
      }
    });
  }
  else {
    // add item
    var xAbs = util.getAbsoluteLeft(this.dom.frame);
    var x = event.gesture.center.pageX - xAbs;
    var start = this.body.util.toTime(x);
    var scale = this.body.util.getScale();
    var step = this.body.util.getStep();

    var newItem = {
      start: snap ? snap(start, scale, step) : start,
      content: 'new item'
    };

    // when default type is a range, add a default end date to the new item
    if (this.options.type === 'range') {
      var end = this.body.util.toTime(x + this.props.width / 5);
      newItem.end = snap ? snap(end, scale, step) : end;
    }

    newItem[this.itemsData._fieldId] = util.randomUUID();

    var group = this.groupFromTarget(event);
    if (group) {
      newItem.group = group.groupId;
    }

    // execute async handler to customize (or cancel) adding an item
    this.options.onAdd(newItem, function (item) {
      if (item) {
        me.itemsData.getDataSet().add(item);
        // TODO: need to trigger a redraw?
      }
    });
  }
};

/**
 * Handle selecting/deselecting multiple items when holding an item
 * @param {Event} event
 * @private
 */
ItemSet.prototype._onMultiSelectItem = function (event) {
  if (!this.options.selectable) return;

  var selection,
      item = this.itemFromTarget(event);

  if (item) {
    // multi select items
    selection = this.getSelection(); // current selection

    var shiftKey = event.gesture.touches[0] && event.gesture.touches[0].shiftKey || false;
    if (shiftKey) {
      // select all items between the old selection and the tapped item

      // determine the selection range
      selection.push(item.id);
      var range = ItemSet._getItemRange(this.itemsData.get(selection, this.itemOptions));

      // select all items within the selection range
      selection = [];
      for (var id in this.items) {
        if (this.items.hasOwnProperty(id)) {
          var _item = this.items[id];
          var start = _item.data.start;
          var end = (_item.data.end !== undefined) ? _item.data.end : start;

          if (start >= range.min &&
              end <= range.max &&
              !(_item instanceof BackgroundItem)) {
            selection.push(_item.id); // do not use id but item.id, id itself is stringified
          }
        }
      }
    }
    else {
      // add/remove this item from the current selection
      var index = selection.indexOf(item.id);
      if (index == -1) {
        // item is not yet selected -> select it
        selection.push(item.id);
      }
      else {
        // item is already selected -> deselect it
        selection.splice(index, 1);
      }
    }

    this.setSelection(selection);

    this.body.emitter.emit('select', {
      items: this.getSelection()
    });
  }
};

/**
 * Calculate the time range of a list of items
 * @param {Array.<Object>} itemsData
 * @return {{min: Date, max: Date}} Returns the range of the provided items
 * @private
 */
ItemSet._getItemRange = function(itemsData) {
  var max = null;
  var min = null;

  itemsData.forEach(function (data) {
    if (min == null || data.start < min) {
      min = data.start;
    }

    if (data.end != undefined) {
      if (max == null || data.end > max) {
        max = data.end;
      }
    }
    else {
      if (max == null || data.start > max) {
        max = data.start;
      }
    }
  });

  return {
    min: min,
    max: max
  }
};

/**
 * Find an item from an event target:
 * searches for the attribute 'timeline-item' in the event target's element tree
 * @param {Event} event
 * @return {Item | null} item
 */
ItemSet.prototype.itemFromTarget = function(event) {
  var target = event.target;
  while (target) {
    if (target.hasOwnProperty('timeline-item')) {
      return target['timeline-item'];
    }
    target = target.parentNode;
  }

  return null;
};

/**
 * Find the Group from an event target:
 * searches for the attribute 'timeline-group' in the event target's element tree
 * @param {Event} event
 * @return {Group | null} group
 */
ItemSet.prototype.groupFromTarget = function(event) {
  var pageY = event.gesture ? event.gesture.center.pageY : event.pageY;
  for (var i = 0; i < this.groupIds.length; i++) {
    var groupId = this.groupIds[i];
    var group = this.groups[groupId];
    var foreground = group.dom.foreground;
    var top = util.getAbsoluteTop(foreground);
    if (pageY > top && pageY < top + foreground.offsetHeight) {
      return group;
    }

    if (this.options.orientation === 'top') {
      if (i === this.groupIds.length - 1 && pageY > top) {
        return group;
      }
    }
    else {
      if (i === 0 && pageY < top + foreground.offset) {
        return group;
      }
    }
  }

  return null;
};

/**
 * Find the ItemSet from an event target:
 * searches for the attribute 'timeline-itemset' in the event target's element tree
 * @param {Event} event
 * @return {ItemSet | null} item
 */
ItemSet.itemSetFromTarget = function(event) {
  var target = event.target;
  while (target) {
    if (target.hasOwnProperty('timeline-itemset')) {
      return target['timeline-itemset'];
    }
    target = target.parentNode;
  }

  return null;
};

module.exports = ItemSet;

},{"../../DataSet":2,"../../DataView":3,"../../module/hammer":6,"../../util":28,"../TimeStep":13,"./BackgroundGroup":15,"./Component":16,"./Group":19,"./item/BackgroundItem":22,"./item/BoxItem":23,"./item/PointItem":25,"./item/RangeItem":26}],21:[function(require,module,exports){
var util = require('../../util');
var Component = require('./Component');
var TimeStep = require('../TimeStep');
var DateUtil = require('../DateUtil');
var moment = require('../../module/moment');

/**
 * A horizontal time axis
 * @param {{dom: Object, domProps: Object, emitter: Emitter, range: Range}} body
 * @param {Object} [options]        See TimeAxis.setOptions for the available
 *                                  options.
 * @constructor TimeAxis
 * @extends Component
 */
function TimeAxis (body, options) {
  this.dom = {
    foreground: null,
    lines: [],
    majorTexts: [],
    minorTexts: [],
    redundant: {
      lines: [],
      majorTexts: [],
      minorTexts: []
    }
  };
  this.props = {
    range: {
      start: 0,
      end: 0,
      minimumStep: 0
    },
    lineTop: 0
  };

  this.defaultOptions = {
    orientation: 'bottom',  // axis orientation: 'top' or 'bottom'
    showMinorLabels: true,
    showMajorLabels: true,
    format: null,
    timeAxis: null
  };
  this.options = util.extend({}, this.defaultOptions);

  this.body = body;

  // create the HTML DOM
  this._create();

  this.setOptions(options);
}

TimeAxis.prototype = new Component();

/**
 * Set options for the TimeAxis.
 * Parameters will be merged in current options.
 * @param {Object} options  Available options:
 *                          {string} [orientation]
 *                          {boolean} [showMinorLabels]
 *                          {boolean} [showMajorLabels]
 */
TimeAxis.prototype.setOptions = function(options) {
  if (options) {
    // copy all options that we know
    util.selectiveExtend([
      'showMinorLabels',
      'showMajorLabels',
      'hiddenDates',
      'format',
      'timeAxis'
    ], this.options, options);

    if ('orientation' in options) {
      if (typeof options.orientation === 'string') {
        this.options.orientation = options.orientation;
      }
      else if (typeof options.orientation === 'object' && 'axis' in options.orientation) {
        this.options.orientation = options.orientation.axis;
      }
    }

    // apply locale to moment.js
    // TODO: not so nice, this is applied globally to moment.js
    if ('locale' in options) {
      if (typeof moment.locale === 'function') {
        // moment.js 2.8.1+
        moment.locale(options.locale);
      }
      else {
        moment.lang(options.locale);
      }
    }
  }
};

/**
 * Create the HTML DOM for the TimeAxis
 */
TimeAxis.prototype._create = function() {
  this.dom.foreground = document.createElement('div');
  this.dom.background = document.createElement('div');

  this.dom.foreground.className = 'timeaxis foreground';
  this.dom.background.className = 'timeaxis background';
};

/**
 * Destroy the TimeAxis
 */
TimeAxis.prototype.destroy = function() {
  // remove from DOM
  if (this.dom.foreground.parentNode) {
    this.dom.foreground.parentNode.removeChild(this.dom.foreground);
  }
  if (this.dom.background.parentNode) {
    this.dom.background.parentNode.removeChild(this.dom.background);
  }

  this.body = null;
};

/**
 * Repaint the component
 * @return {boolean} Returns true if the component is resized
 */
TimeAxis.prototype.redraw = function () {
  var options = this.options;
  var props = this.props;
  var foreground = this.dom.foreground;
  var background = this.dom.background;

  // determine the correct parent DOM element (depending on option orientation)
  var parent = (options.orientation == 'top') ? this.body.dom.top : this.body.dom.bottom;
  var parentChanged = (foreground.parentNode !== parent);

  // calculate character width and height
  this._calculateCharSize();

  // TODO: recalculate sizes only needed when parent is resized or options is changed
  var showMinorLabels = this.options.showMinorLabels;
  var showMajorLabels = this.options.showMajorLabels;

  // determine the width and height of the elemens for the axis
  props.minorLabelHeight = showMinorLabels ? props.minorCharHeight : 0;
  props.majorLabelHeight = showMajorLabels ? props.majorCharHeight : 0;
  props.height = props.minorLabelHeight + props.majorLabelHeight;
  props.width = foreground.offsetWidth;

  props.minorLineHeight = this.body.domProps.root.height - props.majorLabelHeight -
      (options.orientation == 'top' ? this.body.domProps.bottom.height : this.body.domProps.top.height);
  props.minorLineWidth = 1; // TODO: really calculate width
  props.majorLineHeight = props.minorLineHeight + props.majorLabelHeight;
  props.majorLineWidth = 1; // TODO: really calculate width

  //  take foreground and background offline while updating (is almost twice as fast)
  var foregroundNextSibling = foreground.nextSibling;
  var backgroundNextSibling = background.nextSibling;
  foreground.parentNode && foreground.parentNode.removeChild(foreground);
  background.parentNode && background.parentNode.removeChild(background);

  foreground.style.height = this.props.height + 'px';

  this._repaintLabels();

  // put DOM online again (at the same place)
  if (foregroundNextSibling) {
    parent.insertBefore(foreground, foregroundNextSibling);
  }
  else {
    parent.appendChild(foreground)
  }
  if (backgroundNextSibling) {
    this.body.dom.backgroundVertical.insertBefore(background, backgroundNextSibling);
  }
  else {
    this.body.dom.backgroundVertical.appendChild(background)
  }

  return this._isResized() || parentChanged;
};

/**
 * Repaint major and minor text labels and vertical grid lines
 * @private
 */
TimeAxis.prototype._repaintLabels = function () {
  var orientation = this.options.orientation;

  // calculate range and step (step such that we have space for 7 characters per label)
  var start = util.convert(this.body.range.start, 'Number');
  var end = util.convert(this.body.range.end, 'Number');
  var timeLabelsize = this.body.util.toTime((this.props.minorCharWidth || 10) * 7).valueOf();
  var minimumStep = timeLabelsize - DateUtil.getHiddenDurationBefore(this.body.hiddenDates, this.body.range, timeLabelsize);
  minimumStep -= this.body.util.toTime(0).valueOf();

  var step = new TimeStep(new Date(start), new Date(end), minimumStep, this.body.hiddenDates);
  if (this.options.format) {
    step.setFormat(this.options.format);
  }
  if (this.options.timeAxis) {
    step.setScale(this.options.timeAxis);
  }
  this.step = step;

  // Move all DOM elements to a "redundant" list, where they
  // can be picked for re-use, and clear the lists with lines and texts.
  // At the end of the function _repaintLabels, left over elements will be cleaned up
  var dom = this.dom;
  dom.redundant.lines = dom.lines;
  dom.redundant.majorTexts = dom.majorTexts;
  dom.redundant.minorTexts = dom.minorTexts;
  dom.lines = [];
  dom.majorTexts = [];
  dom.minorTexts = [];

  var cur;
  var x = 0;
  var isMajor;
  var xPrev = 0;
  var width = 0;
  var prevLine;
  var xFirstMajorLabel = undefined;
  var max = 0;
  var className;

  step.first();
  while (step.hasNext() && max < 1000) {
    max++;

    cur = step.getCurrent();
    isMajor = step.isMajor();
    className = step.getClassName();

    xPrev = x;
    x = this.body.util.toScreen(cur);
    width = x - xPrev;
    if (prevLine) {
      prevLine.style.width = width + 'px';
    }

    if (this.options.showMinorLabels) {
      this._repaintMinorText(x, step.getLabelMinor(), orientation, className);
    }

    if (isMajor && this.options.showMajorLabels) {
      if (x > 0) {
        if (xFirstMajorLabel == undefined) {
          xFirstMajorLabel = x;
        }
        this._repaintMajorText(x, step.getLabelMajor(), orientation, className);
      }
      prevLine = this._repaintMajorLine(x, orientation, className);
    }
    else {
      prevLine = this._repaintMinorLine(x, orientation, className);
    }

    step.next();
  }

  // create a major label on the left when needed
  if (this.options.showMajorLabels) {
    var leftTime = this.body.util.toTime(0),
        leftText = step.getLabelMajor(leftTime),
        widthText = leftText.length * (this.props.majorCharWidth || 10) + 10; // upper bound estimation

    if (xFirstMajorLabel == undefined || widthText < xFirstMajorLabel) {
      this._repaintMajorText(0, leftText, orientation, className);
    }
  }

  // Cleanup leftover DOM elements from the redundant list
  util.forEach(this.dom.redundant, function (arr) {
    while (arr.length) {
      var elem = arr.pop();
      if (elem && elem.parentNode) {
        elem.parentNode.removeChild(elem);
      }
    }
  });
};

/**
 * Create a minor label for the axis at position x
 * @param {Number} x
 * @param {String} text
 * @param {String} orientation   "top" or "bottom" (default)
 * @param {String} className
 * @private
 */
TimeAxis.prototype._repaintMinorText = function (x, text, orientation, className) {
  // reuse redundant label
  var label = this.dom.redundant.minorTexts.shift();

  if (!label) {
    // create new label
    var content = document.createTextNode('');
    label = document.createElement('div');
    label.appendChild(content);
    this.dom.foreground.appendChild(label);
  }
  this.dom.minorTexts.push(label);

  label.childNodes[0].nodeValue = text;

  label.style.top = (orientation == 'top') ? (this.props.majorLabelHeight + 'px') : '0';
  label.style.left = x + 'px';
  label.className = 'text minor ' + className;
  //label.title = title;  // TODO: this is a heavy operation
};

/**
 * Create a Major label for the axis at position x
 * @param {Number} x
 * @param {String} text
 * @param {String} orientation   "top" or "bottom" (default)
 * @param {String} className
 * @private
 */
TimeAxis.prototype._repaintMajorText = function (x, text, orientation, className) {
  // reuse redundant label
  var label = this.dom.redundant.majorTexts.shift();

  if (!label) {
    // create label
    var content = document.createTextNode(text);
    label = document.createElement('div');
    label.appendChild(content);
    this.dom.foreground.appendChild(label);
  }
  this.dom.majorTexts.push(label);

  label.childNodes[0].nodeValue = text;
  label.className = 'text major ' + className;
  //label.title = title; // TODO: this is a heavy operation

  label.style.top = (orientation == 'top') ? '0' : (this.props.minorLabelHeight  + 'px');
  label.style.left = x + 'px';
};

/**
 * Create a minor line for the axis at position x
 * @param {Number} x
 * @param {String} orientation   "top" or "bottom" (default)
 * @param {String} className
 * @return {Element} Returns the created line
 * @private
 */
TimeAxis.prototype._repaintMinorLine = function (x, orientation, className) {
  // reuse redundant line
  var line = this.dom.redundant.lines.shift();
  if (!line) {
    // create vertical line
    line = document.createElement('div');
    this.dom.background.appendChild(line);
  }
  this.dom.lines.push(line);

  var props = this.props;
  if (orientation == 'top') {
    line.style.top = props.majorLabelHeight + 'px';
  }
  else {
    line.style.top = this.body.domProps.top.height + 'px';
  }
  line.style.height = props.minorLineHeight + 'px';
  line.style.left = (x - props.minorLineWidth / 2) + 'px';

  line.className = 'grid vertical minor ' + className;

  return line;
};

/**
 * Create a Major line for the axis at position x
 * @param {Number} x
 * @param {String} orientation   "top" or "bottom" (default)
 * @param {String} className
 * @return {Element} Returns the created line
 * @private
 */
TimeAxis.prototype._repaintMajorLine = function (x, orientation, className) {
  // reuse redundant line
  var line = this.dom.redundant.lines.shift();
  if (!line) {
    // create vertical line
    line = document.createElement('div');
    this.dom.background.appendChild(line);
  }
  this.dom.lines.push(line);

  var props = this.props;
  if (orientation == 'top') {
    line.style.top = '0';
  }
  else {
    line.style.top = this.body.domProps.top.height + 'px';
  }
  line.style.left = (x - props.majorLineWidth / 2) + 'px';
  line.style.height = props.majorLineHeight + 'px';

  line.className = 'grid vertical major ' + className;

  return line;
};

/**
 * Determine the size of text on the axis (both major and minor axis).
 * The size is calculated only once and then cached in this.props.
 * @private
 */
TimeAxis.prototype._calculateCharSize = function () {
  // Note: We calculate char size with every redraw. Size may change, for
  // example when any of the timelines parents had display:none for example.

  // determine the char width and height on the minor axis
  if (!this.dom.measureCharMinor) {
    this.dom.measureCharMinor = document.createElement('DIV');
    this.dom.measureCharMinor.className = 'text minor measure';
    this.dom.measureCharMinor.style.position = 'absolute';

    this.dom.measureCharMinor.appendChild(document.createTextNode('0'));
    this.dom.foreground.appendChild(this.dom.measureCharMinor);
  }
  this.props.minorCharHeight = this.dom.measureCharMinor.clientHeight;
  this.props.minorCharWidth = this.dom.measureCharMinor.clientWidth;

  // determine the char width and height on the major axis
  if (!this.dom.measureCharMajor) {
    this.dom.measureCharMajor = document.createElement('DIV');
    this.dom.measureCharMajor.className = 'text major measure';
    this.dom.measureCharMajor.style.position = 'absolute';

    this.dom.measureCharMajor.appendChild(document.createTextNode('0'));
    this.dom.foreground.appendChild(this.dom.measureCharMajor);
  }
  this.props.majorCharHeight = this.dom.measureCharMajor.clientHeight;
  this.props.majorCharWidth = this.dom.measureCharMajor.clientWidth;
};

module.exports = TimeAxis;

},{"../../module/moment":7,"../../util":28,"../DateUtil":10,"../TimeStep":13,"./Component":16}],22:[function(require,module,exports){
var Hammer = require('../../../module/hammer');
var Item = require('./Item');
var BackgroundGroup = require('../BackgroundGroup');
var RangeItem = require('./RangeItem');

/**
 * @constructor BackgroundItem
 * @extends Item
 * @param {Object} data             Object containing parameters start, end
 *                                  content, className.
 * @param {{toScreen: function, toTime: function}} conversion
 *                                  Conversion functions from time to screen and vice versa
 * @param {Object} [options]        Configuration options
 *                                  // TODO: describe options
 */
// TODO: implement support for the BackgroundItem just having a start, then being displayed as a sort of an annotation
function BackgroundItem (data, conversion, options) {
  this.props = {
    content: {
      width: 0
    }
  };
  this.overflow = false; // if contents can overflow (css styling), this flag is set to true

  // validate data
  if (data) {
    if (data.start == undefined) {
      throw new Error('Property "start" missing in item ' + data.id);
    }
    if (data.end == undefined) {
      throw new Error('Property "end" missing in item ' + data.id);
    }
  }

  Item.call(this, data, conversion, options);

  this.emptyContent = false;
}

BackgroundItem.prototype = new Item (null, null, null);

BackgroundItem.prototype.baseClassName = 'item background';
BackgroundItem.prototype.stack = false;

/**
 * Check whether this item is visible inside given range
 * @returns {{start: Number, end: Number}} range with a timestamp for start and end
 * @returns {boolean} True if visible
 */
BackgroundItem.prototype.isVisible = function(range) {
  // determine visibility
  return (this.data.start < range.end) && (this.data.end > range.start);
};

/**
 * Repaint the item
 */
BackgroundItem.prototype.redraw = function() {
  var dom = this.dom;
  if (!dom) {
    // create DOM
    this.dom = {};
    dom = this.dom;

    // background box
    dom.box = document.createElement('div');
    // className is updated in redraw()

    // contents box
    dom.content = document.createElement('div');
    dom.content.className = 'content';
    dom.box.appendChild(dom.content);

    // Note: we do NOT attach this item as attribute to the DOM,
    //       such that background items cannot be selected
    //dom.box['timeline-item'] = this;

    this.dirty = true;
  }

  // append DOM to parent DOM
  if (!this.parent) {
    throw new Error('Cannot redraw item: no parent attached');
  }
  if (!dom.box.parentNode) {
    var background = this.parent.dom.background;
    if (!background) {
      throw new Error('Cannot redraw item: parent has no background container element');
    }
    background.appendChild(dom.box);
  }
  this.displayed = true;

  // Update DOM when item is marked dirty. An item is marked dirty when:
  // - the item is not yet rendered
  // - the item's data is changed
  // - the item is selected/deselected
  if (this.dirty) {
    this._updateContents(this.dom.content);
    this._updateTitle(this.dom.content);
    this._updateDataAttributes(this.dom.content);
    this._updateStyle(this.dom.box);

    // update class
    var className = (this.data.className ? (' ' + this.data.className) : '') +
        (this.selected ? ' selected' : '');
    dom.box.className = this.baseClassName + className;

    // determine from css whether this box has overflow
    this.overflow = window.getComputedStyle(dom.content).overflow !== 'hidden';

    // recalculate size
    this.props.content.width = this.dom.content.offsetWidth;
    this.height = 0; // set height zero, so this item will be ignored when stacking items

    this.dirty = false;
  }
};

/**
 * Show the item in the DOM (when not already visible). The items DOM will
 * be created when needed.
 */
BackgroundItem.prototype.show = RangeItem.prototype.show;

/**
 * Hide the item from the DOM (when visible)
 * @return {Boolean} changed
 */
BackgroundItem.prototype.hide = RangeItem.prototype.hide;

/**
 * Reposition the item horizontally
 * @Override
 */
BackgroundItem.prototype.repositionX = RangeItem.prototype.repositionX;

/**
 * Reposition the item vertically
 * @Override
 */
BackgroundItem.prototype.repositionY = function(margin) {
  var onTop = this.options.orientation === 'top';
  this.dom.content.style.top = onTop ? '' : '0';
  this.dom.content.style.bottom = onTop ? '0' : '';
  var height;

  // special positioning for subgroups
  if (this.data.subgroup !== undefined) {
    // TODO: instead of calculating the top position of the subgroups here for every BackgroundItem, calculate the top of the subgroup once in Itemset

    var itemSubgroup = this.data.subgroup;
    var subgroups = this.parent.subgroups;
    var subgroupIndex = subgroups[itemSubgroup].index;
    // if the orientation is top, we need to take the difference in height into account.
    if (onTop == true) {
      // the first subgroup will have to account for the distance from the top to the first item.
      height = this.parent.subgroups[itemSubgroup].height + margin.item.vertical;
      height += subgroupIndex == 0 ? margin.axis - 0.5*margin.item.vertical : 0;
      var newTop = this.parent.top;
      for (var subgroup in subgroups) {
        if (subgroups.hasOwnProperty(subgroup)) {
          if (subgroups[subgroup].visible == true && subgroups[subgroup].index < subgroupIndex) {
            newTop += subgroups[subgroup].height + margin.item.vertical;
          }
        }
      }

      // the others will have to be offset downwards with this same distance.
      newTop += subgroupIndex != 0 ? margin.axis - 0.5 * margin.item.vertical : 0;
      this.dom.box.style.top = newTop + 'px';
      this.dom.box.style.bottom = '';
    }
    // and when the orientation is bottom:
    else {
      var newTop = this.parent.top;
      var totalHeight = 0;
      for (var subgroup in subgroups) {
        if (subgroups.hasOwnProperty(subgroup)) {
          if (subgroups[subgroup].visible == true) {
            var newHeight = subgroups[subgroup].height + margin.item.vertical;
            totalHeight += newHeight;
            if (subgroups[subgroup].index > subgroupIndex) {
              newTop += newHeight;
            }
          }
        }
      }
      height = this.parent.subgroups[itemSubgroup].height + margin.item.vertical;
      this.dom.box.style.top = (this.parent.height - totalHeight + newTop) + 'px';
      this.dom.box.style.bottom = '';
    }
  }
  // and in the case of no subgroups:
  else {
    // we want backgrounds with groups to only show in groups.
    if (this.parent instanceof BackgroundGroup) {
      // if the item is not in a group:
      height = Math.max(this.parent.height,
          this.parent.itemSet.body.domProps.center.height,
          this.parent.itemSet.body.domProps.centerContainer.height);
      this.dom.box.style.top = onTop ? '0' : '';
      this.dom.box.style.bottom = onTop ? '' : '0';
    }
    else {
      height = this.parent.height;
      // same alignment for items when orientation is top or bottom
      this.dom.box.style.top = this.parent.top + 'px';
      this.dom.box.style.bottom = '';
    }
  }
  this.dom.box.style.height = height + 'px';
};

module.exports = BackgroundItem;

},{"../../../module/hammer":6,"../BackgroundGroup":15,"./Item":24,"./RangeItem":26}],23:[function(require,module,exports){
var Item = require('./Item');
var util = require('../../../util');

/**
 * @constructor BoxItem
 * @extends Item
 * @param {Object} data             Object containing parameters start
 *                                  content, className.
 * @param {{toScreen: function, toTime: function}} conversion
 *                                  Conversion functions from time to screen and vice versa
 * @param {Object} [options]        Configuration options
 *                                  // TODO: describe available options
 */
function BoxItem (data, conversion, options) {
  this.props = {
    dot: {
      width: 0,
      height: 0
    },
    line: {
      width: 0,
      height: 0
    }
  };

  // validate data
  if (data) {
    if (data.start == undefined) {
      throw new Error('Property "start" missing in item ' + data);
    }
  }

  Item.call(this, data, conversion, options);
}

BoxItem.prototype = new Item (null, null, null);

/**
 * Check whether this item is visible inside given range
 * @returns {{start: Number, end: Number}} range with a timestamp for start and end
 * @returns {boolean} True if visible
 */
BoxItem.prototype.isVisible = function(range) {
  // determine visibility
  // TODO: account for the real width of the item. Right now we just add 1/4 to the window
  var interval = (range.end - range.start) / 4;
  return (this.data.start > range.start - interval) && (this.data.start < range.end + interval);
};

/**
 * Repaint the item
 */
BoxItem.prototype.redraw = function() {
  var dom = this.dom;
  if (!dom) {
    // create DOM
    this.dom = {};
    dom = this.dom;

    // create main box
    dom.box = document.createElement('DIV');

    // contents box (inside the background box). used for making margins
    dom.content = document.createElement('DIV');
    dom.content.className = 'content';
    dom.box.appendChild(dom.content);

    // line to axis
    dom.line = document.createElement('DIV');
    dom.line.className = 'line';

    // dot on axis
    dom.dot = document.createElement('DIV');
    dom.dot.className = 'dot';

    // attach this item as attribute
    dom.box['timeline-item'] = this;

    this.dirty = true;
  }

  // append DOM to parent DOM
  if (!this.parent) {
    throw new Error('Cannot redraw item: no parent attached');
  }
  if (!dom.box.parentNode) {
    var foreground = this.parent.dom.foreground;
    if (!foreground) throw new Error('Cannot redraw item: parent has no foreground container element');
    foreground.appendChild(dom.box);
  }
  if (!dom.line.parentNode) {
    var background = this.parent.dom.background;
    if (!background) throw new Error('Cannot redraw item: parent has no background container element');
    background.appendChild(dom.line);
  }
  if (!dom.dot.parentNode) {
    var axis = this.parent.dom.axis;
    if (!background) throw new Error('Cannot redraw item: parent has no axis container element');
    axis.appendChild(dom.dot);
  }
  this.displayed = true;

  // Update DOM when item is marked dirty. An item is marked dirty when:
  // - the item is not yet rendered
  // - the item's data is changed
  // - the item is selected/deselected
  if (this.dirty) {
    this._updateContents(this.dom.content);
    this._updateTitle(this.dom.box);
    this._updateDataAttributes(this.dom.box);
    this._updateStyle(this.dom.box);

    // update class
    var className = (this.data.className? ' ' + this.data.className : '') +
        (this.selected ? ' selected' : '');
    dom.box.className = 'item box' + className;
    dom.line.className = 'item line' + className;
    dom.dot.className  = 'item dot' + className;

    // recalculate size
    this.props.dot.height = dom.dot.offsetHeight;
    this.props.dot.width = dom.dot.offsetWidth;
    this.props.line.width = dom.line.offsetWidth;
    this.width = dom.box.offsetWidth;
    this.height = dom.box.offsetHeight;

    this.dirty = false;
  }

  this._repaintDeleteButton(dom.box);
};

/**
 * Show the item in the DOM (when not already displayed). The items DOM will
 * be created when needed.
 */
BoxItem.prototype.show = function() {
  if (!this.displayed) {
    this.redraw();
  }
};

/**
 * Hide the item from the DOM (when visible)
 */
BoxItem.prototype.hide = function() {
  if (this.displayed) {
    var dom = this.dom;

    if (dom.box.parentNode)   dom.box.parentNode.removeChild(dom.box);
    if (dom.line.parentNode)  dom.line.parentNode.removeChild(dom.line);
    if (dom.dot.parentNode)   dom.dot.parentNode.removeChild(dom.dot);

    this.displayed = false;
  }
};

/**
 * Reposition the item horizontally
 * @Override
 */
BoxItem.prototype.repositionX = function() {
  var start = this.conversion.toScreen(this.data.start);
  var align = this.options.align;
  var left;

  // calculate left position of the box
  if (align == 'right') {
    this.left = start - this.width;
  }
  else if (align == 'left') {
    this.left = start;
  }
  else {
    // default or 'center'
    this.left = start - this.width / 2;
  }

  // reposition box
  this.dom.box.style.left = this.left + 'px';

  // reposition line
  this.dom.line.style.left = (start - this.props.line.width / 2) + 'px';

  // reposition dot
  this.dom.dot.style.left = (start - this.props.dot.width / 2) + 'px';
};

/**
 * Reposition the item vertically
 * @Override
 */
BoxItem.prototype.repositionY = function() {
  var orientation = this.options.orientation;
  var box = this.dom.box;
  var line = this.dom.line;
  var dot = this.dom.dot;

  if (orientation == 'top') {
    box.style.top     = (this.top || 0) + 'px';

    line.style.top    = '0';
    line.style.height = (this.parent.top + this.top + 1) + 'px';
    line.style.bottom = '';
  }
  else { // orientation 'bottom'
    var itemSetHeight = this.parent.itemSet.props.height; // TODO: this is nasty
    var lineHeight = itemSetHeight - this.parent.top - this.parent.height + this.top;

    box.style.top     = (this.parent.height - this.top - this.height || 0) + 'px';
    line.style.top    = (itemSetHeight - lineHeight) + 'px';
    line.style.bottom = '0';
  }

  dot.style.top = (-this.props.dot.height / 2) + 'px';
};

module.exports = BoxItem;

},{"../../../util":28,"./Item":24}],24:[function(require,module,exports){
var Hammer = require('../../../module/hammer');
var util = require('../../../util');

/**
 * @constructor Item
 * @param {Object} data             Object containing (optional) parameters type,
 *                                  start, end, content, group, className.
 * @param {{toScreen: function, toTime: function}} conversion
 *                                  Conversion functions from time to screen and vice versa
 * @param {Object} options          Configuration options
 *                                  // TODO: describe available options
 */
function Item (data, conversion, options) {
  this.id = null;
  this.parent = null;
  this.data = data;
  this.dom = null;
  this.conversion = conversion || {};
  this.options = options || {};

  this.selected = false;
  this.displayed = false;
  this.dirty = true;

  this.top = null;
  this.left = null;
  this.width = null;
  this.height = null;
}

Item.prototype.stack = true;

/**
 * Select current item
 */
Item.prototype.select = function() {
  this.selected = true;
  this.dirty = true;
  if (this.displayed) this.redraw();
};

/**
 * Unselect current item
 */
Item.prototype.unselect = function() {
  this.selected = false;
  this.dirty = true;
  if (this.displayed) this.redraw();
};

/**
 * Set data for the item. Existing data will be updated. The id should not
 * be changed. When the item is displayed, it will be redrawn immediately.
 * @param {Object} data
 */
Item.prototype.setData = function(data) {
  var groupChanged = data.group != undefined && this.data.group != data.group;
  if (groupChanged) {
    this.parent.itemSet._moveToGroup(this, data.group);
  }

  this.data = data;
  this.dirty = true;
  if (this.displayed) this.redraw();
};

/**
 * Set a parent for the item
 * @param {ItemSet | Group} parent
 */
Item.prototype.setParent = function(parent) {
  if (this.displayed) {
    this.hide();
    this.parent = parent;
    if (this.parent) {
      this.show();
    }
  }
  else {
    this.parent = parent;
  }
};

/**
 * Check whether this item is visible inside given range
 * @returns {{start: Number, end: Number}} range with a timestamp for start and end
 * @returns {boolean} True if visible
 */
Item.prototype.isVisible = function(range) {
  // Should be implemented by Item implementations
  return false;
};

/**
 * Show the Item in the DOM (when not already visible)
 * @return {Boolean} changed
 */
Item.prototype.show = function() {
  return false;
};

/**
 * Hide the Item from the DOM (when visible)
 * @return {Boolean} changed
 */
Item.prototype.hide = function() {
  return false;
};

/**
 * Repaint the item
 */
Item.prototype.redraw = function() {
  // should be implemented by the item
};

/**
 * Reposition the Item horizontally
 */
Item.prototype.repositionX = function() {
  // should be implemented by the item
};

/**
 * Reposition the Item vertically
 */
Item.prototype.repositionY = function() {
  // should be implemented by the item
};

/**
 * Repaint a delete button on the top right of the item when the item is selected
 * @param {HTMLElement} anchor
 * @protected
 */
Item.prototype._repaintDeleteButton = function (anchor) {
  if (this.selected && this.options.editable.remove && !this.dom.deleteButton) {
    // create and show button
    var me = this;

    var deleteButton = document.createElement('div');
    deleteButton.className = 'delete';
    deleteButton.title = 'Delete this item';

    Hammer(deleteButton, {
      preventDefault: true
    }).on('tap', function (event) {
      event.preventDefault();
      event.stopPropagation();
      me.parent.removeFromDataSet(me);
    });

    anchor.appendChild(deleteButton);
    this.dom.deleteButton = deleteButton;
  }
  else if (!this.selected && this.dom.deleteButton) {
    // remove button
    if (this.dom.deleteButton.parentNode) {
      this.dom.deleteButton.parentNode.removeChild(this.dom.deleteButton);
    }
    this.dom.deleteButton = null;
  }
};

/**
 * Repaint an edit button on the top right of the item when the item is selected
 * @param {HTMLElement} anchor
 * @protected
 */
Item.prototype._repaintEditButton = function (anchor) {
  if (this.selected && this.options.editable.edit && !this.dom.editButton) {
    // create and show button
    var me = this;

    var editButton = document.createElement('div');
    editButton.className = 'edit';
    editButton.title = 'Edit this item';

    Hammer(editButton, {
      preventDefault: true
    }).on('tap', function (event) {
      me.parent.itemSet.body.emitter.emit('edit', {
        item: me.data
      });
      event.stopPropagation();
    });

    anchor.appendChild(editButton);
    this.dom.editButton = editButton;
  }
  else if (!this.selected && this.dom.editButton) {
    // remove button
    if (this.dom.editButton.parentNode) {
      this.dom.editButton.parentNode.removeChild(this.dom.editButton);
    }
    this.dom.editButton = null;
  }
};

/**
 * Repaint a show button on the top right of the item when the item is selected
 * @param {HTMLElement} anchor
 * @protected
 */
Item.prototype._repaintShowButton = function (anchor) {
  if (this.selected && this.options.editable.show && !this.dom.showButton) {
    // create and show button
    var me = this;

    var showButton = document.createElement('div');
    showButton.className = 'show';
    showButton.title = 'Show this item';

    Hammer(showButton, {
      preventDefault: true
    }).on('tap', function (event) {
      me.parent.itemSet.body.emitter.emit('show', {
        item: me.data
      });
      event.stopPropagation();
    });

    anchor.appendChild(showButton);
    this.dom.showButton = showButton;
  }
  else if (!this.selected && this.dom.showButton) {
    // remove button
    if (this.dom.showButton.parentNode) {
      this.dom.showButton.parentNode.removeChild(this.dom.showButton);
    }
    this.dom.showButton = null;
  }
};

/**
 * Set HTML contents for the item
 * @param {Element} element   HTML element to fill with the contents
 * @private
 */
Item.prototype._updateContents = function (element) {
  var content;
  if (this.options.template) {
    var itemData = this.parent.itemSet.itemsData.get(this.id); // get a clone of the data from the dataset
    content = this.options.template(itemData);
  }
  else {
    content = this.data.content;
  }

  if(content !== this.content) {
    // only replace the content when changed
    if (content instanceof Element) {
      element.innerHTML = '';
      element.appendChild(content);
    }
    else if (content != undefined) {
      element.innerHTML = content;
    }
    else {
      if (!(this.data.type == 'background' && this.data.content === undefined)) {
        throw new Error('Property "content" missing in item ' + this.id);
      }
    }

    this.content = content;
  }
};

/**
 * Set HTML contents for the item
 * @param {Element} element   HTML element to fill with the contents
 * @private
 */
Item.prototype._updateTitle = function (element) {
  if (this.data.title != null) {
    element.title = this.data.title || '';
  }
  else {
    element.removeAttribute('title');
  }
};

/**
 * Process dataAttributes timeline option and set as data- attributes on dom.content
 * @param {Element} element   HTML element to which the attributes will be attached
 * @private
 */
 Item.prototype._updateDataAttributes = function(element) {
  if (this.options.dataAttributes && this.options.dataAttributes.length > 0) {
    var attributes = [];

    if (Array.isArray(this.options.dataAttributes)) {
      attributes = this.options.dataAttributes;
    }
    else if (this.options.dataAttributes == 'all') {
      attributes = Object.keys(this.data);
    }
    else {
      return;
    }

    for (var i = 0; i < attributes.length; i++) {
      var name = attributes[i];
      var value = this.data[name];

      if (value != null) {
        element.setAttribute('data-' + name, value);
      }
      else {
        element.removeAttribute('data-' + name);
      }
    }
  }
};

/**
 * Update custom styles of the element
 * @param element
 * @private
 */
Item.prototype._updateStyle = function(element) {
  // remove old styles
  if (this.style) {
    util.removeCssText(element, this.style);
    this.style = null;
  }

  // append new styles
  if (this.data.style) {
    util.addCssText(element, this.data.style);
    this.style = this.data.style;
  }
};

module.exports = Item;

},{"../../../module/hammer":6,"../../../util":28}],25:[function(require,module,exports){
var Item = require('./Item');

/**
 * @constructor PointItem
 * @extends Item
 * @param {Object} data             Object containing parameters start
 *                                  content, className.
 * @param {{toScreen: function, toTime: function}} conversion
 *                                  Conversion functions from time to screen and vice versa
 * @param {Object} [options]        Configuration options
 *                                  // TODO: describe available options
 */
function PointItem (data, conversion, options) {
  this.props = {
    dot: {
      top: 0,
      width: 0,
      height: 0
    },
    content: {
      height: 0,
      marginLeft: 0
    }
  };

  // validate data
  if (data) {
    if (data.start == undefined) {
      throw new Error('Property "start" missing in item ' + data);
    }
  }

  Item.call(this, data, conversion, options);
}

PointItem.prototype = new Item (null, null, null);

/**
 * Check whether this item is visible inside given range
 * @returns {{start: Number, end: Number}} range with a timestamp for start and end
 * @returns {boolean} True if visible
 */
PointItem.prototype.isVisible = function(range) {
  // determine visibility
  // TODO: account for the real width of the item. Right now we just add 1/4 to the window
  var interval = (range.end - range.start) / 4;
  return (this.data.start > range.start - interval) && (this.data.start < range.end + interval);
};

/**
 * Repaint the item
 */
PointItem.prototype.redraw = function() {
  var dom = this.dom;
  if (!dom) {
    // create DOM
    this.dom = {};
    dom = this.dom;

    // background box
    dom.point = document.createElement('div');
    // className is updated in redraw()

    // contents box, right from the dot
    dom.content = document.createElement('div');
    dom.content.className = 'content';
    dom.point.appendChild(dom.content);

    // dot at start
    dom.dot = document.createElement('div');
    dom.point.appendChild(dom.dot);

    // attach this item as attribute
    dom.point['timeline-item'] = this;

    this.dirty = true;
  }

  // append DOM to parent DOM
  if (!this.parent) {
    throw new Error('Cannot redraw item: no parent attached');
  }
  if (!dom.point.parentNode) {
    var foreground = this.parent.dom.foreground;
    if (!foreground) {
      throw new Error('Cannot redraw item: parent has no foreground container element');
    }
    foreground.appendChild(dom.point);
  }
  this.displayed = true;

  // Update DOM when item is marked dirty. An item is marked dirty when:
  // - the item is not yet rendered
  // - the item's data is changed
  // - the item is selected/deselected
  if (this.dirty) {
    this._updateContents(this.dom.content);
    this._updateTitle(this.dom.point);
    this._updateDataAttributes(this.dom.point);
    this._updateStyle(this.dom.point);

    // update class
    var className = (this.data.className? ' ' + this.data.className : '') +
        (this.selected ? ' selected' : '');
    dom.point.className  = 'item point' + className;
    dom.dot.className  = 'item dot' + className;

    // recalculate size
    this.width = dom.point.offsetWidth;
    this.height = dom.point.offsetHeight;
    this.props.dot.width = dom.dot.offsetWidth;
    this.props.dot.height = dom.dot.offsetHeight;
    this.props.content.height = dom.content.offsetHeight;

    // resize contents
    dom.content.style.marginLeft = 2 * this.props.dot.width + 'px';
    //dom.content.style.marginRight = ... + 'px'; // TODO: margin right

    dom.dot.style.top = ((this.height - this.props.dot.height) / 2) + 'px';
    dom.dot.style.left = (this.props.dot.width / 2) + 'px';

    this.dirty = false;
  }

  this._repaintDeleteButton(dom.point);
};

/**
 * Show the item in the DOM (when not already visible). The items DOM will
 * be created when needed.
 */
PointItem.prototype.show = function() {
  if (!this.displayed) {
    this.redraw();
  }
};

/**
 * Hide the item from the DOM (when visible)
 */
PointItem.prototype.hide = function() {
  if (this.displayed) {
    if (this.dom.point.parentNode) {
      this.dom.point.parentNode.removeChild(this.dom.point);
    }

    this.displayed = false;
  }
};

/**
 * Reposition the item horizontally
 * @Override
 */
PointItem.prototype.repositionX = function() {
  var start = this.conversion.toScreen(this.data.start);

  this.left = start - this.props.dot.width;

  // reposition point
  this.dom.point.style.left = this.left + 'px';
};

/**
 * Reposition the item vertically
 * @Override
 */
PointItem.prototype.repositionY = function() {
  var orientation = this.options.orientation,
      point = this.dom.point;

  if (orientation == 'top') {
    point.style.top = this.top + 'px';
  }
  else {
    point.style.top = (this.parent.height - this.top - this.height) + 'px';
  }
};

module.exports = PointItem;

},{"./Item":24}],26:[function(require,module,exports){
var Hammer = require('../../../module/hammer');
var Item = require('./Item');

/**
 * @constructor RangeItem
 * @extends Item
 * @param {Object} data             Object containing parameters start, end
 *                                  content, className.
 * @param {{toScreen: function, toTime: function}} conversion
 *                                  Conversion functions from time to screen and vice versa
 * @param {Object} [options]        Configuration options
 *                                  // TODO: describe options
 */
function RangeItem (data, conversion, options) {
  this.props = {
    content: {
      width: 0
    }
  };
  this.overflow = false; // if contents can overflow (css styling), this flag is set to true

  // validate data
  if (data) {
    if (data.start == undefined) {
      throw new Error('Property "start" missing in item ' + data.id);
    }
    if (data.end == undefined) {
      throw new Error('Property "end" missing in item ' + data.id);
    }
  }

  Item.call(this, data, conversion, options);
}

RangeItem.prototype = new Item (null, null, null);

RangeItem.prototype.baseClassName = 'item range';

/**
 * Check whether this item is visible inside given range
 * @returns {{start: Number, end: Number}} range with a timestamp for start and end
 * @returns {boolean} True if visible
 */
RangeItem.prototype.isVisible = function(range) {
  // determine visibility
  return (this.data.start < range.end) && (this.data.end > range.start);
};

/**
 * Repaint the item
 */
RangeItem.prototype.redraw = function() {
  var dom = this.dom;
  if (!dom) {
    // create DOM
    this.dom = {};
    dom = this.dom;

      // background box
    dom.box = document.createElement('div');
    // className is updated in redraw()

    // contents box
    dom.content = document.createElement('div');
    dom.content.className = 'content';
    dom.box.appendChild(dom.content);

    // attach this item as attribute
    dom.box['timeline-item'] = this;

    this.dirty = true;
  }

  // append DOM to parent DOM
  if (!this.parent) {
    throw new Error('Cannot redraw item: no parent attached');
  }
  if (!dom.box.parentNode) {
    var foreground = this.parent.dom.foreground;
    if (!foreground) {
      throw new Error('Cannot redraw item: parent has no foreground container element');
    }
    foreground.appendChild(dom.box);
  }
  this.displayed = true;

  // Update DOM when item is marked dirty. An item is marked dirty when:
  // - the item is not yet rendered
  // - the item's data is changed
  // - the item is selected/deselected
  if (this.dirty) {
    this._updateContents(this.dom.content);
    this._updateTitle(this.dom.box);
    this._updateDataAttributes(this.dom.box);
    this._updateStyle(this.dom.box);

    // update class
    var className = (this.data.className ? (' ' + this.data.className) : '') +
        (this.selected ? ' selected' : '');
    dom.box.className = this.baseClassName + className;

    // determine from css whether this box has overflow
    this.overflow = window.getComputedStyle(dom.content).overflow !== 'hidden';

    // recalculate size
    // turn off max-width to be able to calculate the real width
    // this causes an extra browser repaint/reflow, but so be it
    this.dom.content.style.maxWidth = 'none';
    this.props.content.width = this.dom.content.offsetWidth;
    this.height = this.dom.box.offsetHeight;
    this.dom.content.style.maxWidth = '';

    this.dirty = false;
  }

  this._repaintDeleteButton(dom.box);
  this._repaintEditButton(dom.box);
  this._repaintShowButton(dom.box);
  this._repaintDragLeft();
  this._repaintDragRight();
};

/**
 * Show the item in the DOM (when not already visible). The items DOM will
 * be created when needed.
 */
RangeItem.prototype.show = function() {
  if (!this.displayed) {
    this.redraw();
  }
};

/**
 * Hide the item from the DOM (when visible)
 * @return {Boolean} changed
 */
RangeItem.prototype.hide = function() {
  if (this.displayed) {
    var box = this.dom.box;

    if (box.parentNode) {
      box.parentNode.removeChild(box);
    }

    this.displayed = false;
  }
};

/**
 * Reposition the item horizontally
 * @param {boolean} [limitSize=true] If true (default), the width of the range
 *                                   item will be limited, as the browser cannot
 *                                   display very wide divs. This means though
 *                                   that the applied left and width may
 *                                   not correspond to the ranges start and end
 * @Override
 */
RangeItem.prototype.repositionX = function(limitSize) {
  var parentWidth = this.parent.width;
  var start = this.conversion.toScreen(this.data.start);
  var end = this.conversion.toScreen(this.data.end);
  var contentLeft;
  var contentWidth;

  // limit the width of the range, as browsers cannot draw very wide divs
  if (limitSize === undefined || limitSize === true) {
    if (start < -parentWidth) {
      start = -parentWidth;
    }
    if (end > 2 * parentWidth) {
      end = 2 * parentWidth;
    }
  }
  var boxWidth = Math.max(end - start, 1);

  if (this.overflow) {
    this.left = start;
    this.width = boxWidth + this.props.content.width;
    contentWidth = this.props.content.width;

    // Note: The calculation of width is an optimistic calculation, giving
    //       a width which will not change when moving the Timeline
    //       So no re-stacking needed, which is nicer for the eye;
  }
  else {
    this.left = start;
    this.width = boxWidth;
    contentWidth = Math.min(end - start - 2 * this.options.padding, this.props.content.width);
  }

  this.dom.box.style.left = this.left + 'px';
  this.dom.box.style.width = boxWidth + 'px';

  switch (this.options.align) {
    case 'left':
      this.dom.content.style.left = '0';
      break;

    case 'right':
      this.dom.content.style.left = Math.max((boxWidth - contentWidth - 2 * this.options.padding), 0) + 'px';
      break;

    case 'center':
      this.dom.content.style.left = Math.max((boxWidth - contentWidth - 2 * this.options.padding) / 2, 0) + 'px';
      break;

    default: // 'auto'
      // when range exceeds left of the window, position the contents at the left of the visible area
      if (this.overflow) {
        if (end > 0) {
          contentLeft = Math.max(-start, 0);
        }
        else {
          contentLeft = -contentWidth; // ensure it's not visible anymore
        }
      }
      else {
        if (start < 0) {
          contentLeft = Math.min(-start,
              (end - start - contentWidth - 2 * this.options.padding));
          // TODO: remove the need for options.padding. it's terrible.
        }
        else {
          contentLeft = 0;
        }
      }
      this.dom.content.style.left = contentLeft + 'px';
  }
};

/**
 * Reposition the item vertically
 * @Override
 */
RangeItem.prototype.repositionY = function() {
  var orientation = this.options.orientation,
      box = this.dom.box;

  if (orientation == 'top') {
    box.style.top = this.top + 'px';
  }
  else {
    box.style.top = (this.parent.height - this.top - this.height) + 'px';
  }
};

/**
 * Repaint a drag area on the left side of the range when the range is selected
 * @protected
 */
RangeItem.prototype._repaintDragLeft = function () {
  if (this.selected && this.options.editable.updateTime && !this.dom.dragLeft) {
    // create and show drag area
    var dragLeft = document.createElement('div');
    dragLeft.className = 'drag-left';
    dragLeft.dragLeftItem = this;

    // TODO: this should be redundant?
    Hammer(dragLeft, {
      preventDefault: true
    }).on('drag', function () {
          //console.log('drag left')
        });

    this.dom.box.appendChild(dragLeft);
    this.dom.dragLeft = dragLeft;
  }
  else if (!this.selected && this.dom.dragLeft) {
    // delete drag area
    if (this.dom.dragLeft.parentNode) {
      this.dom.dragLeft.parentNode.removeChild(this.dom.dragLeft);
    }
    this.dom.dragLeft = null;
  }
};

/**
 * Repaint a drag area on the right side of the range when the range is selected
 * @protected
 */
RangeItem.prototype._repaintDragRight = function () {
  if (this.selected && this.options.editable.updateTime && !this.dom.dragRight) {
    // create and show drag area
    var dragRight = document.createElement('div');
    dragRight.className = 'drag-right';
    dragRight.dragRightItem = this;

    // TODO: this should be redundant?
    Hammer(dragRight, {
      preventDefault: true
    }).on('drag', function () {
      //console.log('drag right')
    });

    this.dom.box.appendChild(dragRight);
    this.dom.dragRight = dragRight;
  }
  else if (!this.selected && this.dom.dragRight) {
    // delete drag area
    if (this.dom.dragRight.parentNode) {
      this.dom.dragRight.parentNode.removeChild(this.dom.dragRight);
    }
    this.dom.dragRight = null;
  }
};

module.exports = RangeItem;

},{"../../../module/hammer":6,"./Item":24}],27:[function(require,module,exports){
// English
exports['en'] = {
  current: 'current',
  time: 'time'
};
exports['en_EN'] = exports['en'];
exports['en_US'] = exports['en'];

// Dutch
exports['nl'] = {
  current: 'aangepaste',
  time: 'tijd'
};
exports['nl_NL'] = exports['nl'];
exports['nl_BE'] = exports['nl'];

},{}],28:[function(require,module,exports){
// utility functions

// first check if moment.js is already loaded in the browser window, if so,
// use this instance. Else, load via commonjs.
var moment = require('./module/moment');

/**
 * Test whether given object is a number
 * @param {*} object
 * @return {Boolean} isNumber
 */
exports.isNumber = function(object) {
  return (object instanceof Number || typeof object == 'number');
};


/**
 * this function gives you a range between 0 and 1 based on the min and max values in the set, the total sum of all values and the current value.
 *
 * @param min
 * @param max
 * @param total
 * @param value
 * @returns {number}
 */
exports.giveRange = function(min,max,total,value) {
  if (max == min) {
    return 0.5;
  }
  else {
    var scale = 1 / (max - min);
    return Math.max(0,(value - min)*scale);
  }
}

/**
 * Test whether given object is a string
 * @param {*} object
 * @return {Boolean} isString
 */
exports.isString = function(object) {
  return (object instanceof String || typeof object == 'string');
};

/**
 * Test whether given object is a Date, or a String containing a Date
 * @param {Date | String} object
 * @return {Boolean} isDate
 */
exports.isDate = function(object) {
  if (object instanceof Date) {
    return true;
  }
  else if (exports.isString(object)) {
    // test whether this string contains a date
    var match = ASPDateRegex.exec(object);
    if (match) {
      return true;
    }
    else if (!isNaN(Date.parse(object))) {
      return true;
    }
  }

  return false;
};

/**
 * Test whether given object is an instance of google.visualization.DataTable
 * @param {*} object
 * @return {Boolean} isDataTable
 */
exports.isDataTable = function(object) {
  return (typeof (google) !== 'undefined') &&
      (google.visualization) &&
      (google.visualization.DataTable) &&
      (object instanceof google.visualization.DataTable);
};

/**
 * Create a semi UUID
 * source: http://stackoverflow.com/a/105074/1262753
 * @return {String} uuid
 */
exports.randomUUID = function() {
  var S4 = function () {
    return Math.floor(
        Math.random() * 0x10000 /* 65536 */
    ).toString(16);
  };

  return (
      S4() + S4() + '-' +
          S4() + '-' +
          S4() + '-' +
          S4() + '-' +
          S4() + S4() + S4()
      );
};

/**
 * Extend object a with the properties of object b or a series of objects
 * Only properties with defined values are copied
 * @param {Object} a
 * @param {... Object} b
 * @return {Object} a
 */
exports.extend = function (a, b) {
  for (var i = 1, len = arguments.length; i < len; i++) {
    var other = arguments[i];
    for (var prop in other) {
      if (other.hasOwnProperty(prop)) {
        a[prop] = other[prop];
      }
    }
  }

  return a;
};

/**
 * Extend object a with selected properties of object b or a series of objects
 * Only properties with defined values are copied
 * @param {Array.<String>} props
 * @param {Object} a
 * @param {... Object} b
 * @return {Object} a
 */
exports.selectiveExtend = function (props, a, b) {
  if (!Array.isArray(props)) {
    throw new Error('Array with property names expected as first argument');
  }

  for (var i = 2; i < arguments.length; i++) {
    var other = arguments[i];

    for (var p = 0; p < props.length; p++) {
      var prop = props[p];
      if (other.hasOwnProperty(prop)) {
        a[prop] = other[prop];
      }
    }
  }
  return a;
};

/**
 * Extend object a with selected properties of object b or a series of objects
 * Only properties with defined values are copied
 * @param {Array.<String>} props
 * @param {Object} a
 * @param {... Object} b
 * @return {Object} a
 */
exports.selectiveDeepExtend = function (props, a, b) {
  // TODO: add support for Arrays to deepExtend
  if (Array.isArray(b)) {
    throw new TypeError('Arrays are not supported by deepExtend');
  }
  for (var i = 2; i < arguments.length; i++) {
    var other = arguments[i];
    for (var p = 0; p < props.length; p++) {
      var prop = props[p];
      if (other.hasOwnProperty(prop)) {
        if (b[prop] && b[prop].constructor === Object) {
          if (a[prop] === undefined) {
            a[prop] = {};
          }
          if (a[prop].constructor === Object) {
            exports.deepExtend(a[prop], b[prop]);
          }
          else {
            a[prop] = b[prop];
          }
        } else if (Array.isArray(b[prop])) {
          throw new TypeError('Arrays are not supported by deepExtend');
        } else {
          a[prop] = b[prop];
        }

      }
    }
  }
  return a;
};

/**
 * Extend object a with selected properties of object b or a series of objects
 * Only properties with defined values are copied
 * @param {Array.<String>} props
 * @param {Object} a
 * @param {... Object} b
 * @return {Object} a
 */
exports.selectiveNotDeepExtend = function (props, a, b) {
  // TODO: add support for Arrays to deepExtend
  if (Array.isArray(b)) {
    throw new TypeError('Arrays are not supported by deepExtend');
  }
  for (var prop in b) {
    if (b.hasOwnProperty(prop)) {
      if (props.indexOf(prop) == -1) {
        if (b[prop] && b[prop].constructor === Object) {
          if (a[prop] === undefined) {
            a[prop] = {};
          }
          if (a[prop].constructor === Object) {
            exports.deepExtend(a[prop], b[prop]);
          }
          else {
            a[prop] = b[prop];
          }
        } else if (Array.isArray(b[prop])) {
          throw new TypeError('Arrays are not supported by deepExtend');
        } else {
          a[prop] = b[prop];
        }
      }
    }
  }
  return a;
};

/**
 * Deep extend an object a with the properties of object b
 * @param {Object} a
 * @param {Object} b
 * @returns {Object}
 */
exports.deepExtend = function(a, b) {
  // TODO: add support for Arrays to deepExtend
  if (Array.isArray(b)) {
    throw new TypeError('Arrays are not supported by deepExtend');
  }

  for (var prop in b) {
    if (b.hasOwnProperty(prop)) {
      if (b[prop] && b[prop].constructor === Object) {
        if (a[prop] === undefined) {
          a[prop] = {};
        }
        if (a[prop].constructor === Object) {
          exports.deepExtend(a[prop], b[prop]);
        }
        else {
          a[prop] = b[prop];
        }
      } else if (Array.isArray(b[prop])) {
        throw new TypeError('Arrays are not supported by deepExtend');
      } else {
        a[prop] = b[prop];
      }
    }
  }
  return a;
};

/**
 * Test whether all elements in two arrays are equal.
 * @param {Array} a
 * @param {Array} b
 * @return {boolean} Returns true if both arrays have the same length and same
 *                   elements.
 */
exports.equalArray = function (a, b) {
  if (a.length != b.length) return false;

  for (var i = 0, len = a.length; i < len; i++) {
    if (a[i] != b[i]) return false;
  }

  return true;
};

/**
 * Convert an object to another type
 * @param {Boolean | Number | String | Date | Moment | Null | undefined} object
 * @param {String | undefined} type   Name of the type. Available types:
 *                                    'Boolean', 'Number', 'String',
 *                                    'Date', 'Moment', ISODate', 'ASPDate'.
 * @return {*} object
 * @throws Error
 */
exports.convert = function(object, type) {
  var match;

  if (object === undefined) {
    return undefined;
  }
  if (object === null) {
    return null;
  }

  if (!type) {
    return object;
  }
  if (!(typeof type === 'string') && !(type instanceof String)) {
    throw new Error('Type must be a string');
  }

  //noinspection FallthroughInSwitchStatementJS
  switch (type) {
    case 'boolean':
    case 'Boolean':
      return Boolean(object);

    case 'number':
    case 'Number':
      return Number(object.valueOf());

    case 'string':
    case 'String':
      return String(object);

    case 'Date':
      if (exports.isNumber(object)) {
        return new Date(object);
      }
      if (object instanceof Date) {
        return new Date(object.valueOf());
      }
      else if (moment.isMoment(object)) {
        return new Date(object.valueOf());
      }
      if (exports.isString(object)) {
        match = ASPDateRegex.exec(object);
        if (match) {
          // object is an ASP date
          return new Date(Number(match[1])); // parse number
        }
        else {
          return moment(object).toDate(); // parse string
        }
      }
      else {
        throw new Error(
            'Cannot convert object of type ' + exports.getType(object) +
                ' to type Date');
      }

    case 'Moment':
      if (exports.isNumber(object)) {
        return moment(object);
      }
      if (object instanceof Date) {
        return moment(object.valueOf());
      }
      else if (moment.isMoment(object)) {
        return moment(object);
      }
      if (exports.isString(object)) {
        match = ASPDateRegex.exec(object);
        if (match) {
          // object is an ASP date
          return moment(Number(match[1])); // parse number
        }
        else {
          return moment(object); // parse string
        }
      }
      else {
        throw new Error(
            'Cannot convert object of type ' + exports.getType(object) +
                ' to type Date');
      }

    case 'ISODate':
      if (exports.isNumber(object)) {
        return new Date(object);
      }
      else if (object instanceof Date) {
        return object.toISOString();
      }
      else if (moment.isMoment(object)) {
        return object.toDate().toISOString();
      }
      else if (exports.isString(object)) {
        match = ASPDateRegex.exec(object);
        if (match) {
          // object is an ASP date
          return new Date(Number(match[1])).toISOString(); // parse number
        }
        else {
          return new Date(object).toISOString(); // parse string
        }
      }
      else {
        throw new Error(
            'Cannot convert object of type ' + exports.getType(object) +
                ' to type ISODate');
      }

    case 'ASPDate':
      if (exports.isNumber(object)) {
        return '/Date(' + object + ')/';
      }
      else if (object instanceof Date) {
        return '/Date(' + object.valueOf() + ')/';
      }
      else if (exports.isString(object)) {
        match = ASPDateRegex.exec(object);
        var value;
        if (match) {
          // object is an ASP date
          value = new Date(Number(match[1])).valueOf(); // parse number
        }
        else {
          value = new Date(object).valueOf(); // parse string
        }
        return '/Date(' + value + ')/';
      }
      else {
        throw new Error(
            'Cannot convert object of type ' + exports.getType(object) +
                ' to type ASPDate');
      }

    default:
      throw new Error('Unknown type "' + type + '"');
  }
};

// parse ASP.Net Date pattern,
// for example '/Date(1198908717056)/' or '/Date(1198908717056-0700)/'
// code from http://momentjs.com/
var ASPDateRegex = /^\/?Date\((\-?\d+)/i;

/**
 * Get the type of an object, for example exports.getType([]) returns 'Array'
 * @param {*} object
 * @return {String} type
 */
exports.getType = function(object) {
  var type = typeof object;

  if (type == 'object') {
    if (object == null) {
      return 'null';
    }
    if (object instanceof Boolean) {
      return 'Boolean';
    }
    if (object instanceof Number) {
      return 'Number';
    }
    if (object instanceof String) {
      return 'String';
    }
    if (Array.isArray(object)) {
      return 'Array';
    }
    if (object instanceof Date) {
      return 'Date';
    }
    return 'Object';
  }
  else if (type == 'number') {
    return 'Number';
  }
  else if (type == 'boolean') {
    return 'Boolean';
  }
  else if (type == 'string') {
    return 'String';
  }

  return type;
};

/**
 * Retrieve the absolute left value of a DOM element
 * @param {Element} elem        A dom element, for example a div
 * @return {number} left        The absolute left position of this element
 *                              in the browser page.
 */
exports.getAbsoluteLeft = function(elem) {
  return elem.getBoundingClientRect().left + window.pageXOffset;
};

/**
 * Retrieve the absolute top value of a DOM element
 * @param {Element} elem        A dom element, for example a div
 * @return {number} top        The absolute top position of this element
 *                              in the browser page.
 */
exports.getAbsoluteTop = function(elem) {
  return elem.getBoundingClientRect().top + window.pageYOffset;
};

/**
 * add a className to the given elements style
 * @param {Element} elem
 * @param {String} className
 */
exports.addClassName = function(elem, className) {
  var classes = elem.className.split(' ');
  if (classes.indexOf(className) == -1) {
    classes.push(className); // add the class to the array
    elem.className = classes.join(' ');
  }
};

/**
 * add a className to the given elements style
 * @param {Element} elem
 * @param {String} className
 */
exports.removeClassName = function(elem, className) {
  var classes = elem.className.split(' ');
  var index = classes.indexOf(className);
  if (index != -1) {
    classes.splice(index, 1); // remove the class from the array
    elem.className = classes.join(' ');
  }
};

/**
 * For each method for both arrays and objects.
 * In case of an array, the built-in Array.forEach() is applied.
 * In case of an Object, the method loops over all properties of the object.
 * @param {Object | Array} object   An Object or Array
 * @param {function} callback       Callback method, called for each item in
 *                                  the object or array with three parameters:
 *                                  callback(value, index, object)
 */
exports.forEach = function(object, callback) {
  var i,
      len;
  if (Array.isArray(object)) {
    // array
    for (i = 0, len = object.length; i < len; i++) {
      callback(object[i], i, object);
    }
  }
  else {
    // object
    for (i in object) {
      if (object.hasOwnProperty(i)) {
        callback(object[i], i, object);
      }
    }
  }
};

/**
 * Convert an object into an array: all objects properties are put into the
 * array. The resulting array is unordered.
 * @param {Object} object
 * @param {Array} array
 */
exports.toArray = function(object) {
  var array = [];

  for (var prop in object) {
    if (object.hasOwnProperty(prop)) array.push(object[prop]);
  }

  return array;
}

/**
 * Update a property in an object
 * @param {Object} object
 * @param {String} key
 * @param {*} value
 * @return {Boolean} changed
 */
exports.updateProperty = function(object, key, value) {
  if (object[key] !== value) {
    object[key] = value;
    return true;
  }
  else {
    return false;
  }
};

/**
 * Add and event listener. Works for all browsers
 * @param {Element}     element    An html element
 * @param {string}      action     The action, for example "click",
 *                                 without the prefix "on"
 * @param {function}    listener   The callback function to be executed
 * @param {boolean}     [useCapture]
 */
exports.addEventListener = function(element, action, listener, useCapture) {
  if (element.addEventListener) {
    if (useCapture === undefined)
      useCapture = false;

    if (action === "mousewheel" && navigator.userAgent.indexOf("Firefox") >= 0) {
      action = "DOMMouseScroll";  // For Firefox
    }

    element.addEventListener(action, listener, useCapture);
  } else {
    element.attachEvent("on" + action, listener);  // IE browsers
  }
};

/**
 * Remove an event listener from an element
 * @param {Element}     element         An html dom element
 * @param {string}      action          The name of the event, for example "mousedown"
 * @param {function}    listener        The listener function
 * @param {boolean}     [useCapture]
 */
exports.removeEventListener = function(element, action, listener, useCapture) {
  if (element.removeEventListener) {
    // non-IE browsers
    if (useCapture === undefined)
      useCapture = false;

    if (action === "mousewheel" && navigator.userAgent.indexOf("Firefox") >= 0) {
      action = "DOMMouseScroll";  // For Firefox
    }

    element.removeEventListener(action, listener, useCapture);
  } else {
    // IE browsers
    element.detachEvent("on" + action, listener);
  }
};

/**
 * Cancels the event if it is cancelable, without stopping further propagation of the event.
 */
exports.preventDefault = function (event) {
  if (!event)
    event = window.event;

  if (event.preventDefault) {
    event.preventDefault();  // non-IE browsers
  }
  else {
    event.returnValue = false;  // IE browsers
  }
};

/**
 * Get HTML element which is the target of the event
 * @param {Event} event
 * @return {Element} target element
 */
exports.getTarget = function(event) {
  // code from http://www.quirksmode.org/js/events_properties.html
  if (!event) {
    event = window.event;
  }

  var target;

  if (event.target) {
    target = event.target;
  }
  else if (event.srcElement) {
    target = event.srcElement;
  }

  if (target.nodeType != undefined && target.nodeType == 3) {
    // defeat Safari bug
    target = target.parentNode;
  }

  return target;
};

/**
 * Check if given element contains given parent somewhere in the DOM tree
 * @param {Element} element
 * @param {Element} parent
 */
exports.hasParent = function (element, parent) {
  var e = element;

  while (e) {
    if (e === parent) {
      return true;
    }
    e = e.parentNode;
  }

  return false;
};

exports.option = {};

/**
 * Convert a value into a boolean
 * @param {Boolean | function | undefined} value
 * @param {Boolean} [defaultValue]
 * @returns {Boolean} bool
 */
exports.option.asBoolean = function (value, defaultValue) {
  if (typeof value == 'function') {
    value = value();
  }

  if (value != null) {
    return (value != false);
  }

  return defaultValue || null;
};

/**
 * Convert a value into a number
 * @param {Boolean | function | undefined} value
 * @param {Number} [defaultValue]
 * @returns {Number} number
 */
exports.option.asNumber = function (value, defaultValue) {
  if (typeof value == 'function') {
    value = value();
  }

  if (value != null) {
    return Number(value) || defaultValue || null;
  }

  return defaultValue || null;
};

/**
 * Convert a value into a string
 * @param {String | function | undefined} value
 * @param {String} [defaultValue]
 * @returns {String} str
 */
exports.option.asString = function (value, defaultValue) {
  if (typeof value == 'function') {
    value = value();
  }

  if (value != null) {
    return String(value);
  }

  return defaultValue || null;
};

/**
 * Convert a size or location into a string with pixels or a percentage
 * @param {String | Number | function | undefined} value
 * @param {String} [defaultValue]
 * @returns {String} size
 */
exports.option.asSize = function (value, defaultValue) {
  if (typeof value == 'function') {
    value = value();
  }

  if (exports.isString(value)) {
    return value;
  }
  else if (exports.isNumber(value)) {
    return value + 'px';
  }
  else {
    return defaultValue || null;
  }
};

/**
 * Convert a value into a DOM element
 * @param {HTMLElement | function | undefined} value
 * @param {HTMLElement} [defaultValue]
 * @returns {HTMLElement | null} dom
 */
exports.option.asElement = function (value, defaultValue) {
  if (typeof value == 'function') {
    value = value();
  }

  return value || defaultValue || null;
};

/**
 * http://stackoverflow.com/questions/5623838/rgb-to-hex-and-hex-to-rgb
 *
 * @param {String} hex
 * @returns {{r: *, g: *, b: *}} | 255 range
 */
exports.hexToRGB = function(hex) {
  // Expand shorthand form (e.g. "03F") to full form (e.g. "0033FF")
  var shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
  hex = hex.replace(shorthandRegex, function(m, r, g, b) {
      return r + r + g + g + b + b;
  });
  var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
  } : null;
};

/**
 * This function takes color in hex format or rgb() or rgba() format and overrides the opacity. Returns rgba() string.
 * @param color
 * @param opacity
 * @returns {*}
 */
exports.overrideOpacity = function(color,opacity) {
  if (color.indexOf("rgb") != -1) {
    var rgb = color.substr(color.indexOf("(")+1).replace(")","").split(",");
    return "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + "," + opacity + ")"
  }
  else {
    var rgb = exports.hexToRGB(color);
    if (rgb == null) {
      return color;
    }
    else {
      return "rgba(" + rgb.r + "," + rgb.g + "," + rgb.b + "," + opacity + ")"
    }
  }
}

/**
 *
 * @param red     0 -- 255
 * @param green   0 -- 255
 * @param blue    0 -- 255
 * @returns {string}
 * @constructor
 */
exports.RGBToHex = function(red,green,blue) {
  return "#" + ((1 << 24) + (red << 16) + (green << 8) + blue).toString(16).slice(1);
};

/**
 * Parse a color property into an object with border, background, and
 * highlight colors
 * @param {Object | String} color
 * @return {Object} colorObject
 */
exports.parseColor = function(color) {
  var c;
  if (exports.isString(color)) {
    if (exports.isValidRGB(color)) {
      var rgb = color.substr(4).substr(0,color.length-5).split(',');
      color = exports.RGBToHex(rgb[0],rgb[1],rgb[2]);
    }
    if (exports.isValidHex(color)) {
      var hsv = exports.hexToHSV(color);
      var lighterColorHSV = {h:hsv.h,s:hsv.s * 0.45,v:Math.min(1,hsv.v * 1.05)};
      var darkerColorHSV  = {h:hsv.h,s:Math.min(1,hsv.v * 1.25),v:hsv.v*0.6};
      var darkerColorHex  = exports.HSVToHex(darkerColorHSV.h ,darkerColorHSV.h ,darkerColorHSV.v);
      var lighterColorHex = exports.HSVToHex(lighterColorHSV.h,lighterColorHSV.s,lighterColorHSV.v);

      c = {
        background: color,
        border:darkerColorHex,
        highlight: {
          background:lighterColorHex,
          border:darkerColorHex
        },
        hover: {
          background:lighterColorHex,
          border:darkerColorHex
        }
      };
    }
    else {
      c = {
        background:color,
        border:color,
        highlight: {
          background:color,
          border:color
        },
        hover: {
          background:color,
          border:color
        }
      };
    }
  }
  else {
    c = {};
    c.background = color.background || 'white';
    c.border = color.border || c.background;

    if (exports.isString(color.highlight)) {
      c.highlight = {
        border: color.highlight,
        background: color.highlight
      }
    }
    else {
      c.highlight = {};
      c.highlight.background = color.highlight && color.highlight.background || c.background;
      c.highlight.border = color.highlight && color.highlight.border || c.border;
    }

    if (exports.isString(color.hover)) {
      c.hover = {
        border: color.hover,
        background: color.hover
      }
    }
    else {
      c.hover = {};
      c.hover.background = color.hover && color.hover.background || c.background;
      c.hover.border = color.hover && color.hover.border || c.border;
    }
  }

  return c;
};

/**
 * http://www.javascripter.net/faq/rgb2hsv.htm
 *
 * @param red
 * @param green
 * @param blue
 * @returns {*}
 * @constructor
 */
exports.RGBToHSV = function(red,green,blue) {
  red=red/255; green=green/255; blue=blue/255;
  var minRGB = Math.min(red,Math.min(green,blue));
  var maxRGB = Math.max(red,Math.max(green,blue));

  // Black-gray-white
  if (minRGB == maxRGB) {
    return {h:0,s:0,v:minRGB};
  }

  // Colors other than black-gray-white:
  var d = (red==minRGB) ? green-blue : ((blue==minRGB) ? red-green : blue-red);
  var h = (red==minRGB) ? 3 : ((blue==minRGB) ? 1 : 5);
  var hue = 60*(h - d/(maxRGB - minRGB))/360;
  var saturation = (maxRGB - minRGB)/maxRGB;
  var value = maxRGB;
  return {h:hue,s:saturation,v:value};
};

var cssUtil = {
  // split a string with css styles into an object with key/values
  split: function (cssText) {
    var styles = {};

    cssText.split(';').forEach(function (style) {
      if (style.trim() != '') {
        var parts = style.split(':');
        var key = parts[0].trim();
        var value = parts[1].trim();
        styles[key] = value;
      }
    });

    return styles;
  },

  // build a css text string from an object with key/values
  join: function (styles) {
    return Object.keys(styles)
        .map(function (key) {
          return key + ': ' + styles[key];
        })
        .join('; ');
  }
};

/**
 * Append a string with css styles to an element
 * @param {Element} element
 * @param {String} cssText
 */
exports.addCssText = function (element, cssText) {
  var currentStyles = cssUtil.split(element.style.cssText);
  var newStyles = cssUtil.split(cssText);
  var styles = exports.extend(currentStyles, newStyles);

  element.style.cssText = cssUtil.join(styles);
};

/**
 * Remove a string with css styles from an element
 * @param {Element} element
 * @param {String} cssText
 */
exports.removeCssText = function (element, cssText) {
  var styles = cssUtil.split(element.style.cssText);
  var removeStyles = cssUtil.split(cssText);

  for (var key in removeStyles) {
    if (removeStyles.hasOwnProperty(key)) {
      delete styles[key];
    }
  }

  element.style.cssText = cssUtil.join(styles);
};

/**
 * https://gist.github.com/mjijackson/5311256
 * @param h
 * @param s
 * @param v
 * @returns {{r: number, g: number, b: number}}
 * @constructor
 */
exports.HSVToRGB = function(h, s, v) {
  var r, g, b;

  var i = Math.floor(h * 6);
  var f = h * 6 - i;
  var p = v * (1 - s);
  var q = v * (1 - f * s);
  var t = v * (1 - (1 - f) * s);

  switch (i % 6) {
    case 0: r = v, g = t, b = p; break;
    case 1: r = q, g = v, b = p; break;
    case 2: r = p, g = v, b = t; break;
    case 3: r = p, g = q, b = v; break;
    case 4: r = t, g = p, b = v; break;
    case 5: r = v, g = p, b = q; break;
  }

  return {r:Math.floor(r * 255), g:Math.floor(g * 255), b:Math.floor(b * 255) };
};

exports.HSVToHex = function(h, s, v) {
  var rgb = exports.HSVToRGB(h, s, v);
  return exports.RGBToHex(rgb.r, rgb.g, rgb.b);
};

exports.hexToHSV = function(hex) {
  var rgb = exports.hexToRGB(hex);
  return exports.RGBToHSV(rgb.r, rgb.g, rgb.b);
};

exports.isValidHex = function(hex) {
  var isOk = /(^#[0-9A-F]{6}$)|(^#[0-9A-F]{3}$)/i.test(hex);
  return isOk;
};

exports.isValidRGB = function(rgb) {
  rgb = rgb.replace(" ","");
  var isOk = /rgb\((\d{1,3}),(\d{1,3}),(\d{1,3})\)/i.test(rgb);
  return isOk;
}

/**
 * This recursively redirects the prototype of JSON objects to the referenceObject
 * This is used for default options.
 *
 * @param referenceObject
 * @returns {*}
 */
exports.selectiveBridgeObject = function(fields, referenceObject) {
  if (typeof referenceObject == "object") {
    var objectTo = Object.create(referenceObject);
    for (var i = 0; i < fields.length; i++) {
      if (referenceObject.hasOwnProperty(fields[i])) {
        if (typeof referenceObject[fields[i]] == "object") {
          objectTo[fields[i]] = exports.bridgeObject(referenceObject[fields[i]]);
        }
      }
    }
    return objectTo;
  }
  else {
    return null;
  }
};

/**
 * This recursively redirects the prototype of JSON objects to the referenceObject
 * This is used for default options.
 *
 * @param referenceObject
 * @returns {*}
 */
exports.bridgeObject = function(referenceObject) {
  if (typeof referenceObject == "object") {
    var objectTo = Object.create(referenceObject);
    for (var i in referenceObject) {
      if (referenceObject.hasOwnProperty(i)) {
        if (typeof referenceObject[i] == "object") {
          objectTo[i] = exports.bridgeObject(referenceObject[i]);
        }
      }
    }
    return objectTo;
  }
  else {
    return null;
  }
};


/**
 * this is used to set the options of subobjects in the options object. A requirement of these subobjects
 * is that they have an 'enabled' element which is optional for the user but mandatory for the program.
 *
 * @param [object] mergeTarget | this is either this.options or the options used for the groups.
 * @param [object] options     | options
 * @param [String] option      | this is the option key in the options argument
 * @private
 */
exports.mergeOptions = function (mergeTarget, options, option) {
  if (options[option] !== undefined) {
    if (typeof options[option] == 'boolean') {
      mergeTarget[option].enabled = options[option];
    }
    else {
      mergeTarget[option].enabled = true;
      for (var prop in options[option]) {
        if (options[option].hasOwnProperty(prop)) {
          mergeTarget[option][prop] = options[option][prop];
        }
      }
    }
  }
}


/**
 * This function does a binary search for a visible item in a sorted list. If we find a visible item, the code that uses
 * this function will then iterate in both directions over this sorted list to find all visible items.
 *
 * @param {Item[]} orderedItems       | Items ordered by start
 * @param {function} searchFunction   | -1 is lower, 0 is found, 1 is higher
 * @param {String} field
 * @param {String} field2
 * @returns {number}
 * @private
 */
exports.binarySearchCustom = function(orderedItems, searchFunction, field, field2) {
  var maxIterations = 10000;
  var iteration = 0;
  var low = 0;
  var high = orderedItems.length - 1;

  while (low <= high && iteration < maxIterations) {
    var middle = Math.floor((low + high) / 2);

    var item = orderedItems[middle];
    var value = (field2 === undefined) ? item[field] : item[field][field2];

    var searchResult = searchFunction(value);
    if (searchResult == 0) { // jihaa, found a visible item!
      return middle;
    }
    else if (searchResult == -1) {  // it is too small --> increase low
      low = middle + 1;
    }
    else {  // it is too big --> decrease high
      high = middle - 1;
    }

    iteration++;
  }

  return -1;
};

/**
 * This function does a binary search for a specific value in a sorted array. If it does not exist but is in between of
 * two values, we return either the one before or the one after, depending on user input
 * If it is found, we return the index, else -1.
 *
 * @param {Array} orderedItems
 * @param {{start: number, end: number}} target
 * @param {String} field
 * @param {String} sidePreference   'before' or 'after'
 * @returns {number}
 * @private
 */
exports.binarySearchValue = function(orderedItems, target, field, sidePreference) {
  var maxIterations = 10000;
  var iteration = 0;
  var low = 0;
  var high = orderedItems.length - 1;
  var prevValue, value, nextValue, middle;

  while (low <= high && iteration < maxIterations) {
    // get a new guess
    middle = Math.floor(0.5*(high+low));
    prevValue = orderedItems[Math.max(0,middle - 1)][field];
    value     = orderedItems[middle][field];
    nextValue = orderedItems[Math.min(orderedItems.length-1,middle + 1)][field];

    if (value == target) { // we found the target
      return middle;
    }
    else if (prevValue < target && value > target) {  // target is in between of the previous and the current
      return sidePreference == 'before' ? Math.max(0,middle - 1) : middle;
    }
    else if (value < target && nextValue > target) { // target is in between of the current and the next
      return sidePreference == 'before' ? middle : Math.min(orderedItems.length-1,middle + 1);
    }
    else {  // didnt find the target, we need to change our boundaries.
      if (value < target) { // it is too small --> increase low
        low = middle + 1;
      }
      else {  // it is too big --> decrease high
        high = middle - 1;
      }
    }
    iteration++;
  }

  // didnt find anything. Return -1.
  return -1;
};

/**
 * Quadratic ease-in-out
 * http://gizma.com/easing/
 * @param {number} t        Current time
 * @param {number} start    Start value
 * @param {number} end      End value
 * @param {number} duration Duration
 * @returns {number} Value corresponding with current time
 */
exports.easeInOutQuad = function (t, start, end, duration) {
  var change = end - start;
  t /= duration/2;
  if (t < 1) return change/2*t*t + start;
  t--;
  return -change/2 * (t*(t-2) - 1) + start;
};



/*
 * Easing Functions - inspired from http://gizma.com/easing/
 * only considering the t value for the range [0, 1] => [0, 1]
 * https://gist.github.com/gre/1650294
 */
exports.easingFunctions = {
  // no easing, no acceleration
  linear: function (t) {
    return t
  },
  // accelerating from zero velocity
  easeInQuad: function (t) {
    return t * t
  },
  // decelerating to zero velocity
  easeOutQuad: function (t) {
    return t * (2 - t)
  },
  // acceleration until halfway, then deceleration
  easeInOutQuad: function (t) {
    return t < .5 ? 2 * t * t : -1 + (4 - 2 * t) * t
  },
  // accelerating from zero velocity
  easeInCubic: function (t) {
    return t * t * t
  },
  // decelerating to zero velocity
  easeOutCubic: function (t) {
    return (--t) * t * t + 1
  },
  // acceleration until halfway, then deceleration
  easeInOutCubic: function (t) {
    return t < .5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1
  },
  // accelerating from zero velocity
  easeInQuart: function (t) {
    return t * t * t * t
  },
  // decelerating to zero velocity
  easeOutQuart: function (t) {
    return 1 - (--t) * t * t * t
  },
  // acceleration until halfway, then deceleration
  easeInOutQuart: function (t) {
    return t < .5 ? 8 * t * t * t * t : 1 - 8 * (--t) * t * t * t
  },
  // accelerating from zero velocity
  easeInQuint: function (t) {
    return t * t * t * t * t
  },
  // decelerating to zero velocity
  easeOutQuint: function (t) {
    return 1 + (--t) * t * t * t * t
  },
  // acceleration until halfway, then deceleration
  easeInOutQuint: function (t) {
    return t < .5 ? 16 * t * t * t * t * t : 1 + 16 * (--t) * t * t * t * t
  }
};
},{"./module/moment":7}],29:[function(require,module,exports){

/**
 * Expose `Emitter`.
 */

module.exports = Emitter;

/**
 * Initialize a new `Emitter`.
 *
 * @api public
 */

function Emitter(obj) {
  if (obj) return mixin(obj);
};

/**
 * Mixin the emitter properties.
 *
 * @param {Object} obj
 * @return {Object}
 * @api private
 */

function mixin(obj) {
  for (var key in Emitter.prototype) {
    obj[key] = Emitter.prototype[key];
  }
  return obj;
}

/**
 * Listen on the given `event` with `fn`.
 *
 * @param {String} event
 * @param {Function} fn
 * @return {Emitter}
 * @api public
 */

Emitter.prototype.on =
Emitter.prototype.addEventListener = function(event, fn){
  this._callbacks = this._callbacks || {};
  (this._callbacks[event] = this._callbacks[event] || [])
    .push(fn);
  return this;
};

/**
 * Adds an `event` listener that will be invoked a single
 * time then automatically removed.
 *
 * @param {String} event
 * @param {Function} fn
 * @return {Emitter}
 * @api public
 */

Emitter.prototype.once = function(event, fn){
  var self = this;
  this._callbacks = this._callbacks || {};

  function on() {
    self.off(event, on);
    fn.apply(this, arguments);
  }

  on.fn = fn;
  this.on(event, on);
  return this;
};

/**
 * Remove the given callback for `event` or all
 * registered callbacks.
 *
 * @param {String} event
 * @param {Function} fn
 * @return {Emitter}
 * @api public
 */

Emitter.prototype.off =
Emitter.prototype.removeListener =
Emitter.prototype.removeAllListeners =
Emitter.prototype.removeEventListener = function(event, fn){
  this._callbacks = this._callbacks || {};

  // all
  if (0 == arguments.length) {
    this._callbacks = {};
    return this;
  }

  // specific event
  var callbacks = this._callbacks[event];
  if (!callbacks) return this;

  // remove all handlers
  if (1 == arguments.length) {
    delete this._callbacks[event];
    return this;
  }

  // remove specific handler
  var cb;
  for (var i = 0; i < callbacks.length; i++) {
    cb = callbacks[i];
    if (cb === fn || cb.fn === fn) {
      callbacks.splice(i, 1);
      break;
    }
  }
  return this;
};

/**
 * Emit `event` with the given args.
 *
 * @param {String} event
 * @param {Mixed} ...
 * @return {Emitter}
 */

Emitter.prototype.emit = function(event){
  this._callbacks = this._callbacks || {};
  var args = [].slice.call(arguments, 1)
    , callbacks = this._callbacks[event];

  if (callbacks) {
    callbacks = callbacks.slice(0);
    for (var i = 0, len = callbacks.length; i < len; ++i) {
      callbacks[i].apply(this, args);
    }
  }

  return this;
};

/**
 * Return array of callbacks for `event`.
 *
 * @param {String} event
 * @return {Array}
 * @api public
 */

Emitter.prototype.listeners = function(event){
  this._callbacks = this._callbacks || {};
  return this._callbacks[event] || [];
};

/**
 * Check if this emitter has `event` handlers.
 *
 * @param {String} event
 * @return {Boolean}
 * @api public
 */

Emitter.prototype.hasListeners = function(event){
  return !! this.listeners(event).length;
};

},{}],30:[function(require,module,exports){
/*! Hammer.JS - v1.1.3 - 2014-05-20
 * http://eightmedia.github.io/hammer.js
 *
 * Copyright (c) 2014 Jorik Tangelder <j.tangelder@gmail.com>;
 * Licensed under the MIT license */

(function(window, undefined) {
  'use strict';

/**
 * @main
 * @module hammer
 *
 * @class Hammer
 * @static
 */

/**
 * Hammer, use this to create instances
 * ````
 * var hammertime = new Hammer(myElement);
 * ````
 *
 * @method Hammer
 * @param {HTMLElement} element
 * @param {Object} [options={}]
 * @return {Hammer.Instance}
 */
var Hammer = function Hammer(element, options) {
    return new Hammer.Instance(element, options || {});
};

/**
 * version, as defined in package.json
 * the value will be set at each build
 * @property VERSION
 * @final
 * @type {String}
 */
Hammer.VERSION = '1.1.3';

/**
 * default settings.
 * more settings are defined per gesture at `/gestures`. Each gesture can be disabled/enabled
 * by setting it's name (like `swipe`) to false.
 * You can set the defaults for all instances by changing this object before creating an instance.
 * @example
 * ````
 *  Hammer.defaults.drag = false;
 *  Hammer.defaults.behavior.touchAction = 'pan-y';
 *  delete Hammer.defaults.behavior.userSelect;
 * ````
 * @property defaults
 * @type {Object}
 */
Hammer.defaults = {
    /**
     * this setting object adds styles and attributes to the element to prevent the browser from doing
     * its native behavior. The css properties are auto prefixed for the browsers when needed.
     * @property defaults.behavior
     * @type {Object}
     */
    behavior: {
        /**
         * Disables text selection to improve the dragging gesture. When the value is `none` it also sets
         * `onselectstart=false` for IE on the element. Mainly for desktop browsers.
         * @property defaults.behavior.userSelect
         * @type {String}
         * @default 'none'
         */
        userSelect: 'none',

        /**
         * Specifies whether and how a given region can be manipulated by the user (for instance, by panning or zooming).
         * Used by Chrome 35> and IE10>. By default this makes the element blocking any touch event.
         * @property defaults.behavior.touchAction
         * @type {String}
         * @default: 'pan-y'
         */
        touchAction: 'pan-y',

        /**
         * Disables the default callout shown when you touch and hold a touch target.
         * On iOS, when you touch and hold a touch target such as a link, Safari displays
         * a callout containing information about the link. This property allows you to disable that callout.
         * @property defaults.behavior.touchCallout
         * @type {String}
         * @default 'none'
         */
        touchCallout: 'none',

        /**
         * Specifies whether zooming is enabled. Used by IE10>
         * @property defaults.behavior.contentZooming
         * @type {String}
         * @default 'none'
         */
        contentZooming: 'none',

        /**
         * Specifies that an entire element should be draggable instead of its contents.
         * Mainly for desktop browsers.
         * @property defaults.behavior.userDrag
         * @type {String}
         * @default 'none'
         */
        userDrag: 'none',

        /**
         * Overrides the highlight color shown when the user taps a link or a JavaScript
         * clickable element in Safari on iPhone. This property obeys the alpha value, if specified.
         *
         * If you don't specify an alpha value, Safari on iPhone applies a default alpha value
         * to the color. To disable tap highlighting, set the alpha value to 0 (invisible).
         * If you set the alpha value to 1.0 (opaque), the element is not visible when tapped.
         * @property defaults.behavior.tapHighlightColor
         * @type {String}
         * @default 'rgba(0,0,0,0)'
         */
        tapHighlightColor: 'rgba(0,0,0,0)'
    }
};

/**
 * hammer document where the base events are added at
 * @property DOCUMENT
 * @type {HTMLElement}
 * @default window.document
 */
Hammer.DOCUMENT = document;

/**
 * detect support for pointer events
 * @property HAS_POINTEREVENTS
 * @type {Boolean}
 */
Hammer.HAS_POINTEREVENTS = navigator.pointerEnabled || navigator.msPointerEnabled;

/**
 * detect support for touch events
 * @property HAS_TOUCHEVENTS
 * @type {Boolean}
 */
Hammer.HAS_TOUCHEVENTS = ('ontouchstart' in window);

/**
 * detect mobile browsers
 * @property IS_MOBILE
 * @type {Boolean}
 */
Hammer.IS_MOBILE = /mobile|tablet|ip(ad|hone|od)|android|silk/i.test(navigator.userAgent);

/**
 * detect if we want to support mouseevents at all
 * @property NO_MOUSEEVENTS
 * @type {Boolean}
 */
Hammer.NO_MOUSEEVENTS = (Hammer.HAS_TOUCHEVENTS && Hammer.IS_MOBILE) || Hammer.HAS_POINTEREVENTS;

/**
 * interval in which Hammer recalculates current velocity/direction/angle in ms
 * @property CALCULATE_INTERVAL
 * @type {Number}
 * @default 25
 */
Hammer.CALCULATE_INTERVAL = 25;

/**
 * eventtypes per touchevent (start, move, end) are filled by `Event.determineEventTypes` on `setup`
 * the object contains the DOM event names per type (`EVENT_START`, `EVENT_MOVE`, `EVENT_END`)
 * @property EVENT_TYPES
 * @private
 * @writeOnce
 * @type {Object}
 */
var EVENT_TYPES = {};

/**
 * direction strings, for safe comparisons
 * @property DIRECTION_DOWN|LEFT|UP|RIGHT
 * @final
 * @type {String}
 * @default 'down' 'left' 'up' 'right'
 */
var DIRECTION_DOWN = Hammer.DIRECTION_DOWN = 'down';
var DIRECTION_LEFT = Hammer.DIRECTION_LEFT = 'left';
var DIRECTION_UP = Hammer.DIRECTION_UP = 'up';
var DIRECTION_RIGHT = Hammer.DIRECTION_RIGHT = 'right';

/**
 * pointertype strings, for safe comparisons
 * @property POINTER_MOUSE|TOUCH|PEN
 * @final
 * @type {String}
 * @default 'mouse' 'touch' 'pen'
 */
var POINTER_MOUSE = Hammer.POINTER_MOUSE = 'mouse';
var POINTER_TOUCH = Hammer.POINTER_TOUCH = 'touch';
var POINTER_PEN = Hammer.POINTER_PEN = 'pen';

/**
 * eventtypes
 * @property EVENT_START|MOVE|END|RELEASE|TOUCH
 * @final
 * @type {String}
 * @default 'start' 'change' 'move' 'end' 'release' 'touch'
 */
var EVENT_START = Hammer.EVENT_START = 'start';
var EVENT_MOVE = Hammer.EVENT_MOVE = 'move';
var EVENT_END = Hammer.EVENT_END = 'end';
var EVENT_RELEASE = Hammer.EVENT_RELEASE = 'release';
var EVENT_TOUCH = Hammer.EVENT_TOUCH = 'touch';

/**
 * if the window events are set...
 * @property READY
 * @writeOnce
 * @type {Boolean}
 * @default false
 */
Hammer.READY = false;

/**
 * plugins namespace
 * @property plugins
 * @type {Object}
 */
Hammer.plugins = Hammer.plugins || {};

/**
 * gestures namespace
 * see `/gestures` for the definitions
 * @property gestures
 * @type {Object}
 */
Hammer.gestures = Hammer.gestures || {};

/**
 * setup events to detect gestures on the document
 * this function is called when creating an new instance
 * @private
 */
function setup() {
    if(Hammer.READY) {
        return;
    }

    // find what eventtypes we add listeners to
    Event.determineEventTypes();

    // Register all gestures inside Hammer.gestures
    Utils.each(Hammer.gestures, function(gesture) {
        Detection.register(gesture);
    });

    // Add touch events on the document
    Event.onTouch(Hammer.DOCUMENT, EVENT_MOVE, Detection.detect);
    Event.onTouch(Hammer.DOCUMENT, EVENT_END, Detection.detect);

    // Hammer is ready...!
    Hammer.READY = true;
}

/**
 * @module hammer
 *
 * @class Utils
 * @static
 */
var Utils = Hammer.utils = {
    /**
     * extend method, could also be used for cloning when `dest` is an empty object.
     * changes the dest object
     * @method extend
     * @param {Object} dest
     * @param {Object} src
     * @param {Boolean} [merge=false]  do a merge
     * @return {Object} dest
     */
    extend: function extend(dest, src, merge) {
        for(var key in src) {
            if(!src.hasOwnProperty(key) || (dest[key] !== undefined && merge)) {
                continue;
            }
            dest[key] = src[key];
        }
        return dest;
    },

    /**
     * simple addEventListener wrapper
     * @method on
     * @param {HTMLElement} element
     * @param {String} type
     * @param {Function} handler
     */
    on: function on(element, type, handler) {
        element.addEventListener(type, handler, false);
    },

    /**
     * simple removeEventListener wrapper
     * @method off
     * @param {HTMLElement} element
     * @param {String} type
     * @param {Function} handler
     */
    off: function off(element, type, handler) {
        element.removeEventListener(type, handler, false);
    },

    /**
     * forEach over arrays and objects
     * @method each
     * @param {Object|Array} obj
     * @param {Function} iterator
     * @param {any} iterator.item
     * @param {Number} iterator.index
     * @param {Object|Array} iterator.obj the source object
     * @param {Object} context value to use as `this` in the iterator
     */
    each: function each(obj, iterator, context) {
        var i, len;

        // native forEach on arrays
        if('forEach' in obj) {
            obj.forEach(iterator, context);
        // arrays
        } else if(obj.length !== undefined) {
            for(i = 0, len = obj.length; i < len; i++) {
                if(iterator.call(context, obj[i], i, obj) === false) {
                    return;
                }
            }
        // objects
        } else {
            for(i in obj) {
                if(obj.hasOwnProperty(i) &&
                    iterator.call(context, obj[i], i, obj) === false) {
                    return;
                }
            }
        }
    },

    /**
     * find if a string contains the string using indexOf
     * @method inStr
     * @param {String} src
     * @param {String} find
     * @return {Boolean} found
     */
    inStr: function inStr(src, find) {
        return src.indexOf(find) > -1;
    },

    /**
     * find if a array contains the object using indexOf or a simple polyfill
     * @method inArray
     * @param {String} src
     * @param {String} find
     * @return {Boolean|Number} false when not found, or the index
     */
    inArray: function inArray(src, find) {
        if(src.indexOf) {
            var index = src.indexOf(find);
            return (index === -1) ? false : index;
        } else {
            for(var i = 0, len = src.length; i < len; i++) {
                if(src[i] === find) {
                    return i;
                }
            }
            return false;
        }
    },

    /**
     * convert an array-like object (`arguments`, `touchlist`) to an array
     * @method toArray
     * @param {Object} obj
     * @return {Array}
     */
    toArray: function toArray(obj) {
        return Array.prototype.slice.call(obj, 0);
    },

    /**
     * find if a node is in the given parent
     * @method hasParent
     * @param {HTMLElement} node
     * @param {HTMLElement} parent
     * @return {Boolean} found
     */
    hasParent: function hasParent(node, parent) {
        while(node) {
            if(node == parent) {
                return true;
            }
            node = node.parentNode;
        }
        return false;
    },

    /**
     * get the center of all the touches
     * @method getCenter
     * @param {Array} touches
     * @return {Object} center contains `pageX`, `pageY`, `clientX` and `clientY` properties
     */
    getCenter: function getCenter(touches) {
        var pageX = [],
            pageY = [],
            clientX = [],
            clientY = [],
            min = Math.min,
            max = Math.max;

        // no need to loop when only one touch
        if(touches.length === 1) {
            return {
                pageX: touches[0].pageX,
                pageY: touches[0].pageY,
                clientX: touches[0].clientX,
                clientY: touches[0].clientY
            };
        }

        Utils.each(touches, function(touch) {
            pageX.push(touch.pageX);
            pageY.push(touch.pageY);
            clientX.push(touch.clientX);
            clientY.push(touch.clientY);
        });

        return {
            pageX: (min.apply(Math, pageX) + max.apply(Math, pageX)) / 2,
            pageY: (min.apply(Math, pageY) + max.apply(Math, pageY)) / 2,
            clientX: (min.apply(Math, clientX) + max.apply(Math, clientX)) / 2,
            clientY: (min.apply(Math, clientY) + max.apply(Math, clientY)) / 2
        };
    },

    /**
     * calculate the velocity between two points. unit is in px per ms.
     * @method getVelocity
     * @param {Number} deltaTime
     * @param {Number} deltaX
     * @param {Number} deltaY
     * @return {Object} velocity `x` and `y`
     */
    getVelocity: function getVelocity(deltaTime, deltaX, deltaY) {
        return {
            x: Math.abs(deltaX / deltaTime) || 0,
            y: Math.abs(deltaY / deltaTime) || 0
        };
    },

    /**
     * calculate the angle between two coordinates
     * @method getAngle
     * @param {Touch} touch1
     * @param {Touch} touch2
     * @return {Number} angle
     */
    getAngle: function getAngle(touch1, touch2) {
        var x = touch2.clientX - touch1.clientX,
            y = touch2.clientY - touch1.clientY;

        return Math.atan2(y, x) * 180 / Math.PI;
    },

    /**
     * do a small comparision to get the direction between two touches.
     * @method getDirection
     * @param {Touch} touch1
     * @param {Touch} touch2
     * @return {String} direction matches `DIRECTION_LEFT|RIGHT|UP|DOWN`
     */
    getDirection: function getDirection(touch1, touch2) {
        var x = Math.abs(touch1.clientX - touch2.clientX),
            y = Math.abs(touch1.clientY - touch2.clientY);

        if(x >= y) {
            return touch1.clientX - touch2.clientX > 0 ? DIRECTION_LEFT : DIRECTION_RIGHT;
        }
        return touch1.clientY - touch2.clientY > 0 ? DIRECTION_UP : DIRECTION_DOWN;
    },

    /**
     * calculate the distance between two touches
     * @method getDistance
     * @param {Touch}touch1
     * @param {Touch} touch2
     * @return {Number} distance
     */
    getDistance: function getDistance(touch1, touch2) {
        var x = touch2.clientX - touch1.clientX,
            y = touch2.clientY - touch1.clientY;

        return Math.sqrt((x * x) + (y * y));
    },

    /**
     * calculate the scale factor between two touchLists
     * no scale is 1, and goes down to 0 when pinched together, and bigger when pinched out
     * @method getScale
     * @param {Array} start array of touches
     * @param {Array} end array of touches
     * @return {Number} scale
     */
    getScale: function getScale(start, end) {
        // need two fingers...
        if(start.length >= 2 && end.length >= 2) {
            return this.getDistance(end[0], end[1]) / this.getDistance(start[0], start[1]);
        }
        return 1;
    },

    /**
     * calculate the rotation degrees between two touchLists
     * @method getRotation
     * @param {Array} start array of touches
     * @param {Array} end array of touches
     * @return {Number} rotation
     */
    getRotation: function getRotation(start, end) {
        // need two fingers
        if(start.length >= 2 && end.length >= 2) {
            return this.getAngle(end[1], end[0]) - this.getAngle(start[1], start[0]);
        }
        return 0;
    },

    /**
     * find out if the direction is vertical   *
     * @method isVertical
     * @param {String} direction matches `DIRECTION_UP|DOWN`
     * @return {Boolean} is_vertical
     */
    isVertical: function isVertical(direction) {
        return direction == DIRECTION_UP || direction == DIRECTION_DOWN;
    },

    /**
     * set css properties with their prefixes
     * @param {HTMLElement} element
     * @param {String} prop
     * @param {String} value
     * @param {Boolean} [toggle=true]
     * @return {Boolean}
     */
    setPrefixedCss: function setPrefixedCss(element, prop, value, toggle) {
        var prefixes = ['', 'Webkit', 'Moz', 'O', 'ms'];
        prop = Utils.toCamelCase(prop);

        for(var i = 0; i < prefixes.length; i++) {
            var p = prop;
            // prefixes
            if(prefixes[i]) {
                p = prefixes[i] + p.slice(0, 1).toUpperCase() + p.slice(1);
            }

            // test the style
            if(p in element.style) {
                element.style[p] = (toggle == null || toggle) && value || '';
                break;
            }
        }
    },

    /**
     * toggle browser default behavior by setting css properties.
     * `userSelect='none'` also sets `element.onselectstart` to false
     * `userDrag='none'` also sets `element.ondragstart` to false
     *
     * @method toggleBehavior
     * @param {HtmlElement} element
     * @param {Object} props
     * @param {Boolean} [toggle=true]
     */
    toggleBehavior: function toggleBehavior(element, props, toggle) {
        if(!props || !element || !element.style) {
            return;
        }

        // set the css properties
        Utils.each(props, function(value, prop) {
            Utils.setPrefixedCss(element, prop, value, toggle);
        });

        var falseFn = toggle && function() {
            return false;
        };

        // also the disable onselectstart
        if(props.userSelect == 'none') {
            element.onselectstart = falseFn;
        }
        // and disable ondragstart
        if(props.userDrag == 'none') {
            element.ondragstart = falseFn;
        }
    },

    /**
     * convert a string with underscores to camelCase
     * so prevent_default becomes preventDefault
     * @param {String} str
     * @return {String} camelCaseStr
     */
    toCamelCase: function toCamelCase(str) {
        return str.replace(/[_-]([a-z])/g, function(s) {
            return s[1].toUpperCase();
        });
    }
};


/**
 * @module hammer
 */
/**
 * @class Event
 * @static
 */
var Event = Hammer.event = {
    /**
     * when touch events have been fired, this is true
     * this is used to stop mouse events
     * @property prevent_mouseevents
     * @private
     * @type {Boolean}
     */
    preventMouseEvents: false,

    /**
     * if EVENT_START has been fired
     * @property started
     * @private
     * @type {Boolean}
     */
    started: false,

    /**
     * when the mouse is hold down, this is true
     * @property should_detect
     * @private
     * @type {Boolean}
     */
    shouldDetect: false,

    /**
     * simple event binder with a hook and support for multiple types
     * @method on
     * @param {HTMLElement} element
     * @param {String} type
     * @param {Function} handler
     * @param {Function} [hook]
     * @param {Object} hook.type
     */
    on: function on(element, type, handler, hook) {
        var types = type.split(' ');
        Utils.each(types, function(type) {
            Utils.on(element, type, handler);
            hook && hook(type);
        });
    },

    /**
     * simple event unbinder with a hook and support for multiple types
     * @method off
     * @param {HTMLElement} element
     * @param {String} type
     * @param {Function} handler
     * @param {Function} [hook]
     * @param {Object} hook.type
     */
    off: function off(element, type, handler, hook) {
        var types = type.split(' ');
        Utils.each(types, function(type) {
            Utils.off(element, type, handler);
            hook && hook(type);
        });
    },

    /**
     * the core touch event handler.
     * this finds out if we should to detect gestures
     * @method onTouch
     * @param {HTMLElement} element
     * @param {String} eventType matches `EVENT_START|MOVE|END`
     * @param {Function} handler
     * @return onTouchHandler {Function} the core event handler
     */
    onTouch: function onTouch(element, eventType, handler) {
        var self = this;

        var onTouchHandler = function onTouchHandler(ev) {
            var srcType = ev.type.toLowerCase(),
                isPointer = Hammer.HAS_POINTEREVENTS,
                isMouse = Utils.inStr(srcType, 'mouse'),
                triggerType;

            // if we are in a mouseevent, but there has been a touchevent triggered in this session
            // we want to do nothing. simply break out of the event.
            if(isMouse && self.preventMouseEvents) {
                return;

            // mousebutton must be down
            } else if(isMouse && eventType == EVENT_START && ev.button === 0) {
                self.preventMouseEvents = false;
                self.shouldDetect = true;
            } else if(isPointer && eventType == EVENT_START) {
                self.shouldDetect = (ev.buttons === 1 || PointerEvent.matchType(POINTER_TOUCH, ev));
            // just a valid start event, but no mouse
            } else if(!isMouse && eventType == EVENT_START) {
                self.preventMouseEvents = true;
                self.shouldDetect = true;
            }

            // update the pointer event before entering the detection
            if(isPointer && eventType != EVENT_END) {
                PointerEvent.updatePointer(eventType, ev);
            }

            // we are in a touch/down state, so allowed detection of gestures
            if(self.shouldDetect) {
                triggerType = self.doDetect.call(self, ev, eventType, element, handler);
            }

            // ...and we are done with the detection
            // so reset everything to start each detection totally fresh
            if(triggerType == EVENT_END) {
                self.preventMouseEvents = false;
                self.shouldDetect = false;
                PointerEvent.reset();
            // update the pointerevent object after the detection
            }

            if(isPointer && eventType == EVENT_END) {
                PointerEvent.updatePointer(eventType, ev);
            }
        };

        this.on(element, EVENT_TYPES[eventType], onTouchHandler);
        return onTouchHandler;
    },

    /**
     * the core detection method
     * this finds out what hammer-touch-events to trigger
     * @method doDetect
     * @param {Object} ev
     * @param {String} eventType matches `EVENT_START|MOVE|END`
     * @param {HTMLElement} element
     * @param {Function} handler
     * @return {String} triggerType matches `EVENT_START|MOVE|END`
     */
    doDetect: function doDetect(ev, eventType, element, handler) {
        var touchList = this.getTouchList(ev, eventType);
        var touchListLength = touchList.length;
        var triggerType = eventType;
        var triggerChange = touchList.trigger; // used by fakeMultitouch plugin
        var changedLength = touchListLength;

        // at each touchstart-like event we want also want to trigger a TOUCH event...
        if(eventType == EVENT_START) {
            triggerChange = EVENT_TOUCH;
        // ...the same for a touchend-like event
        } else if(eventType == EVENT_END) {
            triggerChange = EVENT_RELEASE;

            // keep track of how many touches have been removed
            changedLength = touchList.length - ((ev.changedTouches) ? ev.changedTouches.length : 1);
        }

        // after there are still touches on the screen,
        // we just want to trigger a MOVE event. so change the START or END to a MOVE
        // but only after detection has been started, the first time we actualy want a START
        if(changedLength > 0 && this.started) {
            triggerType = EVENT_MOVE;
        }

        // detection has been started, we keep track of this, see above
        this.started = true;

        // generate some event data, some basic information
        var evData = this.collectEventData(element, triggerType, touchList, ev);

        // trigger the triggerType event before the change (TOUCH, RELEASE) events
        // but the END event should be at last
        if(eventType != EVENT_END) {
            handler.call(Detection, evData);
        }

        // trigger a change (TOUCH, RELEASE) event, this means the length of the touches changed
        if(triggerChange) {
            evData.changedLength = changedLength;
            evData.eventType = triggerChange;

            handler.call(Detection, evData);

            evData.eventType = triggerType;
            delete evData.changedLength;
        }

        // trigger the END event
        if(triggerType == EVENT_END) {
            handler.call(Detection, evData);

            // ...and we are done with the detection
            // so reset everything to start each detection totally fresh
            this.started = false;
        }

        return triggerType;
    },

    /**
     * we have different events for each device/browser
     * determine what we need and set them in the EVENT_TYPES constant
     * the `onTouch` method is bind to these properties.
     * @method determineEventTypes
     * @return {Object} events
     */
    determineEventTypes: function determineEventTypes() {
        var types;
        if(Hammer.HAS_POINTEREVENTS) {
            if(window.PointerEvent) {
                types = [
                    'pointerdown',
                    'pointermove',
                    'pointerup pointercancel lostpointercapture'
                ];
            } else {
                types = [
                    'MSPointerDown',
                    'MSPointerMove',
                    'MSPointerUp MSPointerCancel MSLostPointerCapture'
                ];
            }
        } else if(Hammer.NO_MOUSEEVENTS) {
            types = [
                'touchstart',
                'touchmove',
                'touchend touchcancel'
            ];
        } else {
            types = [
                'touchstart mousedown',
                'touchmove mousemove',
                'touchend touchcancel mouseup'
            ];
        }

        EVENT_TYPES[EVENT_START] = types[0];
        EVENT_TYPES[EVENT_MOVE] = types[1];
        EVENT_TYPES[EVENT_END] = types[2];
        return EVENT_TYPES;
    },

    /**
     * create touchList depending on the event
     * @method getTouchList
     * @param {Object} ev
     * @param {String} eventType
     * @return {Array} touches
     */
    getTouchList: function getTouchList(ev, eventType) {
        // get the fake pointerEvent touchlist
        if(Hammer.HAS_POINTEREVENTS) {
            return PointerEvent.getTouchList();
        }

        // get the touchlist
        if(ev.touches) {
            if(eventType == EVENT_MOVE) {
                return ev.touches;
            }

            var identifiers = [];
            var concat = [].concat(Utils.toArray(ev.touches), Utils.toArray(ev.changedTouches));
            var touchList = [];

            Utils.each(concat, function(touch) {
                if(Utils.inArray(identifiers, touch.identifier) === false) {
                    touchList.push(touch);
                }
                identifiers.push(touch.identifier);
            });

            return touchList;
        }

        // make fake touchList from mouse position
        ev.identifier = 1;
        return [ev];
    },

    /**
     * collect basic event data
     * @method collectEventData
     * @param {HTMLElement} element
     * @param {String} eventType matches `EVENT_START|MOVE|END`
     * @param {Array} touches
     * @param {Object} ev
     * @return {Object} ev
     */
    collectEventData: function collectEventData(element, eventType, touches, ev) {
        // find out pointerType
        var pointerType = POINTER_TOUCH;
        if(Utils.inStr(ev.type, 'mouse') || PointerEvent.matchType(POINTER_MOUSE, ev)) {
            pointerType = POINTER_MOUSE;
        } else if(PointerEvent.matchType(POINTER_PEN, ev)) {
            pointerType = POINTER_PEN;
        }

        return {
            center: Utils.getCenter(touches),
            timeStamp: Date.now(),
            target: ev.target,
            touches: touches,
            eventType: eventType,
            pointerType: pointerType,
            srcEvent: ev,

            /**
             * prevent the browser default actions
             * mostly used to disable scrolling of the browser
             */
            preventDefault: function() {
                var srcEvent = this.srcEvent;
                srcEvent.preventManipulation && srcEvent.preventManipulation();
                srcEvent.preventDefault && srcEvent.preventDefault();
            },

            /**
             * stop bubbling the event up to its parents
             */
            stopPropagation: function() {
                this.srcEvent.stopPropagation();
            },

            /**
             * immediately stop gesture detection
             * might be useful after a swipe was detected
             * @return {*}
             */
            stopDetect: function() {
                return Detection.stopDetect();
            }
        };
    }
};


/**
 * @module hammer
 *
 * @class PointerEvent
 * @static
 */
var PointerEvent = Hammer.PointerEvent = {
    /**
     * holds all pointers, by `identifier`
     * @property pointers
     * @type {Object}
     */
    pointers: {},

    /**
     * get the pointers as an array
     * @method getTouchList
     * @return {Array} touchlist
     */
    getTouchList: function getTouchList() {
        var touchlist = [];
        // we can use forEach since pointerEvents only is in IE10
        Utils.each(this.pointers, function(pointer) {
            touchlist.push(pointer);
        });
        return touchlist;
    },

    /**
     * update the position of a pointer
     * @method updatePointer
     * @param {String} eventType matches `EVENT_START|MOVE|END`
     * @param {Object} pointerEvent
     */
    updatePointer: function updatePointer(eventType, pointerEvent) {
        if(eventType == EVENT_END || (eventType != EVENT_END && pointerEvent.buttons !== 1)) {
            delete this.pointers[pointerEvent.pointerId];
        } else {
            pointerEvent.identifier = pointerEvent.pointerId;
            this.pointers[pointerEvent.pointerId] = pointerEvent;
        }
    },

    /**
     * check if ev matches pointertype
     * @method matchType
     * @param {String} pointerType matches `POINTER_MOUSE|TOUCH|PEN`
     * @param {PointerEvent} ev
     */
    matchType: function matchType(pointerType, ev) {
        if(!ev.pointerType) {
            return false;
        }

        var pt = ev.pointerType,
            types = {};

        types[POINTER_MOUSE] = (pt === (ev.MSPOINTER_TYPE_MOUSE || POINTER_MOUSE));
        types[POINTER_TOUCH] = (pt === (ev.MSPOINTER_TYPE_TOUCH || POINTER_TOUCH));
        types[POINTER_PEN] = (pt === (ev.MSPOINTER_TYPE_PEN || POINTER_PEN));
        return types[pointerType];
    },

    /**
     * reset the stored pointers
     * @method reset
     */
    reset: function resetList() {
        this.pointers = {};
    }
};


/**
 * @module hammer
 *
 * @class Detection
 * @static
 */
var Detection = Hammer.detection = {
    // contains all registred Hammer.gestures in the correct order
    gestures: [],

    // data of the current Hammer.gesture detection session
    current: null,

    // the previous Hammer.gesture session data
    // is a full clone of the previous gesture.current object
    previous: null,

    // when this becomes true, no gestures are fired
    stopped: false,

    /**
     * start Hammer.gesture detection
     * @method startDetect
     * @param {Hammer.Instance} inst
     * @param {Object} eventData
     */
    startDetect: function startDetect(inst, eventData) {
        // already busy with a Hammer.gesture detection on an element
        if(this.current) {
            return;
        }

        this.stopped = false;

        // holds current session
        this.current = {
            inst: inst, // reference to HammerInstance we're working for
            startEvent: Utils.extend({}, eventData), // start eventData for distances, timing etc
            lastEvent: false, // last eventData
            lastCalcEvent: false, // last eventData for calculations.
            futureCalcEvent: false, // last eventData for calculations.
            lastCalcData: {}, // last lastCalcData
            name: '' // current gesture we're in/detected, can be 'tap', 'hold' etc
        };

        this.detect(eventData);
    },

    /**
     * Hammer.gesture detection
     * @method detect
     * @param {Object} eventData
     * @return {any}
     */
    detect: function detect(eventData) {
        if(!this.current || this.stopped) {
            return;
        }

        // extend event data with calculations about scale, distance etc
        eventData = this.extendEventData(eventData);

        // hammer instance and instance options
        var inst = this.current.inst,
            instOptions = inst.options;

        // call Hammer.gesture handlers
        Utils.each(this.gestures, function triggerGesture(gesture) {
            // only when the instance options have enabled this gesture
            if(!this.stopped && inst.enabled && instOptions[gesture.name]) {
                gesture.handler.call(gesture, eventData, inst);
            }
        }, this);

        // store as previous event event
        if(this.current) {
            this.current.lastEvent = eventData;
        }

        if(eventData.eventType == EVENT_END) {
            this.stopDetect();
        }

        return eventData;
    },

    /**
     * clear the Hammer.gesture vars
     * this is called on endDetect, but can also be used when a final Hammer.gesture has been detected
     * to stop other Hammer.gestures from being fired
     * @method stopDetect
     */
    stopDetect: function stopDetect() {
        // clone current data to the store as the previous gesture
        // used for the double tap gesture, since this is an other gesture detect session
        this.previous = Utils.extend({}, this.current);

        // reset the current
        this.current = null;
        this.stopped = true;
    },

    /**
     * calculate velocity, angle and direction
     * @method getVelocityData
     * @param {Object} ev
     * @param {Object} center
     * @param {Number} deltaTime
     * @param {Number} deltaX
     * @param {Number} deltaY
     */
    getCalculatedData: function getCalculatedData(ev, center, deltaTime, deltaX, deltaY) {
        var cur = this.current,
            recalc = false,
            calcEv = cur.lastCalcEvent,
            calcData = cur.lastCalcData;

        if(calcEv && ev.timeStamp - calcEv.timeStamp > Hammer.CALCULATE_INTERVAL) {
            center = calcEv.center;
            deltaTime = ev.timeStamp - calcEv.timeStamp;
            deltaX = ev.center.clientX - calcEv.center.clientX;
            deltaY = ev.center.clientY - calcEv.center.clientY;
            recalc = true;
        }

        if(ev.eventType == EVENT_TOUCH || ev.eventType == EVENT_RELEASE) {
            cur.futureCalcEvent = ev;
        }

        if(!cur.lastCalcEvent || recalc) {
            calcData.velocity = Utils.getVelocity(deltaTime, deltaX, deltaY);
            calcData.angle = Utils.getAngle(center, ev.center);
            calcData.direction = Utils.getDirection(center, ev.center);

            cur.lastCalcEvent = cur.futureCalcEvent || ev;
            cur.futureCalcEvent = ev;
        }

        ev.velocityX = calcData.velocity.x;
        ev.velocityY = calcData.velocity.y;
        ev.interimAngle = calcData.angle;
        ev.interimDirection = calcData.direction;
    },

    /**
     * extend eventData for Hammer.gestures
     * @method extendEventData
     * @param {Object} ev
     * @return {Object} ev
     */
    extendEventData: function extendEventData(ev) {
        var cur = this.current,
            startEv = cur.startEvent,
            lastEv = cur.lastEvent || startEv;

        // update the start touchlist to calculate the scale/rotation
        if(ev.eventType == EVENT_TOUCH || ev.eventType == EVENT_RELEASE) {
            startEv.touches = [];
            Utils.each(ev.touches, function(touch) {
                startEv.touches.push({
                    clientX: touch.clientX,
                    clientY: touch.clientY
                });
            });
        }

        var deltaTime = ev.timeStamp - startEv.timeStamp,
            deltaX = ev.center.clientX - startEv.center.clientX,
            deltaY = ev.center.clientY - startEv.center.clientY;

        this.getCalculatedData(ev, lastEv.center, deltaTime, deltaX, deltaY);

        Utils.extend(ev, {
            startEvent: startEv,

            deltaTime: deltaTime,
            deltaX: deltaX,
            deltaY: deltaY,

            distance: Utils.getDistance(startEv.center, ev.center),
            angle: Utils.getAngle(startEv.center, ev.center),
            direction: Utils.getDirection(startEv.center, ev.center),
            scale: Utils.getScale(startEv.touches, ev.touches),
            rotation: Utils.getRotation(startEv.touches, ev.touches)
        });

        return ev;
    },

    /**
     * register new gesture
     * @method register
     * @param {Object} gesture object, see `gestures/` for documentation
     * @return {Array} gestures
     */
    register: function register(gesture) {
        // add an enable gesture options if there is no given
        var options = gesture.defaults || {};
        if(options[gesture.name] === undefined) {
            options[gesture.name] = true;
        }

        // extend Hammer default options with the Hammer.gesture options
        Utils.extend(Hammer.defaults, options, true);

        // set its index
        gesture.index = gesture.index || 1000;

        // add Hammer.gesture to the list
        this.gestures.push(gesture);

        // sort the list by index
        this.gestures.sort(function(a, b) {
            if(a.index < b.index) {
                return -1;
            }
            if(a.index > b.index) {
                return 1;
            }
            return 0;
        });

        return this.gestures;
    }
};


/**
 * @module hammer
 */

/**
 * create new hammer instance
 * all methods should return the instance itself, so it is chainable.
 *
 * @class Instance
 * @constructor
 * @param {HTMLElement} element
 * @param {Object} [options={}] options are merged with `Hammer.defaults`
 * @return {Hammer.Instance}
 */
Hammer.Instance = function(element, options) {
    var self = this;

    // setup HammerJS window events and register all gestures
    // this also sets up the default options
    setup();

    /**
     * @property element
     * @type {HTMLElement}
     */
    this.element = element;

    /**
     * @property enabled
     * @type {Boolean}
     * @protected
     */
    this.enabled = true;

    /**
     * options, merged with the defaults
     * options with an _ are converted to camelCase
     * @property options
     * @type {Object}
     */
    Utils.each(options, function(value, name) {
        delete options[name];
        options[Utils.toCamelCase(name)] = value;
    });

    this.options = Utils.extend(Utils.extend({}, Hammer.defaults), options || {});

    // add some css to the element to prevent the browser from doing its native behavoir
    if(this.options.behavior) {
        Utils.toggleBehavior(this.element, this.options.behavior, true);
    }

    /**
     * event start handler on the element to start the detection
     * @property eventStartHandler
     * @type {Object}
     */
    this.eventStartHandler = Event.onTouch(element, EVENT_START, function(ev) {
        if(self.enabled && ev.eventType == EVENT_START) {
            Detection.startDetect(self, ev);
        } else if(ev.eventType == EVENT_TOUCH) {
            Detection.detect(ev);
        }
    });

    /**
     * keep a list of user event handlers which needs to be removed when calling 'dispose'
     * @property eventHandlers
     * @type {Array}
     */
    this.eventHandlers = [];
};

Hammer.Instance.prototype = {
    /**
     * bind events to the instance
     * @method on
     * @chainable
     * @param {String} gestures multiple gestures by splitting with a space
     * @param {Function} handler
     * @param {Object} handler.ev event object
     */
    on: function onEvent(gestures, handler) {
        var self = this;
        Event.on(self.element, gestures, handler, function(type) {
            self.eventHandlers.push({ gesture: type, handler: handler });
        });
        return self;
    },

    /**
     * unbind events to the instance
     * @method off
     * @chainable
     * @param {String} gestures
     * @param {Function} handler
     */
    off: function offEvent(gestures, handler) {
        var self = this;

        Event.off(self.element, gestures, handler, function(type) {
            var index = Utils.inArray({ gesture: type, handler: handler });
            if(index !== false) {
                self.eventHandlers.splice(index, 1);
            }
        });
        return self;
    },

    /**
     * trigger gesture event
     * @method trigger
     * @chainable
     * @param {String} gesture
     * @param {Object} [eventData]
     */
    trigger: function triggerEvent(gesture, eventData) {
        // optional
        if(!eventData) {
            eventData = {};
        }

        // create DOM event
        var event = Hammer.DOCUMENT.createEvent('Event');
        event.initEvent(gesture, true, true);
        event.gesture = eventData;

        // trigger on the target if it is in the instance element,
        // this is for event delegation tricks
        var element = this.element;
        if(Utils.hasParent(eventData.target, element)) {
            element = eventData.target;
        }

        element.dispatchEvent(event);
        return this;
    },

    /**
     * enable of disable hammer.js detection
     * @method enable
     * @chainable
     * @param {Boolean} state
     */
    enable: function enable(state) {
        this.enabled = state;
        return this;
    },

    /**
     * dispose this hammer instance
     * @method dispose
     * @return {Null}
     */
    dispose: function dispose() {
        var i, eh;

        // undo all changes made by stop_browser_behavior
        Utils.toggleBehavior(this.element, this.options.behavior, false);

        // unbind all custom event handlers
        for(i = -1; (eh = this.eventHandlers[++i]);) {
            Utils.off(this.element, eh.gesture, eh.handler);
        }

        this.eventHandlers = [];

        // unbind the start event listener
        Event.off(this.element, EVENT_TYPES[EVENT_START], this.eventStartHandler);

        return null;
    }
};


/**
 * @module gestures
 */
/**
 * Move with x fingers (default 1) around on the page.
 * Preventing the default browser behavior is a good way to improve feel and working.
 * ````
 *  hammertime.on("drag", function(ev) {
 *    console.log(ev);
 *    ev.gesture.preventDefault();
 *  });
 * ````
 *
 * @class Drag
 * @static
 */
/**
 * @event drag
 * @param {Object} ev
 */
/**
 * @event dragstart
 * @param {Object} ev
 */
/**
 * @event dragend
 * @param {Object} ev
 */
/**
 * @event drapleft
 * @param {Object} ev
 */
/**
 * @event dragright
 * @param {Object} ev
 */
/**
 * @event dragup
 * @param {Object} ev
 */
/**
 * @event dragdown
 * @param {Object} ev
 */

/**
 * @param {String} name
 */
(function(name) {
    var triggered = false;

    function dragGesture(ev, inst) {
        var cur = Detection.current;

        // max touches
        if(inst.options.dragMaxTouches > 0 &&
            ev.touches.length > inst.options.dragMaxTouches) {
            return;
        }

        switch(ev.eventType) {
            case EVENT_START:
                triggered = false;
                break;

            case EVENT_MOVE:
                // when the distance we moved is too small we skip this gesture
                // or we can be already in dragging
                if(ev.distance < inst.options.dragMinDistance &&
                    cur.name != name) {
                    return;
                }

                var startCenter = cur.startEvent.center;

                // we are dragging!
                if(cur.name != name) {
                    cur.name = name;
                    if(inst.options.dragDistanceCorrection && ev.distance > 0) {
                        // When a drag is triggered, set the event center to dragMinDistance pixels from the original event center.
                        // Without this correction, the dragged distance would jumpstart at dragMinDistance pixels instead of at 0.
                        // It might be useful to save the original start point somewhere
                        var factor = Math.abs(inst.options.dragMinDistance / ev.distance);
                        startCenter.pageX += ev.deltaX * factor;
                        startCenter.pageY += ev.deltaY * factor;
                        startCenter.clientX += ev.deltaX * factor;
                        startCenter.clientY += ev.deltaY * factor;

                        // recalculate event data using new start point
                        ev = Detection.extendEventData(ev);
                    }
                }

                // lock drag to axis?
                if(cur.lastEvent.dragLockToAxis ||
                    ( inst.options.dragLockToAxis &&
                        inst.options.dragLockMinDistance <= ev.distance
                        )) {
                    ev.dragLockToAxis = true;
                }

                // keep direction on the axis that the drag gesture started on
                var lastDirection = cur.lastEvent.direction;
                if(ev.dragLockToAxis && lastDirection !== ev.direction) {
                    if(Utils.isVertical(lastDirection)) {
                        ev.direction = (ev.deltaY < 0) ? DIRECTION_UP : DIRECTION_DOWN;
                    } else {
                        ev.direction = (ev.deltaX < 0) ? DIRECTION_LEFT : DIRECTION_RIGHT;
                    }
                }

                // first time, trigger dragstart event
                if(!triggered) {
                    inst.trigger(name + 'start', ev);
                    triggered = true;
                }

                // trigger events
                inst.trigger(name, ev);
                inst.trigger(name + ev.direction, ev);

                var isVertical = Utils.isVertical(ev.direction);

                // block the browser events
                if((inst.options.dragBlockVertical && isVertical) ||
                    (inst.options.dragBlockHorizontal && !isVertical)) {
                    ev.preventDefault();
                }
                break;

            case EVENT_RELEASE:
                if(triggered && ev.changedLength <= inst.options.dragMaxTouches) {
                    inst.trigger(name + 'end', ev);
                    triggered = false;
                }
                break;

            case EVENT_END:
                triggered = false;
                break;
        }
    }

    Hammer.gestures.Drag = {
        name: name,
        index: 50,
        handler: dragGesture,
        defaults: {
            /**
             * minimal movement that have to be made before the drag event gets triggered
             * @property dragMinDistance
             * @type {Number}
             * @default 10
             */
            dragMinDistance: 10,

            /**
             * Set dragDistanceCorrection to true to make the starting point of the drag
             * be calculated from where the drag was triggered, not from where the touch started.
             * Useful to avoid a jerk-starting drag, which can make fine-adjustments
             * through dragging difficult, and be visually unappealing.
             * @property dragDistanceCorrection
             * @type {Boolean}
             * @default true
             */
            dragDistanceCorrection: true,

            /**
             * set 0 for unlimited, but this can conflict with transform
             * @property dragMaxTouches
             * @type {Number}
             * @default 1
             */
            dragMaxTouches: 1,

            /**
             * prevent default browser behavior when dragging occurs
             * be careful with it, it makes the element a blocking element
             * when you are using the drag gesture, it is a good practice to set this true
             * @property dragBlockHorizontal
             * @type {Boolean}
             * @default false
             */
            dragBlockHorizontal: false,

            /**
             * same as `dragBlockHorizontal`, but for vertical movement
             * @property dragBlockVertical
             * @type {Boolean}
             * @default false
             */
            dragBlockVertical: false,

            /**
             * dragLockToAxis keeps the drag gesture on the axis that it started on,
             * It disallows vertical directions if the initial direction was horizontal, and vice versa.
             * @property dragLockToAxis
             * @type {Boolean}
             * @default false
             */
            dragLockToAxis: false,

            /**
             * drag lock only kicks in when distance > dragLockMinDistance
             * This way, locking occurs only when the distance has become large enough to reliably determine the direction
             * @property dragLockMinDistance
             * @type {Number}
             * @default 25
             */
            dragLockMinDistance: 25
        }
    };
})('drag');

/**
 * @module gestures
 */
/**
 * trigger a simple gesture event, so you can do anything in your handler.
 * only usable if you know what your doing...
 *
 * @class Gesture
 * @static
 */
/**
 * @event gesture
 * @param {Object} ev
 */
Hammer.gestures.Gesture = {
    name: 'gesture',
    index: 1337,
    handler: function releaseGesture(ev, inst) {
        inst.trigger(this.name, ev);
    }
};

/**
 * @module gestures
 */
/**
 * Touch stays at the same place for x time
 *
 * @class Hold
 * @static
 */
/**
 * @event hold
 * @param {Object} ev
 */

/**
 * @param {String} name
 */
(function(name) {
    var timer;

    function holdGesture(ev, inst) {
        var options = inst.options,
            current = Detection.current;

        switch(ev.eventType) {
            case EVENT_START:
                clearTimeout(timer);

                // set the gesture so we can check in the timeout if it still is
                current.name = name;

                // set timer and if after the timeout it still is hold,
                // we trigger the hold event
                timer = setTimeout(function() {
                    if(current && current.name == name) {
                        inst.trigger(name, ev);
                    }
                }, options.holdTimeout);
                break;

            case EVENT_MOVE:
                if(ev.distance > options.holdThreshold) {
                    clearTimeout(timer);
                }
                break;

            case EVENT_RELEASE:
                clearTimeout(timer);
                break;
        }
    }

    Hammer.gestures.Hold = {
        name: name,
        index: 10,
        defaults: {
            /**
             * @property holdTimeout
             * @type {Number}
             * @default 500
             */
            holdTimeout: 500,

            /**
             * movement allowed while holding
             * @property holdThreshold
             * @type {Number}
             * @default 2
             */
            holdThreshold: 2
        },
        handler: holdGesture
    };
})('hold');

/**
 * @module gestures
 */
/**
 * when a touch is being released from the page
 *
 * @class Release
 * @static
 */
/**
 * @event release
 * @param {Object} ev
 */
Hammer.gestures.Release = {
    name: 'release',
    index: Infinity,
    handler: function releaseGesture(ev, inst) {
        if(ev.eventType == EVENT_RELEASE) {
            inst.trigger(this.name, ev);
        }
    }
};

/**
 * @module gestures
 */
/**
 * triggers swipe events when the end velocity is above the threshold
 * for best usage, set `preventDefault` (on the drag gesture) to `true`
 * ````
 *  hammertime.on("dragleft swipeleft", function(ev) {
 *    console.log(ev);
 *    ev.gesture.preventDefault();
 *  });
 * ````
 *
 * @class Swipe
 * @static
 */
/**
 * @event swipe
 * @param {Object} ev
 */
/**
 * @event swipeleft
 * @param {Object} ev
 */
/**
 * @event swiperight
 * @param {Object} ev
 */
/**
 * @event swipeup
 * @param {Object} ev
 */
/**
 * @event swipedown
 * @param {Object} ev
 */
Hammer.gestures.Swipe = {
    name: 'swipe',
    index: 40,
    defaults: {
        /**
         * @property swipeMinTouches
         * @type {Number}
         * @default 1
         */
        swipeMinTouches: 1,

        /**
         * @property swipeMaxTouches
         * @type {Number}
         * @default 1
         */
        swipeMaxTouches: 1,

        /**
         * horizontal swipe velocity
         * @property swipeVelocityX
         * @type {Number}
         * @default 0.6
         */
        swipeVelocityX: 0.6,

        /**
         * vertical swipe velocity
         * @property swipeVelocityY
         * @type {Number}
         * @default 0.6
         */
        swipeVelocityY: 0.6
    },

    handler: function swipeGesture(ev, inst) {
        if(ev.eventType == EVENT_RELEASE) {
            var touches = ev.touches.length,
                options = inst.options;

            // max touches
            if(touches < options.swipeMinTouches ||
                touches > options.swipeMaxTouches) {
                return;
            }

            // when the distance we moved is too small we skip this gesture
            // or we can be already in dragging
            if(ev.velocityX > options.swipeVelocityX ||
                ev.velocityY > options.swipeVelocityY) {
                // trigger swipe events
                inst.trigger(this.name, ev);
                inst.trigger(this.name + ev.direction, ev);
            }
        }
    }
};

/**
 * @module gestures
 */
/**
 * Single tap and a double tap on a place
 *
 * @class Tap
 * @static
 */
/**
 * @event tap
 * @param {Object} ev
 */
/**
 * @event doubletap
 * @param {Object} ev
 */

/**
 * @param {String} name
 */
(function(name) {
    var hasMoved = false;

    function tapGesture(ev, inst) {
        var options = inst.options,
            current = Detection.current,
            prev = Detection.previous,
            sincePrev,
            didDoubleTap;

        switch(ev.eventType) {
            case EVENT_START:
                hasMoved = false;
                break;

            case EVENT_MOVE:
                hasMoved = hasMoved || (ev.distance > options.tapMaxDistance);
                break;

            case EVENT_END:
                if(!Utils.inStr(ev.srcEvent.type, 'cancel') && ev.deltaTime < options.tapMaxTime && !hasMoved) {
                    // previous gesture, for the double tap since these are two different gesture detections
                    sincePrev = prev && prev.lastEvent && ev.timeStamp - prev.lastEvent.timeStamp;
                    didDoubleTap = false;

                    // check if double tap
                    if(prev && prev.name == name &&
                        (sincePrev && sincePrev < options.doubleTapInterval) &&
                        ev.distance < options.doubleTapDistance) {
                        inst.trigger('doubletap', ev);
                        didDoubleTap = true;
                    }

                    // do a single tap
                    if(!didDoubleTap || options.tapAlways) {
                        current.name = name;
                        inst.trigger(current.name, ev);
                    }
                }
                break;
        }
    }

    Hammer.gestures.Tap = {
        name: name,
        index: 100,
        handler: tapGesture,
        defaults: {
            /**
             * max time of a tap, this is for the slow tappers
             * @property tapMaxTime
             * @type {Number}
             * @default 250
             */
            tapMaxTime: 250,

            /**
             * max distance of movement of a tap, this is for the slow tappers
             * @property tapMaxDistance
             * @type {Number}
             * @default 10
             */
            tapMaxDistance: 10,

            /**
             * always trigger the `tap` event, even while double-tapping
             * @property tapAlways
             * @type {Boolean}
             * @default true
             */
            tapAlways: true,

            /**
             * max distance between two taps
             * @property doubleTapDistance
             * @type {Number}
             * @default 20
             */
            doubleTapDistance: 20,

            /**
             * max time between two taps
             * @property doubleTapInterval
             * @type {Number}
             * @default 300
             */
            doubleTapInterval: 300
        }
    };
})('tap');

/**
 * @module gestures
 */
/**
 * when a touch is being touched at the page
 *
 * @class Touch
 * @static
 */
/**
 * @event touch
 * @param {Object} ev
 */
Hammer.gestures.Touch = {
    name: 'touch',
    index: -Infinity,
    defaults: {
        /**
         * call preventDefault at touchstart, and makes the element blocking by disabling the scrolling of the page,
         * but it improves gestures like transforming and dragging.
         * be careful with using this, it can be very annoying for users to be stuck on the page
         * @property preventDefault
         * @type {Boolean}
         * @default false
         */
        preventDefault: false,

        /**
         * disable mouse events, so only touch (or pen!) input triggers events
         * @property preventMouse
         * @type {Boolean}
         * @default false
         */
        preventMouse: false
    },
    handler: function touchGesture(ev, inst) {
        if(inst.options.preventMouse && ev.pointerType == POINTER_MOUSE) {
            ev.stopDetect();
            return;
        }

        if(inst.options.preventDefault) {
            ev.preventDefault();
        }

        if(ev.eventType == EVENT_TOUCH) {
            inst.trigger('touch', ev);
        }
    }
};

/**
 * @module gestures
 */
/**
 * User want to scale or rotate with 2 fingers
 * Preventing the default browser behavior is a good way to improve feel and working. This can be done with the
 * `preventDefault` option.
 *
 * @class Transform
 * @static
 */
/**
 * @event transform
 * @param {Object} ev
 */
/**
 * @event transformstart
 * @param {Object} ev
 */
/**
 * @event transformend
 * @param {Object} ev
 */
/**
 * @event pinchin
 * @param {Object} ev
 */
/**
 * @event pinchout
 * @param {Object} ev
 */
/**
 * @event rotate
 * @param {Object} ev
 */

/**
 * @param {String} name
 */
(function(name) {
    var triggered = false;

    function transformGesture(ev, inst) {
        switch(ev.eventType) {
            case EVENT_START:
                triggered = false;
                break;

            case EVENT_MOVE:
                // at least multitouch
                if(ev.touches.length < 2) {
                    return;
                }

                var scaleThreshold = Math.abs(1 - ev.scale);
                var rotationThreshold = Math.abs(ev.rotation);

                // when the distance we moved is too small we skip this gesture
                // or we can be already in dragging
                if(scaleThreshold < inst.options.transformMinScale &&
                    rotationThreshold < inst.options.transformMinRotation) {
                    return;
                }

                // we are transforming!
                Detection.current.name = name;

                // first time, trigger dragstart event
                if(!triggered) {
                    inst.trigger(name + 'start', ev);
                    triggered = true;
                }

                inst.trigger(name, ev); // basic transform event

                // trigger rotate event
                if(rotationThreshold > inst.options.transformMinRotation) {
                    inst.trigger('rotate', ev);
                }

                // trigger pinch event
                if(scaleThreshold > inst.options.transformMinScale) {
                    inst.trigger('pinch', ev);
                    inst.trigger('pinch' + (ev.scale < 1 ? 'in' : 'out'), ev);
                }
                break;

            case EVENT_RELEASE:
                if(triggered && ev.changedLength < 2) {
                    inst.trigger(name + 'end', ev);
                    triggered = false;
                }
                break;
        }
    }

    Hammer.gestures.Transform = {
        name: name,
        index: 45,
        defaults: {
            /**
             * minimal scale factor, no scale is 1, zoomin is to 0 and zoomout until higher then 1
             * @property transformMinScale
             * @type {Number}
             * @default 0.01
             */
            transformMinScale: 0.01,

            /**
             * rotation in degrees
             * @property transformMinRotation
             * @type {Number}
             * @default 1
             */
            transformMinRotation: 1
        },

        handler: transformGesture
    };
})('transform');

/**
 * @module hammer
 */

// AMD export
if(typeof define == 'function' && define.amd) {
    define(function() {
        return Hammer;
    });
// commonjs export
} else if(typeof module !== 'undefined' && module.exports) {
    module.exports = Hammer;
// browser export
} else {
    window.Hammer = Hammer;
}

})(window);
},{}],31:[function(require,module,exports){
"use strict";
/**
 * Created by Alex on 11/6/2014.
 */

// https://github.com/umdjs/umd/blob/master/returnExports.js#L40-L60
// if the module has no dependencies, the above pattern can be simplified to
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    // AMD. Register as an anonymous module.
    define([], factory);
  } else if (typeof exports === 'object') {
    // Node. Does not work with strict CommonJS, but
    // only CommonJS-like environments that support module.exports,
    // like Node.
    module.exports = factory();
  } else {
    // Browser globals (root is window)
    root.keycharm = factory();
  }
}(this, function () {

  function keycharm(options) {
    var preventDefault = options && options.preventDefault || false;

    var container = options && options.container || window;

    var _exportFunctions = {};
    var _bound = {keydown:{}, keyup:{}};
    var _keys = {};
    var i;

    // a - z
    for (i = 97; i <= 122; i++) {_keys[String.fromCharCode(i)] = {code:65 + (i - 97), shift: false};}
    // A - Z
    for (i = 65; i <= 90; i++) {_keys[String.fromCharCode(i)] = {code:i, shift: true};}
    // 0 - 9
    for (i = 0;  i <= 9;   i++) {_keys['' + i] = {code:48 + i, shift: false};}
    // F1 - F12
    for (i = 1;  i <= 12;   i++) {_keys['F' + i] = {code:111 + i, shift: false};}
    // num0 - num9
    for (i = 0;  i <= 9;   i++) {_keys['num' + i] = {code:96 + i, shift: false};}

    // numpad misc
    _keys['num*'] = {code:106, shift: false};
    _keys['num+'] = {code:107, shift: false};
    _keys['num-'] = {code:109, shift: false};
    _keys['num/'] = {code:111, shift: false};
    _keys['num.'] = {code:110, shift: false};
    // arrows
    _keys['left']  = {code:37, shift: false};
    _keys['up']    = {code:38, shift: false};
    _keys['right'] = {code:39, shift: false};
    _keys['down']  = {code:40, shift: false};
    // extra keys
    _keys['space'] = {code:32, shift: false};
    _keys['enter'] = {code:13, shift: false};
    _keys['shift'] = {code:16, shift: undefined};
    _keys['esc']   = {code:27, shift: false};
    _keys['backspace'] = {code:8, shift: false};
    _keys['tab']       = {code:9, shift: false};
    _keys['ctrl']      = {code:17, shift: false};
    _keys['alt']       = {code:18, shift: false};
    _keys['delete']    = {code:46, shift: false};
    _keys['pageup']    = {code:33, shift: false};
    _keys['pagedown']  = {code:34, shift: false};
    // symbols
    _keys['=']     = {code:187, shift: false};
    _keys['-']     = {code:189, shift: false};
    _keys[']']     = {code:221, shift: false};
    _keys['[']     = {code:219, shift: false};



    var down = function(event) {handleEvent(event,'keydown');};
    var up = function(event) {handleEvent(event,'keyup');};

    // handle the actualy bound key with the event
    var handleEvent = function(event,type) {
      if (_bound[type][event.keyCode] !== undefined) {
        var bound = _bound[type][event.keyCode];
        for (var i = 0; i < bound.length; i++) {
          if (bound[i].shift === undefined) {
            bound[i].fn(event);
          }
          else if (bound[i].shift == true && event.shiftKey == true) {
            bound[i].fn(event);
          }
          else if (bound[i].shift == false && event.shiftKey == false) {
            bound[i].fn(event);
          }
        }

        if (preventDefault == true) {
          event.preventDefault();
        }
      }
    };

    // bind a key to a callback
    _exportFunctions.bind = function(key, callback, type) {
      if (type === undefined) {
        type = 'keydown';
      }
      if (_keys[key] === undefined) {
        throw new Error("unsupported key: " + key);
      }
      if (_bound[type][_keys[key].code] === undefined) {
        _bound[type][_keys[key].code] = [];
      }
      _bound[type][_keys[key].code].push({fn:callback, shift:_keys[key].shift});
    };


    // bind all keys to a call back (demo purposes)
    _exportFunctions.bindAll = function(callback, type) {
      if (type === undefined) {
        type = 'keydown';
      }
      for (var key in _keys) {
        if (_keys.hasOwnProperty(key)) {
          _exportFunctions.bind(key,callback,type);
        }
      }
    };

    // get the key label from an event
    _exportFunctions.getKey = function(event) {
      for (var key in _keys) {
        if (_keys.hasOwnProperty(key)) {
          if (event.shiftKey == true && _keys[key].shift == true && event.keyCode == _keys[key].code) {
            return key;
          }
          else if (event.shiftKey == false && _keys[key].shift == false && event.keyCode == _keys[key].code) {
            return key;
          }
          else if (event.keyCode == _keys[key].code && key == 'shift') {
            return key;
          }
        }
      }
      return "unknown key, currently not supported";
    };

    // unbind either a specific callback from a key or all of them (by leaving callback undefined)
    _exportFunctions.unbind = function(key, callback, type) {
      if (type === undefined) {
        type = 'keydown';
      }
      if (_keys[key] === undefined) {
        throw new Error("unsupported key: " + key);
      }
      if (callback !== undefined) {
        var newBindings = [];
        var bound = _bound[type][_keys[key].code];
        if (bound !== undefined) {
          for (var i = 0; i < bound.length; i++) {
            if (!(bound[i].fn == callback && bound[i].shift == _keys[key].shift)) {
              newBindings.push(_bound[type][_keys[key].code][i]);
            }
          }
        }
        _bound[type][_keys[key].code] = newBindings;
      }
      else {
        _bound[type][_keys[key].code] = [];
      }
    };

    // reset all bound variables.
    _exportFunctions.reset = function() {
      _bound = {keydown:{}, keyup:{}};
    };

    // unbind all listeners and reset all variables.
    _exportFunctions.destroy = function() {
      _bound = {keydown:{}, keyup:{}};
      container.removeEventListener('keydown', down, true);
      container.removeEventListener('keyup', up, true);
    };

    // create listeners.
    container.addEventListener('keydown',down,true);
    container.addEventListener('keyup',up,true);

    // return the public functions.
    return _exportFunctions;
  }

  return keycharm;
}));



},{}]},{},[1])(1)
});