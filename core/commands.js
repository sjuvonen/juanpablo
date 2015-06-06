
var events = require("events");
var Promise = require("promise");

var Command = function(name, perms, callback) {
  this.name = name;
  this.perms = perms;
  this.callback = callback;
  this.allowedUsers = [];
};

Command.ALLOW_ALL = 0;
Command.ALLOW_ADMIN = 1;
Command.ALLOW_AUTHED = 2;
Command.ALLOW_USERS = 3;

Command.prototype = {
  access: function(user) {
    var perms = this.perms;
    var users = this.allowedUsers;

    return new Promise(function(resolve, reject) {
      switch (perms) {
        case Command.ALLOW_ALL:
          return resolve();

        case Command.ALLOW_AUTHED:
          user.whois(function(info) {
            if (info.account) {
              resolve();
            } else {
              reject("You need to auth to use this command");
            }
          });
          break;

        case Command.ALLOW_USERS:
          user.whois(function(info) {
            if (users.indexOf(info.user) >= 0) {
              resolve();
            } else {
              reject("Command is restricted to specified users");
            }
          });
          break;

        default:
          // Default to requiring admin permissions
          console.log("Admin permissions not implemented");
          reject("Admin permissions not implemented");
      }
    });
  },
  execute: function(user, args) {
    return this.callback.apply(null, arguments);
  }
};

var Manager = function() {
  this.commands = {};
  this.events = new events.EventEmitter;
};

Manager.prototype = {
  execute: function(name, user, params) {
    var commands = this.commands;
    var eventManager = this.events;

    return new Promise(function(resolve, reject) {
      if (!(name in commands)) {
        return reject("Unknown command: " + name);
      }

      var command = commands[name];
      var accept = function() {
        console.log("command authed");
        command.execute(user, params).then(resolve, reject);
      };

      command.access(user).then(accept, reject);
    });
  },
  register: function(command) {
    if (command.name in this.commands) {
      throw "Cannot register a command that exists: " + command.name;
    }
    console.log("HEY");
    this.commands[command.name] = command;
    this.events.emit("commands.register", command);
  },
  unload: function(name) {
    if (name in this.commands) {
      this.events.emit("commands.unload", name, this.commands[name]);
      delete this.commands[name];
    }
  }
};

module.exports = {
  Command: Command,
  Manager: Manager,
};
