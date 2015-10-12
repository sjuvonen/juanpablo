"use strict";

let EventEmitter = require("events");
let irc = require("irc");
let modules = require("./modules");
let util = require("util");

let proxy = function(callback, context) {
  return function() {
    callback.apply(context, arguments);
  }
};

class Bot {
  constructor(config) {
    this.config = config;
    this.connections = new Map;
    this.events = new EventEmitter;
  }

  /**
   * Starts the bot and handles all startup hazzle.
   */
  start() {
    let bot = this;
    return new Promise(resolve => {
      bot.events.emit("start");
      bot.connect();

      setTimeout(resolve, 100);
    })
  }

  /**
   * Connect to servers and join channels.
   */
  connect() {
    this.config.servers.forEach(this.addConnection, this);
  }

  addConnection(config) {
    if (!("modules" in config)) {
      config.modules = this.config.modules.slice();
    }
    return this.connections
      .set(config.name, new Connection(config))
      .get(config.name).connect();
  }
}

/**
 * Connection to a server.
 *
 * Each connection handles its channels and messages autonomously.
 */
class Connection {
  constructor(config) {
    config.autoConnect = false;

    this.config = config;
    this.events = new EventEmitter;
    this.channels = new Map;

    this.messages = new MessageQueue;
    this.messages.events.on("send", proxy(this.doSend, this));

    this.modules = new modules.ModuleManager(this, {modules: this.config.modules});
    this.modules.events.on("load", proxy(this.onLoadModule, this));

    this.commands = new modules.CommandManager;
    this.events.on("command", proxy(this.onCommand, this));
  }

  /**
   * Connect to the server and join the channels as per configuration.
   */
  connect() {
    let connection = this;
    return new Promise(resolve => {
      connection.modules.loadEnabledModules();
      connection.client.connect(5, raw => {
        let data = {server: raw.server, nick: raw[0]};
        connection.events.emit("connect", data);
        resolve(data);
      });
    });
  }

  /**
   * Join one or multiple channels. Accepts a string or array of strings.
   */
  join(channels) {
    let connection = this;
    return new Promise(resolve => {
      if (!Array.isArray(channels)) {
        channels = [channels];
      }
      connection.client.join(channels.join(","), (raw) => {
        this.nick = raw.nick;
        resolve();
      });
    });
  }

  /**
   * Queue a message to be sent to the server.
   */
  message(to, content) {
    this.send("message", to, content);
  }

  /**
   * Queue a notice to be sent to the server.
   */
  notice(to, content) {
    this.send("notice", to, content);
  }

  /**
   * Generic method for queueing any type of message to be sent to the server.
   */
  send(type, to, content) {
    this.messages.send({to: to, content: content, type: type});
  }

  addCommand(name, permissions, callback) {
    this.commands.add.apply(this.commands, arguments);
  }

  /**
   * Send a message to the server instantly. Triggered by the queue's event listener.
   */
  doSend(type, to, content) {
    if (type == "message") {
      type = "say";
    }
    this.client[type].call(this.client, to, content);
  }

  onCommand(message) {
    let command = this.commands.get(message.command);
    command.access(message.user).then(() => {
      command.execute(message.user, message.params).then(result => {
        console.log("Command ok", result);
        message.reply(result);
      }, error => {
        console.log("ERROR2", error);
      });
    }, error => {
      console.error("ERROR", error);
    });
  }

  get client() {
    if (!("_client" in this)) {
      this._client = new irc.Client(this.host, this.nick, this.config);
      // this.client.message = this.client.say;

      let connection = this;
      let events = this.events;

      this._client.on("error", function(raw) {
        events.emit("error", raw);
      });

      this._client.on("join", function(channel, nick, raw) {
        if (nick == connection.nick) {
          console.log("JOINED", channel);
          events.emit("join", {channel: channel});
        }

        setTimeout(function() {
          connection.message(channel, "TEST ONE TWO " + channel);
        }, 5000);
      });

      this._client.on("message", function(nick, to, content, raw) {
        let message = new Message(raw, connection);
        events.emit(message.type == Message.MESSAGE ? "message" : "command", message);
      });

      this._client.on("notice", function(nick, to, message, raw) {
        events.emit("notice", {nick: nick, to: to, message: message});
      });
    }
    return this._client;
  }

  get name() {
    return this.config.name;
  }

  get host() {
    return this.config.host;
  }

  get nick() {
    return this._nick || this.config.nick;
  }

  set nick(nick) {
    this._nick = nick;
  }
}

/**
 * Message received from the server.
 */
class Message {
  /**
   * Type code for regular messages
   */
  static get MESSAGE() {
    return 1;
  };

  /**
   * Type code for bot commands
   */
  static get COMMAND() {
    return 2;
  };

  constructor(meta, connection) {
    this.meta = meta;
    this.connection = connection;
  }

  /**
   * Send a response to where the original message came from (channel or user).
   */
  reply(reply) {
    if (typeof reply != "object") {
      reply = {
        type: "message",
        content: reply,
      };
    }
    let to = reply.type == "notice" || this.pm ? this.from : this.to;
    this.connection[reply.type || "message"].call(this.connection, to, reply.content);
  }

  get nick() {
    return this.meta.nick;
  }

  get to() {
    return this.meta.args[0];
  }

  get host() {
    return this.meta.host;
  }

  get content() {
    return this.meta.args[1];
  }

  get pm() {
    // Message is a private message when target is not a channel
    return ["#", "!"].indexOf(this.to[0]) == -1;
  }

  get type() {
    return (this.content.length >= 3 && this.content[0] == "!" && this.content[1] != "!") ? Message.COMMAND : Message.MESSAGE;
  }

  get command() {
    if (this.type == Message.COMMAND) {
      return this.content.split(" ", 1)[0].substring(1);
    }
  }

  get params() {
    if (this.type == Message.COMMAND) {
      return this.content.split(/\s+/).slice(1);
    }
  }
}

class Reply {
  constructor(content, type) {
    this.content = content;
    this.type = type || "message";
  }

  toString() {

  }
}

/**
 * Takes care of delaying messages so that the bot won't flood the server.
 *
 * This implementation will not actually send anything by itself, instead
 * the queue will trigger 'send' events that the backend should listen to.
 */
class MessageQueue {
  constructor(config) {
    this.config = config || {};
    this.events = new EventEmitter;
    this.messages = [];
    this.timer = null;
  }

  /**
   * Queues a message to be sent.
   */
  send(message) {
    this.messages.push(message);
    if (!this.started) {
      this.start();
    }
  }

  /**
   * Triggers the next message with no delay and removes it from the queue.
   */
  next() {
    if (this.length) {
      let message = this.messages.shift();
      this.events.emit("send", message.type, message.to, message.content);
    }
  }

  /**
   * Starts the queue.
   */
  start() {
    let queue = this;
    let next = function() {
      if (queue.messages.length) {
        queue.next();
        queue.timer = setTimeout(next, queue.delay);
      } else {
        queue.stop();
      }
    };
    next();
  }

  /**
   * Stop queue; sending messages will halt instantly.
   */
  stop() {
    if (this.started) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  get delay() {
    return this.config.delay || 1200;
  }

  get started() {
    return this.timer != null;
  }

  get length() {
    return this.messages.length;
  }
}

exports.Bot = Bot;
