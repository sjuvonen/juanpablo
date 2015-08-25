"use strict";

let events = require("events");
let Promise = require("promise");
let util = require("util");

let commands = require("./commands");
let files = require("./files");
let irc = require("./irc");
let modules = require("./modules");
let netUtils = require("./net");

let Bot = function(config) {
  this.shared = {};
  this.config = config;
  this.servers = {};
  this.events = new events.EventEmitter;
  this.commands = new commands.Manager;

  this.modules = new modules.Manager({
    bot: this,
    root: this.config.root,
  });

  this.config.files.root = this.config.root;
  this.files = new files.Storage(this.config.files);

  this.commands.events.on("commands.register", function(command) {
    console.log("NEW COMMAND", command.name);
  });

  this.modules.events.on("modules.load", function(name) {
    console.log("LOAD MODULE", name);
  });

  let bot = this;

  this.addCommand("help", function() {
    return new Promise(function(resolve, reject) {
      let names = Object.keys(bot.commands.commands);
      names.sort();

      let message = "Commands: " + names.join(", ");
      resolve(message);
    });
  });
};

Bot.prototype = {
  net: netUtils,
  start: function() {
    this.events.emit("debug.log", "Starting bot");

    let eventManager = this.events;
    let moduleManager = this.modules;
    let modules = this.config.modules.slice();

    let loadNext = function() {
      if (modules.length) {
        let name = modules.shift();
        moduleManager.load(name).then(loadNext, function(error) {
          console.error("Failed to load module", name, error);
          eventManager.emit("debug.log", "Failed to load module", name, error);
          loadNext();
        });
      } else {
        eventManager.emit("modules.ready");
      }
    };

    loadNext();

    this.config.servers.forEach(function(server) {
      this.addConnection(server);
    }, this);
  },
  addConnection: function(config) {
    let bot = this;
    let connection = new irc.Connection(config);
    this.servers[config.name] = connection;

    connection.connect(function() {
      console.log("connected", arguments.length);
    });

    connection.on("message", function(message) {
      bot.events.emit("message", message);
    });

    connection.on("command", function(message) {
      bot.commands.execute(message.command, message.user, message.commandParams).then(function(result) {
        /*
         * Resolved value can be one of the following:
         *  - Error (exception)
         *  - Array of strings
         *  - Single string
         *  - Special object that defines custom method for replying:
         *    - message [again string or array of strings]
         *    - method [say|notice]
        */

        let reply, method;

        if (result instanceof Error) {
          reply = result.toString();
        } else if (typeof result == "string" || result instanceof Array) {
          reply = result;
        } else if (typeof result == "object") {
          reply = result.message;
          method = result.method;
        }
        message.reply(reply, method);
      }, function(error) {
        if (typeof error == "object") {
          if (error instanceof Error && error.code == 123) {
            error.message += " (see !help)";
          }
          error = error.toString();
        }
        message.reply(error);
      });
    });

    return connection;
  },
  addCommand: function(name, perms, callback) {
    if (arguments.length == 2) {
      callback = perms;
      perms = commands.Command.ALLOW_ALL;
    }
    let command = new commands.Command(name, perms, callback);
    this.commands.register(command);
  },
  spam: function(message) {
    let bot = this;
    Object.keys(this.servers).forEach(function(name) {
      bot.servers[name].amsg(message);
    });
  },

  on: function() {
    this.events.on.apply(this.events, arguments);
  },
};

Object.defineProperties(Bot.prototype, {
  database: {
    get: function() {
      if (!("_db" in this)) {
        let sqlite = require("sqlite3");
        this._db = new sqlite.Database(this.files.toAbsolute("database.sqlite"));
      }
      return this._db;
    }
  }
});

module.exports = {
  Bot: Bot,
};
