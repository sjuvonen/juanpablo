"use strict";

let mongoose = require("mongoose");
let util = require("util");
let mapWait = require("../collection").mapWait;

let UserSchema = new mongoose.Schema({
  nick: String,
  account: String,
  host: String,
  hosts: [String],
  joined: {
    type: Date,
    default: Date.now
  },
  seen: Date,
  network: String,
});

let User = mongoose.model("chanlog_user", UserSchema);

let EventSchema = new mongoose.Schema({
  date: {
    type: Date,
    default: Date.now,
  },
  type: String,
  nick: String,
  host: String,
  message: String,

  channel: String,
  network: String,

  user: {
    type: mongoose.Schema.ObjectId,
    ref: User,
  }
});

let Event = mongoose.model("chanlog_event", EventSchema);

let TopicSchema = new mongoose.Schema({
  topic: String,
  date: {
    type: Date,
    default: Date.now
  },
  channel: String,
  network: String,
  nick: String,

  user: {
    type: mongoose.Schema.ObjectId,
    ref: User,
  }
});

let Topic = mongoose.model("chanlog_topic", TopicSchema);

let proxy = (func, context) => {
  return (...args) => context[func].apply(context, args);
};

class Logger {
  constructor(network, database, events, users, whois) {
    this.network = network;
    this.db = database;
    this.events = events;
    this.users = users;
    this.whois = whois;

    this.events.on("topic", proxy("onTopic", this));
    this.events.on("message", proxy("onMessage", this));
    this.events.on("join", proxy("onJoin", this));
    this.events.on("part", proxy("onPart", this));
    this.events.on("quit", proxy("onQuit", this));
    this.events.on("kick", proxy("onKick", this));
    this.events.on("nick", proxy("onNick", this));
    this.events.on("action", proxy("onAction", this));
  }

  onTopic(event) {
    if (!event.nick) {
      // Filter topic messages received on join.
      return Promise.resolve();
    }
    return this.users.get(event).then(user => {
      let topic = new Topic({
        user: user ? user.id : null,
        topic: event.topic,
        channel: event.channel,
        network: this.network,
        nick: event.nick,
      });
      return topic.save();
    });
  }

  onEvent(event, event_type) {
    if (!event_type) {
      throw new Error("Must define event type");
    }
    return this.users.get(event).then(user => {
      let entry = new Event({
        type: event_type,
        user: user ? user.id : null,
        nick: event.nick,
        host: event.host,
        network: this.network,
      });

      if (event.message) {
        entry.message = event.message;
      }

      if (event.channel) {
        entry.channel = event.channel;
      }

      return entry.save();
    }).then(status => {
    }, error => {
      console.error(error.stack);
    });
  }

  onMessage(event) {
    if (!event.channel) {
      // Filter private messages.
      return Promise.resolve();
    }
    return this.onEvent(event, "message");
  }

  onJoin(event) {
    return this.onEvent(event, "join");
  }

  onPart(event) {
    return this.onEvent(event, "part");
  }

  onQuit(event) {
    return this.onEvent(event, "quit");
  }

  onAction(event) {
    return this.onEvent(event, "action");
  }

  onNick(event) {
    return this.onEvent(event, "nick");
  }

  onKick(event) {
    return this.onEvent(event, "kick");
  }
}

class IdentityManager {
  static stringify(raw) {
    return util.format("%s@%s", raw.user, raw.host).toLowerCase();
  }

  constructor(services) {
    this.services = services;
    this.plugins = [
      new IdentifyByAuth(this.db, this.network, services.get("whois")),
      new IdentifyByHostInfo(this.db, this.network),
    ];
  }

  get db() {
    return this.services.get("database");
  }

  get network() {
    return this.services.get("config").get("name");
  }

  get(raw) {
    return new Promise((resolve, reject) => {
      let hostmask = IdentityManager.stringify(raw);

      mapWait(this.plugins, plugin => plugin.identify(raw).then(user => {
        resolve(user);

        if (!user.account && raw.account) {
          user.account = raw.account;
        }

        if (user.hosts.indexOf(hostmask) == -1) {
          user.hosts.unshift(hostmask);
        }

        user.set({host: hostmask, seen: new Date}).save();
        throw new Error("stop");
      }, error => {
        // pass
      })).then(() => {
        let user = new User({
          network: this.network,
          nick: raw.nick,
          host: hostmask,
          account: raw.account || null,
          hosts: [hostmask],
          seen: new Date,
        });

        user.save().then(resolve, reject);
      });
    });
  }
}

class IdentityPlugin {
  constructor(database, network) {
    this.db = database;
    this.network = network;
  }

  identify(raw) {
    return Promise.reject(new Error("IdentityPlugin.identify()"));
  }
}

class IdentifyByAuth extends IdentityPlugin {
  constructor(database, network, whois) {
    super(database, network);
    this.whois = whois;
  }

  identify(raw) {
    console.log("find by auth");
    return this.whois.auth(raw.nick).then(info => {
      return User.findOne({account: info.account, network: network}).then(user => {
        if (user) {
          return user;
        } else {
          // Set account here and it will be saved in the identity manager.
          raw.account = info.account;
          throw new Error("User not found");
        }
      });
    });
  }
}

class IdentifyByHostInfo extends IdentityPlugin {
  identify(raw) {
    /*
     * NOTE: Important to query by User.hosts and not User.host to include all past hostnames!
     */
    // console.log("find by host", {hosts: raw.host, network: this.network});
    let hostmask = IdentityManager.stringify(raw);
    return User.findOne({hosts: hostmask, network: this.network}).then(user => {
      if (user) {
        return user;
      }
      throw new Error("User not found");
    });
  }
}

exports.configure = services => {
  let database = services.get("database");
  let events = services.get("event.manager");
  let whois = services.get("whois");
  let config = services.get("config");
  let users = new IdentityManager(services);
  let logger = new Logger(config.get("name"), database, events, users, whois);
  services.register("chanlog.logger", logger);
};
