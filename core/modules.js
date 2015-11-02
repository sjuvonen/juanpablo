"use strict";

let EventEmitter = require("events");
let pathutil = require("path");
let util = require("util");

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
    let manager = this;
    return new Promise(resolve => {
      console.log("load", name);
      let path = pathutil.resolve(name);
      let instance = require(path).configure(this.connection, this);
      manager.modules.set(name, instance);
      manager.events.emit("load", instance);
    }.catch(error => {
      console.error("modules:", error.stack);
      return error;
    });
  }

  get(name) {
    return this.modules.get(name);
  }
}

class CommandManager {
  constructor() {
    this.events = new EventEmitter;
    this.commands = new Map;

    let commands = this.commands;
    this.add("help", () => {
      let keys = [];
      for (let key of commands.keys()) {
        if (key != "help") {
          keys.push(key);
        }
      }
      return Promise.accept("Available commands: " + keys.join(", "));
    });
  }

  add(name, permissions, callback) {
    if (this.commands.has(name)) {
      throw new Error(util.format("Command %s is already registered", name));
    }
    if (arguments.length == 2) {
      callback = permissions;
      permissions = Command.ALLOW_ALL;
    }
    let command = new Command(name, permissions, callback);
    this.commands.set(name, command);
  }

  get(name) {
    if (this.commands.has(name)) {
      return this.commands.get(name);
    } else {
      throw new Error(util.format("Unknown command '%s'", name));
    }
  }
}

class Command {
  constructor(name, permissions, callback) {
    this.name = name;
    this.permissions = arguments.length > 2 ? arguments[1] : Command.ALLOW_ALL;
    this.callback = arguments.length > 2 ? arguments[2] : arguments[1];
  }

  access() {
    let command = this;
    return new Promise((resolve, reject) => {
      switch(command.permissions) {
        case Command.ALLOW_ALL:
          return resolve();

        case Command.ALLOW_AUTHED:
          // user.auth()...
          return resolve();

        case Command.ALLOW_ADMIN:
          return resolve();

        case Command.ALLOW_USERS:
          return resolve();
      }
    });
  }

  execute(user, params) {
    return this.callback(user, params);
  }
}

/**
 * Command is allowed to everyone.
 */
Command.ALLOW_ALL = 0;

/**
 * Command is allowed to admins only.
 */
Command.ALLOW_ADMIN = 1;

/**
 * Command is allowed to users who have authed to the server.
 */
Command.ALLOW_AUTHED = 2;

/**
 * Command is allowed to users specified in configuration.
 */
Command.ALLOW_USERS = 3;

exports.ModuleManager = ModuleManager;
exports.CommandManager = CommandManager;
