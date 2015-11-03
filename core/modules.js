"use strict";

let EventEmitter = require("events");
let pathutil = require("path");

class ModuleManager {
  constructor(connection, config) {
    this.connection = connection;
    this.config = config;
    this.events = new EventEmitter;
    this.modules = new Map;
  }

  loadEnabledModules() {
    this.config.modules.forEach(this.load, this);
  }

  load(name) {
    return new Promise(resolve => {
      console.log("load", name);
      let path = pathutil.resolve(name);
      let instance = require(path).configure(this.connection, this);
      this.modules.set(pathutil.basename(name), instance);
      this.events.emit("load", instance);
    }).catch(error => {
      console.error("modules:", error.stack);
      return error;
    });
  }

  get(name) {
    return this.modules.get(name);
  }
}

exports.ModuleManager = ModuleManager;
