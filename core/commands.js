"use strict";

let EventEmitter = require("events");
let util = require("util");

class CommandManager {
  constructor() {
    this.events = new EventEmitter;
    this.commands = new Map;

    this.add("help", () => {
      let keys = [...this.commands.keys()].sort();
      return Promise.accept("Available commands: " + keys.join(", "));
    });
  }

  delete(name) {
    this.commands.delete(name);
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

  access(user) {
    return new Promise((resolve, reject) => {
      switch(this.permissions) {
        case Command.ALLOW_ALL:
          return resolve();

        case Command.ALLOW_AUTHED:
          user.whois().then(info => {
            info.account ? resolve() : reject(new Error("You need to auth to use this command"));
          }, reject);
          break;

        case Command.ALLOW_ADMIN:
          return reject(new Error("AdminAuth mechanism not supported."));

        case Command.ALLOW_USERS:
          return reject(new Error("WhitelistAuth mechanism not supported."));
      }
    });
  }

  execute(user, params, message) {
    return this.callback(user, params, message);
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

exports.Command = Command;
exports.CommandManager = CommandManager;
