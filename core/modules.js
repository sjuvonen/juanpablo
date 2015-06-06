
var events = require("events");
var Promise = require("promise");

var Manager = function(options) {
  this.config = options;
  this.bot = options.bot;
  this.events = new events.EventEmitter;
  this.modules =  {};
};

Manager.prototype = {
  load: function(name) {
    var eventManager = this.events;
    var config = this.config;

    return new Promise(function(resolve) {
      var real = name.replace(/^\.\//, config.root + "/");
      var module = require(real);

      module.initialize(config.bot);

      eventManager.emit("modules.load", name, module);
      resolve(name, module);
    });
  },
  unload: function(name) {
    console.error("Unloading modules not implemented");
  }
};

module.exports = {
  Manager: Manager,
};
