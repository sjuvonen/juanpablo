"use strict";

let EventEmitter = require("events");
let irc = require("irc");
let CommandManager = require("./commands").CommandManager;
let modules = require("./modules");
let util = require("util");
let proxy = require("./proxy");

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
      config.modules = Object.create(this.config.modules);
    }
    config.database = Object.create(this.config.database);
    return this.connections
      .set(config.name, new Connection(config))
      .get(config.name).connect();
  }
}

class UserCache {
  constructor(config) {
    this.nickCache = new Map;
    this.hostCache = new Map;
    this.authCache = new Map;

    this.config = config || {};
    this.timers = {};

    // if (this.config.expire > 0) {
    //   this.timers.expire = setInterval(() => {
    //     let now = new Date;
    //     this.cache.forEach((info, nick) => {
    //       if (now - info.timestamp > (this.config.expire * 1000)) {
    //         this.cache.delete(nick);
    //       }
    //     })
    //   }, this.config.expire);
    // }
  }

  findOrCreate(raw, connection) {
    if (raw.account && this.findByAuth(raw.account)) {
      return this.findByAuth(raw.account);
    }

    if (raw.host && this.findByHostInfo(raw.user, raw.host)) {
      return this.findByHostInfo(raw.user, raw.host);
    }

    if (raw.nick && this.findByNick(raw.nick)) {
      return this.findByNick(raw.nick);
    }

    let user = new User(raw, connection);
    this.cacheByNick(raw.nick);
    this.cacheByHost(user.user, user.host, user);
    this.cacheByAuth(user.account, user);
    return user;
  }

  cacheByNick(nick, info) {
    if (nick && info) {
      this.nickCache.set(nick.toLowerCase(), info);
    }
  }

  cacheByAuth(auth, info) {
    if (auth && info) {
      this.authCache.set(auth, info);
    }
  }

  cacheByHost(user, host, info) {
    if (user && host && info) {
      this.hostCache.set(util.format("%s@%s", user, host), info);
    }
  }

  findByNick(nick) {
    return this.nickCache.get(nick);
  }

  findByAuth(auth) {
    return this.authCache.get(auth);
  }

  findByHostInfo(user, host) {
    return this.hostCache.get(util.format("%s@%s", user, host));
  }

  /**
   * @deprecated
   */
  get(nick) {
    return this.findByNick(nick);
  }

  /**
   * @deprecated
   */
  set(nick, info) {
    this.nickCache.set(nick.toLowerCase(), info);
  }
}

/**
 * Execute an IRC command and handle its multi-line response.
 */
class RawCommandWrapper {
  static create(client, config) {
    return (new RawCommandWrapper(client, config)).run();
  }

  constructor(client, config) {
    this.client = client;
    this.config = config;

    Object.defineProperty(this, "meta", {
      enumerable: false,
      value: {}
    });

    this.meta.result = [];
    this.meta.events = new EventEmitter;
  }

  get events() {
    return this.meta.events;
  }

  get result() {
    return this.meta.result;
  }

  run() {
    return new Promise((resolve, reject) => {
      this.init();
      this.events.once("finish", result => {
        this.client.removeListener("finish", this.proxy());
        this.client.removeListener("error", this.proxy());
        resolve(result);
      });
      this.events.once("error", error => {
        this.client.removeListener("finish", this.proxy());
        this.client.removeListener("error", this.proxy());
        reject(error);
      });
    });
  }

  onMessage(raw) {
    let value = this.filter(raw);
    if (value) {
      this.result.push(value);
    }

    if (this.finish(raw)) {
      this.events.emit("finish", this.meta.result);
      return;
    }
  }

  init() {
    if (this.handler("init")) {
      this.handler("init")();
    }
    this.client.on("raw", this.proxy());
  }

  handler(id) {
    return this.config[id];
  }

  finish(raw) {
    return this.handler("finish") != null && this.handler("finish")(raw);
  }

  filter(raw) {
    if (this.handler("filter")) {
      return this.handler("filter")(raw);
    } else {
      return raw;
    }
  }

  proxy() {
    if (!("_proxy" in this)) {
      this._proxy = proxy(this.onMessage, this);
    }
    return this._proxy;
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
    // config.debug = true;

    this.config = config;
    this.events = new EventEmitter;
    this.channels = new Set;

    this.messages = new MessageQueue;
    this.messages.events.on("send", proxy(this.doSend, this));

    this.modules = new modules.ModuleManager(this, {modules: this.config.modules.enabled});
    // this.modules.events.on("load", proxy(this.onLoadModule, this));

    this.commands = new CommandManager;
    this.events.on("command", proxy(this.onCommand, this));

    this.whoisCache = new UserCache({expire: 300});
    this.userCache = new UserCache({expire: 300});

    /**
     * NOTE: EventEmitter requires at least one error listener or *crash*
     */
    this.events.on("error", raw => {
      // console.error("connection.error:", raw);
    });
  }

  /**
   * Connect to the server and join the channels as per configuration.
   */
  connect() {
    return new Promise(resolve => {
      this.modules.loadEnabledModules();
      this.client.connect(5, raw => {
        let data = {server: raw.server, nick: raw[0]};
        this.events.emit("connect", data);
        resolve(data);
      });
    });
  }

  /**
   * Query info about users on a channel.
   *
   * NOTE: Unlike the IRC protocol, this command only allows who'ing a channel.
   */
  who(channel) {
    if (["#", "!"].indexOf(channel[0]) == -1) {
      return Promise.reject("Invalid channel");
    }
    return RawCommandWrapper.create(this.client, {
      init: () => {
        this.client.send("WHO", channel);
      },
      finish: raw => {
        return raw.command == "rpl_endofwho";
      },
      filter: raw => {
        if (raw.command == "rpl_whoreply") {
          console.log
          return {
            // self: raw.args[0],
            // server: raw.args[4],

            channel: raw.args[1],
            user: raw.args[2],
            host: raw.args[3],
            nick: raw.args[5],

            // H := here; G := gone
            status: raw.args[6][0],

            // @ := op; + := voice, null := none
            mode: raw.args[6][1] || null,
          };
        }
      }
    });
  }

  whois(nick) {
    if (this.whoisCache.get(nick)) {
      return Promise.resolve(this.whoisCache.get(nick));
    }
    return new Promise((resolve, reject) => {
      this.client.whois(nick, info => {
        info.timestamp = new Date;
        this.whoisCache.set(nick, info);
        resolve(info);
      });
    });
  }

  /**
   * Join one or multiple channels. Accepts a string or array of strings.
   */
  join(channels) {
    return new Promise(resolve => {
      if (!Array.isArray(channels)) {
        channels = [channels];
      }
      this.client.join(channels.join(","), (raw) => {
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
   * Message all channels.
   */
  amsg(message) {
    this.channels.forEach(channel => {
      this.message(channel, message);
    });
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
    try {
      let command = this.commands.get(message.command);
      command.access(message.user)
        .then(() => command.execute(message.user, message.params))
        .then(result => message.reply(result))
        .catch(error => message.reply(error.toString()));
    } catch (error) {
      message.reply(error.toString());
      console.error("connection.onCommand:", error.stack);
    }
  }

  get client() {
    if (!("_client" in this)) {
      this._client = new irc.Client(this.host, this.nick, this.config);

      // this._client.on("raw", raw => {
      //   if (raw.command != "PING") {
      //     console.log("RAW", raw);
      //   }
      // });

      this._client.on("error", raw => {
        console.error("client error:", raw);
        this.events.emit("error", raw);
      });

      this._client.on("join", (channel, nick, raw) => {
        if (nick == this.nick) {
          return this.channels.add(channel.toLowerCase());
        }
        this.events.emit("join", {
          // nick: nick,
          user: this.userCache.findOrCreate(raw, this),
          channel: channel,
          raw: raw,
        });
      });

      this._client.on("message", (nick, to, content, raw) => {
        let message = new Message(raw, this);
        this.events.emit("message", message);

        if (message.type == Message.COMMAND) {
          this.events.emit("command", message);
        }
      });

      this._client.on("notice", (nick, to, message, raw) => {
        this.events.emit("notice", {nick: nick, to: to, message: message});
      });

      this._client.on("kick", (channel, nick, by, reason, raw) => {
        this.events.emit("kick", {
          // nick: nick,
          user: this.userCache.findOrCreate(raw, this),
          channel: channel,
          by: by,
          reason: reason,
          raw: raw
        });
      });

      this._client.on("part", (channel, nick, reason, raw) => {
        this.events.emit("part", {
          // nick: nick,
          user: this.userCache.findOrCreate(raw, this),
          channel: channel,
          reason: reason,
          raw: raw,
        });
      });

      this._client.on("quit", (nick, reason, channels, raw) => {
        this.events.emit("quit", {
          // nick: nick,
          user: this.userCache.findOrCreate(raw, this),
          reason: reason,
          channels: channels,
          raw: raw
        });
      });

      this._client.on("kill", (nick, reason, channels, raw) => {
        this.events.emit("kill", {
          // nick: nick,
          user: this.userCache.findOrCreate(raw, this),
          reason: reason,
          channels: channels,
          raw: raw,
        });
      });

      this._client.on("nick", (oldnick, newnick, channels, raw) => {
        this.events.emit("nick", {
          // nick: newnick,
          user: this.userCache.findOrCreate(raw, this),
          oldNick: oldnick,
          channels: channels,
          raw: raw,
        });
      });

      this._client.on("action", (nick, to, text, raw) => {
        this.events.emit("action", {
          // nick: nick,
          user: this.userCache.findOrCreate(raw, this),
          to: to,
          text: text,
          raw: raw,
        });
      });

      this._client.on("topic", (channel, topic, nick, raw) => {
        /*
         * NOTE: Cannot use 'user' here as only the nick is provided
         */
        this.events.emit("topic", {
          nick: nick,
          user: raw.host ? this.userCache.findOrCreate(raw, this) : null,
          channel: channel,
          topic: topic,
          raw: raw,
        });
      });

      this._client.on("-mode", (channel, by, mode, target, raw) => {
        if (["v", "o"].indexOf(mode) >= 0 && target) {
          let event_id = mode == "o" ? "unop" : "unvoice";
          this.events.emit(event_id, {
            // nick: target,
            user: this.userCache.findOrCreate(raw, this),
            channel: channel,
            by: by,
            mode: mode,
            raw: raw,
          });
        }
      });

      this._client.on("+mode", (channel, by, mode, target, raw) => {
        if (["v", "o"].indexOf(mode) >= 0 && target) {
          let event_id = mode == "o" ? "op" : "voice";
          this.events.emit(event_id, {
            // nick: target,
            user: this.userCache.findOrCreate(raw, this),
            channel: channel,
            target: target,
            mode: mode,
            raw: raw,
          });
        }
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
  constructor(meta, connection) {
    this.meta = meta;
    this.connection = connection;
    this.user = new User(meta, connection);
  }

  /**
   * Send a response to where the original message came from (channel or user).
   */
  reply(reply) {
    if (Array.isArray(reply)) {
      return reply.forEach(proxy(this.reply, this));
    }
    if (typeof reply != "object") {
      reply = {
        type: "message",
        content: reply,
      };
    }
    let to = (reply.type == "notice" || this.pm) ? this.nick : this.to;

    try {
      this.connection[reply.type || "message"].call(this.connection, to, reply.content);
    } catch (error) {
      console.error("message.reply:", error.stack);
    }
  }

  get nick() {
    return this.user.nick;
  }

  get channel() {
    return ["#", "!"].indexOf(this.meta.args[0][0]) != -1 ? this.to : null;
  }

  get to() {
    return this.meta.args[0];
  }

  get message() {
    return this.meta.args[1];
  }

  /**
   * @deprecated
   */
  get content() {
    return this.message;
  }

  get pm() {
    // Message is a private message when target is not a channel
    return ["#", "!"].indexOf(this.to[0]) == -1;
  }

  get type() {
    return (this.message.length >= 3 && this.message[0] == "!" && this.message[1] != "!") ? Message.COMMAND : Message.MESSAGE;
  }

  get command() {
    if (this.type == Message.COMMAND) {
      return this.message.split(" ", 1)[0].substring(1);
    }
  }

  get params() {
    if (this.type == Message.COMMAND) {
      return this.message.split(/\s+/).slice(1);
    }
  }
}

Message.MESSAGE = 1;
Message.COMMAND = 2;

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
    return this.config.delay || 1500;
  }

  get started() {
    return this.timer != null;
  }

  get length() {
    return this.messages.length;
  }
}

/**
 * Meta class for user info.
 */
class User {
  constructor(meta, connection) {
    this.meta = meta;
    this.connection = connection;
  }

  whois() {
    if (this.account) {
      return Promise.accept(this.meta);
    }
    return this.connection.whois(this.nick).then(info => {
      if (info.account) {
        this.meta.account = info.account;
      }
      return info;
    });
  }

  get nick() {
    return this.meta.nick;
  }

  get host() {
    return this.meta.host;
  }

  get user() {
    return this.meta.user;
  }

  get account() {
    return this.meta.account;
  }
}

exports.Bot = Bot;
exports.User = User;
