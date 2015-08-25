"use strict";

let events = require("events");
let irc = require("irc");
let Promise = require("promise");
let util = require("util");

let ignores = require("./ignores");
let User = require("./user");

let Connection = function(config) {
  let copy = Object.create(config);
  copy.autoConnect = false;

  this.config = config;
  this.ignores = new ignores.Manager;
  this.client = new irc.Client(this.host, this.nick, copy);
  this.events = new events.EventEmitter;
  this.channels = [];
  this.userCache = new UserCache(this);
  this.messageQueue = new MessageQueue({
    interval: 1000,
    client: this.client,
  });

  let connection = this;
  this.client.on("message", function(from, to, content, raw) {
    if (!connection.isIgnored(raw)) {
      let message = new Message(from, to, content.trim(), connection);

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
      if (connection.channels.indexOf(channel) == -1) {
        connection.channels.push(channel);
      }
    }
  });

  this.client.on("kick", function(channel, nick, by, reason, raw) {
    if (nick == connection.nick) {
      console.warn("Kicked from", channel);
      let i = connection.channels.indexOf(channel);
      if (i >= 0) {
        connection.channels.splice(i, 1);
      }
    }
  });

  this.client.on("error", function(error) {
    console.error("connection error", error);
  });
};

Connection.prototype = {
  isIgnored: function(info) {
    return this.ignores.isIgnored(info);
  },
  connect: function() {
    let connection = this;
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
    let client = this.client;
    return new Promise(function(resolve, reject) {
      client.join(channel, function() {
        resolve();
      });
    });
  },
  notice: function(to, text) {
    this.messageQueue.push({to: to, content: text, method: "notice"});
  },
  part: function(channel) {

  },
  say: function(to, text) {
    this.messageQueue.push({to: to, content: text, method: "say"});
  },
  whois: function(nick) {
    let server = this;
    return new Promise(function(resolve, reject) {
      let info = server.userCache.get(nick);

      if (info) {
        process.nextTick(function() {
          resolve(info);
        });
      } else {
        let cache = server.userCache;
        server.client.whois(nick, function(info) {
          cache.set(nick, info);
          resolve(info);
        });
      }
    });
  },
  amsg: function(message) {
    this.channels.forEach(function(channel) {
      this.say(channel, message);
    }, this);
  },

  on: function() {
    return this.events.on.apply(this.events, arguments);
  },
  emit: function() {
    return this.events.emit.apply(this.events, arguments);
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

let Message = function(from, to, content, server) {
  this.from = from;
  this.to = to;
  this.content = content;
  this.server = server;
};

Message.MESSAGE = 1;
Message.COMMAND = 2;

Message.prototype = {
  reply: function(msg, method) {
    if (msg instanceof Error) {
      msg = msg.toString();
    }
    if (typeof msg == "string") {
      msg = [msg];
    }
    if (!method) {
      method = "say";
    }

    let message = this;
    let to = (message.pm || method != "say") ? message.from : message.to;

    msg.forEach(function(row) {
      message.server[method || "say"].call(message.server, to, row);
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
      return this.content.match(/^!\w\w/) ? Message.COMMAND : Message.MESSAGE;
    }
  },
  command: {
    get: function() {
      if (this.type == Message.COMMAND) {
        let parts = this.content.split(" ", 1);
        return parts[0].substring(1);
      }
    }
  },
  commandParams: {
    get: function() {
      if (this.type == Message.COMMAND) {
        return this.content.split(/\s+/).slice(1);
      }
    }
  },
  user: {
    get: function() {
      return new User(this.from, this.server);
    }
  },
});

let UserCache = function(server) {
  this.decay = 30;
  this.users = {};
};

UserCache.prototype = {
  get: function(nick) {
    let info = this.users[nick.toLowerCase()];

    if (info) {
      if ((Date.now() - info.timestamp) < (this.decay * 1000)) {
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

let MessageQueue = function(options) {
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

    let queue = this;
    this.next();

    this.timer = setInterval(function() {
      queue.next();

      if (!queue.queue.length) {
        queue.stop();
      }
    }, this.delay);
  },
  stop: function() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
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
    let message = this.queue.shift();
    this.client[message.method].call(this.client, message.to, message.content);
  }
};

module.exports = {
  Connection: Connection,
  Message: Message,
};
