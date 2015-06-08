
var events = require("events");
var Promise = require("promise");
var util = require("util");

var commands = require("./commands");
var files = require("./files");
var irc = require("./irc");
var modules = require("./modules");
var netUtils = require("./net");

var Bot = function(config) {
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

  var bot = this;

  this.addCommand("help", function() {
    return new Promise(function(resolve, reject) {
      var names = Object.keys(bot.commands.commands);
      names.sort();

      var message = "Commands: " + names.join(", ");
      resolve(message);
    });
  });
};

Bot.prototype = {
  net: netUtils,
  start: function() {
    this.events.emit("debug.log", "Starting bot");

    var eventManager = this.events;
    var moduleManager = this.modules;
    var modules = this.config.modules.slice();

    var loadNext = function() {
      if (modules.length) {
        var name = modules.shift();
        moduleManager.load(name).then(loadNext, function(error) {
          console.error("Failed to load module", name, error);
          eventManager.emit("debug.log", "Failed to load module", name, error);
          loadNext();
        });
      }

      eventManager.emit("modules.ready");
    };

    loadNext();

    this.config.servers.forEach(function(server) {
      this.addConnection(server);
    }, this);
  },
  addConnection: function(config) {
    var bot = this;
    var connection = new irc.Connection(config);
    this.servers[config.name] = connection;

    connection.connect(function() {
      console.log("connected", arguments.length);
    });

    connection.on("message", function(message) {
      bot.events.emit("message", message);
    });

    connection.on("command", function(message) {
      bot.commands.execute(message.command, message.user, message.commandParams).then(function(result) {
        message.reply(result);
      }, function(error) {
        if (error instanceof Error && error.code == 123) {
          error = error.toString() + " (see !help)";
        }
        message.reply(error);
      });
    });

    return connection;
  },
  addCommand: function(name, perms, command) {
    if (arguments.length == 2) {
      command = perms;
      perms = commands.Command.ALLOW_ALL;
    }
    var command = new commands.Command(name, perms, command);
    this.commands.register(command);
  },
  spam: function(message) {
    var bot = this;
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
        var sqlite = require("sqlite3");
        this._db = new sqlite.Database(this.files.toAbsolute("database.sqlite"));
      }
      return this._db;
    }
  }
});

module.exports = {
  Bot: Bot,
};
