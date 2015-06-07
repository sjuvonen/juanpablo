
var events = require("events");
var irc = require("irc");
var Promise = require("promise");
var util = require("util");

var commands = require("./commands");
var ignores = require("./ignores");
var modules = require("./modules");
var netUtils = require("./net");
var User = require("./user");

var Bot = function(config) {
  console.log("Bot()");

  this.events = new events.EventEmitter;
  this.config = config;
  this.servers = {};

  this.commands = new commands.Manager;

  this.modules = new modules.Manager({
    bot: this,
    root: this.config.root,
  });

  this.commands.events.on("commands.register", function(command) {
    console.log("NEW COMMAND", command.name);
  });

  this.modules.events.on("modules.load", function(name) {
    console.log("LOAD MODULE", name);
  });

  var bot = this;

  this.addCommand("commands", function() {
    return new Promise(function(resolve, reject) {
      var names = Object.keys(bot.commands.commands);
      names.sort();

      var message = "Available commands: " + names.join(", ");
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
    var connection = new Connection(config);
    this.servers[config.name] = connection;

    connection.connect(function() {
      console.log("connected", arguments.length);
    });

    connection.on("message", function(message) {
      bot.events.emit("message", message);
    });

    connection.on("command", function(message) {
      bot.commands.execute(message.command, message.user, ["foo", "bar"]).then(function(result) {
        message.reply(result);
      }, function(error) {
        error += " (see !commands)";
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

  on: function() {
    this.events.on.apply(this.events, arguments);
  },

  spam: function(message) {
    var bot = this;
    Object.keys(this.servers).forEach(function(name) {
      bot.servers[name].amsg(message);
    });
  }
};

var Connection = function(config) {
  var copy = Object.create(config);
  copy.autoConnect = false;

  this.config = config;
  this.ignores = new ignores.Manager;
  this.client = new irc.Client(this.host, this.nick, copy);
  this.events = new events.EventEmitter;
  this.channels = [];
  this.userCache = new UserCache(this);
  this.messageQueue = new MessageQueue({
    interval: 500,
    client: this.client,
  });

  var connection = this;
  this.client.on("message", function(from, to, content, raw) {
    if (!connection.isIgnored(raw)) {
      var message = new Message(from, to, content.trim(), connection);

      switch (message.type) {
        case Message.COMMAND:
          connection.emit("command", message);
          break;

        default:
          connection.emit("message", message);
          break;
      }
    } else {
      console.log("IGNORED", raw.nick, raw.user, raw.host);
    }
  });

  this.client.on("join", function(channel, nick, raw) {
    if (nick == connection.nick) {
      console.log("Joined", channel);
      connection.channels.push(channel);
    }
  });

  this.client.on("kick", function(channel, nick, by, reason, raw) {
    if (nick == connection.nick) {
      console.warn("Kicked from", channel);
      var i = connection.channels.indexOf(channel);
      if (i >= 0) {
        connection.channels.splice(i, 1);
      }
    }
  });
};

Connection.prototype = {
  isIgnored: function(info) {
    return this.ignores.isIgnored(info);
  },
  connect: function() {
    var connection = this;
    this.client.connect(5, function(raw) {
      console.log(util.format("CONNECTED TO %s AS %s", raw.server, raw.args[0]));
    });
  },
  login: function(name, password) {

  },
  join: function(channel, password) {
    if (password) {
      channel += " " + password;
    }
    var client = this.client;
    return new Promise(function(resolve, reject) {
      client.join(channel, function() {
        resolve();
      });
    });
  },
  part: function(channel) {

  },
  say: function(to, text) {
    this.messageQueue.push({to: to, content: text});
  },
  whois: function(nick, callback) {
    console.log("WHOIS", nick);
    var info = this.userCache.get(nick);

    if (info) {
      process.nextTick(function() {
        callback(user);
      });
    } else {
      var cache = this.userCache;
      this.client.whois(nick, function(info) {
        cache.set(nick, info);
        callback(info);
      });
    }
  },
  on: function() {
    return this.events.on.apply(this.events, arguments);
  },
  emit: function() {
    return this.events.emit.apply(this.events, arguments);
  },
  amsg: function(message) {
    console.log("AMGS TO", this.channels.join(","));

    var connection = this;
    this.channels.forEach(function(channel) {
      connection.say(channel, message);
    });
  },
};

Object.defineProperties(Connection.prototype, {
  id: {
    get: function() {
      return this.config.name;
    }
  },
  nick: {
    get: function() {
      return this.config.nick;
    }
  },
  host: {
    get: function() {
      return this.config.host;
    }
  },
  user: {
    get: function() {
      return this.config.user;
    }
  },
});

var Message = function(from, to, content, server) {
  this.from = from;
  this.to = to;
  this.content = content;
  this.server = server;
};

Message.MESSAGE = 1;
Message.COMMAND = 2;

Message.prototype = {
  reply: function(msg) {
    if (typeof msg == "string") {
      msg = [msg];
    }

    var message = this;

    msg.forEach(function(row) {
      message.server.say(message.pm ? message.from : message.to, row);
    });
  }
};

Object.defineProperties(Message.prototype, {
  pm: {
    get: function() {
      return ["#", "!"].indexOf(this.to[0]) == -1;
    }
  },
  type: {
    get: function() {
      return this.content[0] == "!" ? Message.COMMAND : Message.MESSAGE;
    }
  },
  command: {
    get: function() {
      if (this.type == Message.COMMAND) {
        var parts = this.content.split(" ", 2);
        return parts[0].substring(1);
      }
    }
  },
  user: {
    get: function() {
      return new User(this.from, this.server);
    }
  },
});

var UserCache = function(server) {
  this.decay = 60;
  this.users = {};
};

UserCache.prototype = {
  get: function(nick) {
    var info = this.users[nick.toLowerCase()];

    if (info) {
      if ((Date.now() - this.users[nick].timestamp) < (this.decay * 1000)) {
        return info;
      } else {
        this.remove(nick);
      }
    }
  },
  set: function(nick, info) {
    info.timestamp = Date.now();
    this.users[nick.toLowerCase()] = info;
  },
  remove: function(nick) {
    delete this.users[nick.toLowerCase()];
  },
};

module.exports = {
  Bot: Bot,
  Connection: Connection,
  Message: Message,
};

var MessageQueue = function(options) {
  this.queue = [];
  this.client = options.client;
  this.delay = options.interval;
  this.timer = 0;
}

MessageQueue.prototype = {
  start: function() {
    if (this.timer) {
      throw new Error("Queue already active");
    }

    var queue = this;
    this.timer = setInterval(function() {
      queue.next();
    }, this.delay);
  },
  push: function(message) {
    this.queue.push(message);
    if (!this.timer) {
      this.start();
    }
  },
  next: function() {
    if (!this.queue.length) {
      return false;
    }
    var message = this.queue.shift();
    this.client.say(message.to, message.content);
  }
};
