
var fs = require("fs");
var Promise = require("promise");
var util = require("util");

var FileStorage = function(config) {
  this.config = config;
};

FileStorage.prototype = {
  openFile: function(name, mode) {

  },
  readFile: function(name) {
    return new Promise(function(resolve, reject) {

    });
  },
  writeFile: function(name, data) {
    return new Promise(function(resolve, reject) {

    });
  },
  toAbsolute: function(name) {
    return util.format("%s/%s", this.root, name);
  },
};

Object.defineProperties(FileStorage.prototype, {
  root: {
    get: function() {
      return util.format("%s/%s", this.config.root, this.config.storage);
    }
  },
});

module.exports = {
  Storage: FileStorage,
};
