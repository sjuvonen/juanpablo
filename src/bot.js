"use strict";

let events = require("colibre/src/events");
let datatree = require("colibre/src/util/datatree");
let irc = require("irc");
let util = require("util");
let ModuleManager = require("colibre/src/module-manager").ModuleManager;
let ServiceManager = require("colibre/src/service-manager").ServiceManager;

function initializeMeta(instance) {
  Object.defineProperty(instance, "meta", {
    enumerable: false,
    value: Object.create(null),
  });
}

class Config {
  constructor(data) {
    this.data = data;
  }

  get(path, default_value) {
    return datatree.get(this.data, path, default_value);
  }
}

class NestedServiceManager extends ServiceManager {
  constructor(shared_services) {
    super();
    this.sharedServices = shared_services;
  }

  get(name, ...params) {
    try {
      return super.get(name, ...params);
    } catch (error) {
      return this.sharedServices.get(name, ...params);
    }
  }
}

class Bot {
  constructor(config) {
    this.connections = new Map;
    this.config = new Config(config);
    this.events = new events.AsyncEventManager;
    this.sharedEvents = new events.SharedEventManager(true);
    this.services = new ServiceManager;
    // this.modules = new ModuleManager(this.services);

    this.services.register("bot", this);
    this.services.register("config", this.config);
    this.services.register("event.manager", this.sharedEvents);
    // this.services.register("module.manager", this.modules);

    // Router is requested in module-manager (but not used as bot modules provide no routes).
    this.services.register("router", null);

    this.sharedEvents.addEmitter("bot", this.events);
    // this.sharedEvents.addEmitter("modules", this.modules.events);
  }

  start() {
    return new Promise((resolve, reject) => {
      this.events.emit("start");
      this.connect();
      setTimeout(resolve, 100);
    });
  }

  /**
   * Connect to servers and join channels.
   */
  connect() {
    this.config.get("servers").forEach(this.addConnection, this);
  }

  addConnection(config) {
    if (!("modules" in config)) {
      config.modules = this.config.get("modules", {});
    }
    config.database = Object.create(this.config.get("database"));
    return this.connections
      .set(config.name, new Connection(this.services, config))
      .get(config.name).open()
      .then(connection => {
        connection.events.on("*", (event_id, args) => this.events.emit(event_id, ...args));
      });
  }
}

class ModuleLoader {
  constructor(services) {
    this.services = services;
  }

  load(path, name) {
    try {
      console.log("load", name);
      let module = require(util.format("%s/%s", path, name));
      return Promise.resolve(module);
    } catch (error) {
      console.error("module.load:", error.stack);
      return Promise.reject(error);
    }
  }

  initialize(module) {
    try {
      module.configure(this.services);
    } catch (error) {
      console.error("module.init", error.stack);
    }
  }
}

class Connection {
  constructor(services, config) {
    initializeMeta(this);

    config.autoConnect = false;
    config.floodProtection = true;
    config.floodProtectionDelay = 1000;

    this.services = new NestedServiceManager(services);
    this.config = new Config(config);
    this.events = new events.EventManager;
    this.modules = new ModuleManager(this.services, new ModuleLoader(this.services));

    this.services.register("connection", this);
    this.services.register("config", this.config);
    this.services.register("event.manager", this.events);

    this.services.registerFactory("whois", () => {
      return new Whois(this);
    });
  }

  open() {
    return new Promise((resolve, reject) => {
      this.modules.discover("./modules", this.config.get("modules.enabled", [])).then(() => {
        this.client.connect(5, raw => {
          let data = {server: raw.server, nick: raw[0]};
          this.events.emit("connect", data);
          resolve(this);
        });
      });
    });
  }

  close() {
    return new Promise((resolve, reject) => {
      this.client.disconnect(raw => {
        this.events.emit("disconnect");
        resolve(raw);
      });
    });
  }

  whois(nick) {
    return this.services.get("whois").whois(nick);
  }

  message(to, content) {
    this.client.say(to, content);
  }

  notice(to, content) {
    this.client.notice(to, content);
  }

  get host() {
    return this.config.get("host");
  }

  get nick() {
    // Nickname might be set on runtime due to reserved nicks etc.
    return this.meta.nick || this.config.get("nick");
  }

  set nick(nick) {
    this.meta.nick = nick;
  }

  get client() {
    if (!this.meta.client) {
      let client = this.meta.client = new irc.Client(this.host, this.nick, this.config.data);
      let events = this.events;

      client.on("error", raw => events.emit("error", raw));

      client.on("message", (nick, content, to, raw) => events.emit("message", new Message(raw, this)));
      client.on("nick", (old_nick, new_nick, channels, raw) => events.emit("nick", new NickEvent(raw)));
      client.on("topic", (channel, topic, nick, raw) => events.emit("topic", new TopicEvent(raw)));
      client.on("quit", (nick, reason, channels, raw) => events.emit("quit", new QuitEvent(raw)));
      client.on("kill", (nick, reason, channels, raw) => events.emit("quit", new QuitEvent(raw)));
      client.on("part", (nick, reason, channels, raw) => events.emit("quit", new PartEvent(raw)));
      client.on("join", (a, b, raw) => events.emit("join", new JoinEvent(raw)));
      client.on("action", (a, b, c, raw) => events.emit("action", new UserActionEvent(raw)));
      client.on("-mode", (channel, by, mode, target, raw) => events.emit("mode", new ModeChangeEvent(raw)));
      client.on("+mode", (channel, by, mode, target, raw) => events.emit("mode", new ModeChangeEvent(raw)));

      client.on("kick", (...args) => {
        console.log("KICK", args);
      });

      client.on("whois", info => {
        console.log("event whois");
      });
    }
    return this.meta.client;
  }
}

class Message {
  constructor(raw, connection) {
    this.raw = raw;
    this.connection = connection;
  }

  is(type) {
    switch (type) {
      case "msg": return ["#", "!"].indexOf(this.to[0]) == 0;
      case "pm": return ["#", "!"].indexOf(this.to[0]) == -1;
    }
  }

  /**
   * Send a response to where the original message came from (channel or user).
   */
  reply(reply) {
    if (Array.isArray(reply)) {
      return reply.forEach(row => this.reply(row));
    }
    if (typeof reply != "object") {
      reply = {
        type: "message",
        content: reply,
      };
    }
    let to = (reply.type == "notice" || this.is("pm")) ? this.nick : this.to;

    try {
      // console.log("RT", reply);
      this.connection[reply.type || "message"].call(this.connection, to, reply.content);
    } catch (error) {
      console.error("message.reply:", error.stack);
    }
  }

  get length() {
    return this.message.length;
  }

  get nick() {
    return this.raw.nick;
  }

  get host() {
    return this.raw.host;
    // return util.format("%s@%s", this.raw.user, this.raw.host);
  }

  get user() {
    return this.raw.user;
  }

  get to() {
    return this.raw.args[0];
  }

  get message() {
    return this.content;
  }

  get content() {
    console.warn("Message.content is deprecated");
    return this.raw.args[1];
  }

  get channel() {
    return this.is("msg") ? this.to : null;
  }
}

class BaseChannelEvent {
  constructor(raw) {
    this.raw = raw;
  }

  get nick() {
    return this.raw.nick;
  }

  get host() {
    return this.raw.host;
    // return util.format("%s@%s", this.raw.user, this.raw.host);
  }

  get user() {
    return this.raw.user;
  }
}

class ChannelEvent extends BaseChannelEvent {
  get channel() {
    return this.raw.args[0];
  }
}

class NickEvent extends BaseChannelEvent {
  get nick() {
    return this.raw.args[0];
  }

  get oldNick() {
    return this.raw.nick;
  }
}

class TopicEvent extends ChannelEvent {
  get topic() {
    return this.raw.args[1];
  }
}

class ModeChangeEvent extends ChannelEvent {
  get mode() {
    return this.raw.args[1];
  }

  get target() {
    return this.raw.args[2];
  }
}

class UserActionEvent extends ChannelEvent {
  get action() {
    // Action seems to be formatted as '\u0001ACTION foobar\u0001'
    return this.args[1].substring(8, this.args[0] - 1);
  }
}

class JoinEvent extends ChannelEvent {

}

class PartEvent extends ChannelEvent {
  get message() {
    return this.raw.args[1];
  }
}

class QuitEvent extends BaseChannelEvent {
  get message() {
    return this.raw.args[0].substr(6);
  }
}

class KickEvent extends BaseChannelEvent {

}

/**
 * Utility class for storing values that expire (are removed) automaticly after defined threshold time.
 */
class AgingCache {
  constructor(expire) {
    this.expire = expire || Number.MAX_SAFE_INTEGER;
    this.cache = new Map;
    this.timestamps = new Map;
  }

  set(key, value) {
    this.cache.set(key, value);
    this.timestamps.set(key, Date.now());
  }

  get(key) {
    if (this.has(key)) {
      return this.cache.get(key);
    }
  }

  has(key) {
    if (!this.timestamps.has(key)) {
      return false;
    }
    if (Date.now() - this.timestamps.get(key) >= this.expire) {
      this.delete(key);
      return false;
    }
    return true;
  }

  delete(key) {
    this.cache.delete(key);
    this.timestamps.delete(key);
  }
}

/**
 * Utility class for performing whois requests or checking auth status.
 */
class Whois {
  constructor(connection) {
    this.connection = connection;
    this.cache = new AgingCache(30000);
  }

  whois(nick) {
    return new Promise((resolve, reject) => {
      nick = nick.toLowerCase();
      if (this.cache.has(nick)) {
        return resolve(this.cache.get(nick));
      }
      this.connection.client.whois(nick, info => {
        this.cache.set(nick, info);
        resolve(info);
      });
    });
  }

  auth(nick) {
    return this.whois(nick).then(info => info.account || Promise.reject(new Error("User not authed")));
  }
}

module.exports = function(config) {
  return new Bot(config);
};

module.exports.Bot = Bot;
