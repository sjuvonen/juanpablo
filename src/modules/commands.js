"use strict";

let events = require("colibre-events");
let util = require("util");
let mapWait = require("../collection").mapWait;

class Command {
  static isCommand(message) {
    return message.length >= 2 && message.message[0] == "!" && message.message[1] != "!";
  }

  constructor(message) {
    this.message = message;
  }

  send(result) {
    this.message.reply(result);
  }

  get nick() {
    return this.message.nick;
  }

  get channel() {
    return this.message.channel;
  }

  get command() {
    return this.message.message.split(/\s+/, 1)[0].substring(1);
  }

  get params() {
    return this.message.message.trim().split(/\s+/).slice(1);
  }
}

/**
 * Command is allowed to everyone.
 */
exports.ALLOW_ALL = Command.ALLOW_ALL = 0;

/**
 * Command is allowed to admins only.
 */
exports.ALLOW_ADMIN = Command.ALLOW_ADMIN = 1;

/**
 * Command is allowed to users who have authed to the server.
 */
exports.ALLOW_AUTHED = Command.ALLOW_AUTHED = 2;

/**
 * Command is allowed to users specified in configuration.
 */
exports.ALLOW_WHITELIST = Command.ALLOW_WHITELIST = 3;

class Context {
  constructor(name, ...args) {
    this.name = name;
    this.callback = args.pop();
    this.permissions = args.length ? args.shift() : Command.ALLOW_ALL;
    this.validators = [];
  }

  validate(callback) {
    this.validators.push(callback);
    return this;
  }
}

class BlacklistMatcher {
  constructor(rules) {
    this.rules = rules;
  }

  get empty() {
    return this.rules.auth.length == 0;
  }

  add(user) {
    let nick = user.nick.toLowerCase();

    if (this.rules.nick.indexOf(nick) == -1) {
      this.rules.nick.push(nick);
    }

    if (user.account && this.rules.auth.indexOf(user.account) == -1) {
      this.rules.auth.push(user.account);
    }

    if (this.rules.host.indexOf(user.host) == -1) {
      this.rules.host.push(user.host);
    }
  }

  delete(user) {
    for (let i = this.rules.nick.length - 1; i >= 0; i--) {
      if (this.rules.nick[i] == user.nick.toLowerCase()) {
        this.rules.nick.splice(i, 1);
      }
    }

    for (let i = this.rules.host.length - 1; i >= 0; i--) {
      if (this.rules.host[i] == user.host) {
        this.rules.host.splice(i, 1);
      }
    }

    if (user.account) {
      for (let i = this.rules.auth.length - 1; i >= 0; i--) {
        if (this.rules.auth[i] == user.account) {
          this.rules.auth.splice(i, 1);
        }
      }
    }
  }

  test(user) {
    if (this.empty) {
      return Promise.resolve();
    }
    
    return this.byNick(user.nick)
      .then(() => this.byHost(user.host))
      .then(() => this.byAuth(user.account));
  }

  byNick(nick) {
    if (this.rules.nick.indexOf(nick.toLowerCase()) != -1) {
      return Promise.reject(new Error("Nick name blacklisted"));
    }
    return Promise.resolve();
  }

  byAuth(auth) {
    if (auth && this.rules.auth.indexOf(auth.toLowerCase()) != -1) {
      return Promise.reject(new Error("Account blacklisted"));
    }
    return Promise.resolve();
  }

  byHost(host) {
    if (this.rules.host.indexOf(host) != -1) {
      return Promise.reject(new Error("User blacklisted"));
    }
    return Promise.resolve();
  }
}

class CommandManager {
  constructor(whois, config) {
    this.whois = whois;
    this.config = config;
    this.commands = new Map;
    this.events = new events.AsyncEventManager;
    this.blacklist = new BlacklistMatcher(this.config.blacklist);
  }

  add(name, ...args) {
    if (this.commands.has(name)) {
      throw new Error(util.format("Command %s is already registered", name));
    }
    this.commands.set(name, new Context(name, ...args));
    return this.commands.get(name);
  }

  get(name) {
    if (this.commands.has(name)) {
      return this.commands.get(name);
    } else {
      throw new Error(util.format("Unknown command '%s'", name));
    }
  }

  delete(name) {
    this.commands.delete(name);
  }

  execute(command_id, data) {
    return this.access(command_id, data.nick)
      .then(context => this.isNotBlacklisted(command_id, data.nick).then(() => context))
      .then(context => mapWait(context.validators, callback => callback(data.nick, ...data.params)).then(() => context))
      .then(context => context.callback(data));
  }

  access(command_id, nick) {
    return (new Promise((resolve, reject) => {
      let context = this.get(command_id);

      switch (context.permissions) {
        case Command.ALLOW_ALL:
          return resolve(context);

        case Command.ALLOW_AUTHED:
          return this.whois.auth(nick).then(account => context, error => new Error("You need to auth to use this command"));

        case Command.ALLOW_ADMIN:
          return this.whois.auth(nick).then(account => {
            if (this.config.admins.indexOf(account.account.toLowerCase()) == -1) {
              throw new Error;
            }
            resolve(context);
          }).catch(error => {
            reject(new Error("You need admin permissions to use this command"));
          });

        case Command.ALLOW_WHITELIST:
          return this.whois.auth(nick).then(account => {
            let whitelist = this.config.whitelist[account.account.toLowerCase()];
            if (whitelist && whitelist.indexOf(command_id) != -1) {
              return resolve(context);
            } else if (this.config.admins.indexOf(account.account.toLowerCase()) != -1) {
              return resolve(context);
            }
            reject(new Error("You are not whitelisted"));
          }).catch(error => {
            reject(new Error("You are not allowed to use this command"));
          });

        default:
          return reject(new Error("Invalid command permissions"));
      }
    }));
  }

  isNotBlacklisted(command, nick) {
    return this.whois.whois(nick).then(user => this.blacklist.test(user));
  }
}

exports.configure = services => {
  services.get("event.manager").on("message", message => {
    if (Command.isCommand(message)) {
      let command = new Command(message);
      message.connection.events.emit("command", command);
    }
  });

  services.registerFactory("command.blacklist", () => {
    let config = services.get("config").get("modules.commands.blacklist");
    return new BlacklistMatcher(config);
  });

  services.registerFactory("command.manager", () => {
    let whois = services.get("whois");
    let config = services.get("config").get("modules.commands");
    return new CommandManager(whois, config);
  });

  services.get("event.manager").on("command", command => {
    return services.get("command.manager").execute(command.command, command)
      .then(result => command.send(result), error => command.send(error.toString()));
  });

  services.get("command.manager").add("bl", (command) => {
    let blacklist = services.get("command.blacklist");
    let whois = services.get("whois");

    return whois.whois(command.params[0]).then(user => {
      blacklist.add(user);
      return util.format("User %s blacklisted", user.nick);
    });
  });

  services.get("command.manager").add("unbl", (command) => {
    let blacklist = services.get("command.blacklist");
    let whois = services.get("whois");

    return whois.whois(command.params[0]).then(user => {
      blacklist.delete(user);
      return util.format("User %s removed from blacklist", user.nick);
    });
  });
};
