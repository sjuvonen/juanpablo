"use strict";

let events = require("colibre/src/events");
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

class CommandManager {
  constructor(whois, config) {
    this.whois = whois;
    this.config = config;
    this.commands = new Map;
    this.events = new events.AsyncEventManager;
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
      .then(context => mapWait(context.validators, callback => callback(data.nick, ...data.params)).then(() => context))
      .then(context => context.callback(data));
  }

  access(command_id, nick) {
    return new Promise((resolve, reject) => {
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
            reject(Error("You need admin permissions to use this command"));
          });

        case Command.ALLOW_WHITELIST:
          return this.whois.auth(nick).then(account => {
            let whitelist = this.config.whitelist[account.account.toLowerCase()];
            if (whitelist && whitelist.indexOf(command_id) != -1) {
              return resolve(context);
            } else if (this.config.admins.indexOf(account.account.toLowerCase()) != -1) {
              return resolve(context);
            }
            reject();
          }).catch(error => {
            reject(Error("You are not allowed to use this command"));
          });

        default:
          return reject(new Error("Invalid command permissions"));
      }
    });
  }
}

exports.configure = services => {
  services.get("event.manager").on("message", message => {
    if (Command.isCommand(message)) {
      let command = new Command(message);
      message.connection.events.emit("command", command);
    }
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
};
