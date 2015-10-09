"use strict";

let events = require("events");
let irc = require("irc");
let path = require("path");
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
    this.events = new events.EventEmitter;
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
    let bot = this;
    let connection = new Connection(config);
    this.connections.set(config.name, connection);

    return connection.connect();
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
    this.events = new events.EventEmitter;
    this.channels = new Map;
    this.messages = new MessageQueue;
    this.messages.events.on("send", proxy(this.doSend, this));
  }

  /**
   * Connect to the server and join the channels as per configuration.
   */
  connect() {
    let connection = this;
    return new Promise(resolve => {
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
      connection.client.join(channels.join(","), (foo) => {
        console.log("JOINED", foo);
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

  onError(raw) {
    console.error("CONNECTION ERROR", raw);
  }

  onJoin(channel, nick, raw) {
    if (nick == this.nick) {
      console.log("JOINED", channel);
      this.events.emit("join", {channel: channel});
    }
  }

  onMessage(nick, to, content, raw) {
    let message = new Message(nick, to, content, raw);
  }

  onNotice(nick, to, content, raw) {

  }

  /**
   * Send a message to the server instantly. Triggered by the queue's event listener.
   */
  doSend(type, to, content) {
    this.client[type].call(this.client, to, content);
  }

  get client() {
    if (!("_client" in this)) {
      this._client = new irc.Client(this.host, this.nick, this.config);
      this.client.message = this.client.say;

      let connection = this;
      let events = this.events;

      this._client.on("error", function(raw) {
        connection.onError(raw);
      });

      this._client.on("join", function(channel, nick, raw) {
        connection.onJoin(channel, nick, raw);

        setTimeout(function() {
          connection.message(channel, "TEST ONE TWO " + channel);
        }, 5000);
      });

      this._client.on("message", function(nick, to, content, raw) {
        connection.onMessage(nick, to, content, raw);
      });

      this._client.on("notice", function(nick, to, message, raw) {
        connection.onNotice(nick, to, message, raw);
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
    return this.config.nick;
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

  constructor(from, to, content, connection) {
    this.from = from;
    this.to = to;
    this.content = content;
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
    this.events = new events.EventEmitter;
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
    return this.config.delay || 1500;
  }

  get started() {
    return this.timer != null;
  }

  get length() {
    return this.messages.length;
  }
}

exports.Bot = Bot;
