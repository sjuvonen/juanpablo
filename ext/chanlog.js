/**
 * Log user activity on channels.
 */

"use strict";

let moment = require("moment");
let sqlite = require("sqlite3");
let util = require("util");

let User = require("../core/bot").User;

class ChannelLogger {
  constructor(connection, database, config) {
    this.connection = connection;
    this.db = database;
    this.config = config;
    this.users = new UserStorage(this.db);
    this.init();
  }

  init() {
    let events = this.connection.events;
    let map = [
      "action",
      "join",
      "kick",
      "message",
      "nick",
      "part",
      "quit",
      "topic",
      "voice",
      "unvoice",
      "op",
      "unop",
    ];

    map.forEach(event_id => {events.on(event_id, event => this.onEvent(event_id, event))});
  }

  onEvent(event_id, event) {
    switch (event_id) {

      /**
       * NOTE: Let this fall through to the generic event logger.
       */
      case "topic":
        if (event.user) {
          let sql = "INSERT INTO topics (channel, topic, time) VALUES (?, ?, ?)";
          let time = moment().format("YYYY-MM-DD HH:mm:ss");
          this.db.run(sql, [event.channel, event.topic, time], error => {
            if (error) {
              console.error("chanlog.topic:", error.stack);
            }
          });
        }

      default:
        if (event.user) {
          let write = (user, channel, message) => {
            let sql = "INSERT INTO eventlog (type, time, channel, nick, host, message, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)";
            let smt = this.db.prepare(sql, error => {
              if (error) {
                throw error;
              }
              smt.run(event_id, moment().format("YYYY-MM-DD HH:mm:ss"), channel, user.nick, user.host, message, user.id, error => {
                if (error) {
                  console.error("chanlog.onEvent:", error);
                }
              });
            });
          };

          let user = event.user;
          user.whois().then(() => {
            this.findOrCreateUser(user.nick, user.user, user.host, user.account).then(raw => {
              user.id = raw.id;
              write(user, event.channel, event.message);
            }, error => {
              console.error("chanlog.onEvent.create", error.stack);
            });
          }, error => {
            console.error("chanlog.onEvent.whois:", error.stack);
          });
        }
    }
  }

  findOrCreateUser(nick, user, host, account) {
    return new Promise((resolve, reject) => {
      this.users.find(nick, user, host, account).then(raw => {
        resolve(raw);
      }, error => {
        this.users.create({
          nick: nick,
          user: user,
          host: host,
          account: account
        }).then(resolve, error => {
          console.error("chanlog.findorcreate:", error.stack);
          reject(error);
        });
      });
    });
  }
}

class UserStorage {
  constructor(database) {
    this.db = database;
    this.authCache = new Map;
    this.plugins = [
      new IdentifyByAuth(this.db),
      new IdentifyByHostInfo(this.db),
    ];
  }

  create(data) {
    return new Promise((resolve, reject) => {
      let sql = "INSERT INTO users (nick, user, host, account, joined, seen) VALUES(?, ?, ?, ?, ?, ?)";
      let values = [data.nick, data.user, data.host, data.account,
        moment().format('YYYY-MM-DD HH:mm:ss'), moment().format('YYYY-MM-DD HH:mm:ss')];

      this.db.run(sql, values, error => {
        if (error) {
          console.log("userstorage.create:", error.stack);
          return reject(error);
        }
        this.findByNick(data.nick).then(resolve, reject);
      })
    });
  }

  find(nick, user, host, auth) {
    return new Promise((resolve, reject) => {
      let plugins = this.plugins.slice();
      let next = () => {
        if (plugins.length) {
          plugins.shift().identify(nick, user, host, auth).then(resolve, next);
        } else {
          reject(new Error("User not found"));
        }
      };
      next();
    });
  }

  findByNick(nick) {
    return (new IdentifyByNick(this.db)).identify(nick);
  }
}

class IdentityPlugin {
  constructor(database) {
    this.db = database;
  }

  idenfity(nick, user, host, auth) {
    throw new Error("IdentityPlugin.identify()");
  }
}

class IdentifyByAuth extends IdentityPlugin {
  constructor(database) {
    super(database);
    this.cache = new Map;
  }
  identify(nick, user, host, auth) {
    if (!auth) {
      return Promise.reject(new Error("No identity given"));
    }
    if (this.cache.has(auth)) {
      return Promise.accept(this.cache.get(auth));
    }
    return new Promise((resolve, reject) => {
      let sql = "SELECT * FROM users WHERE account = ?";
      this.db.get(sql, auth, (error, row) => {
        if (error) {
          return reject(error);
        } else if (!row) {
          return reject(new Error(util.format("No match for account '%s'", auth)));
        } else {
          this.cache.set(row.account, row);
          resolve(row);
        }
      });
    });
  }
}

class IdentifyByHostInfo extends IdentityPlugin  {
  constructor(database) {
    super(database);
    this.cache = new Map;
  }
  identify(nick, user, host, auth) {
    return new Promise((resolve, reject) => {
      let sql = "SELECT * FROM users WHERE user = ? AND host = ?";
      this.db.get(sql, [user, host], (error, row) => {
        if (error) {
          return reject(error);
        }
        if (!row) {
          return reject(new Error("No users found by host"));
        }
        this.cache.set(util.format("%s@%s", user, host), row);
        resolve(row);
      });
    });
  }
}

class IdentifyByNick extends IdentityPlugin {
  identify(nick) {
    return new Promise((resolve, reject) => {
      let sql = "SELECT * FROM users WHERE nick = ?";
      this.db.get(sql, [nick], (error, row) => {
        if (error) {
          return reject(error);
        }
        resolve(row);
      });
    });
  }
}

exports.configure = function(connection) {
  let database = new sqlite.Database(connection.config.modules.chanlog.database.sqlite.file);
  let logger = new ChannelLogger(connection, database, connection.config.modules.chanlog);
  return logger;
};
