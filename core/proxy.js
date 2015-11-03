"use strict";

module.exports = function(callback, context) {
  return function() {
    callback.apply(context, arguments);
  };
};
