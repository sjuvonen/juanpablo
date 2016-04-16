"use strict";

let events = require("colibre/src/events");
let util = require("util");

class Command {
  static isCommand(message) {
    return message.length > 3 && message.message[0] == "!" && message.message[1] != "!";
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

  get command() {
    return this.message.message.split(/\s+/, 1)[0].substring(1);
  }

  get params() {
    return this.message.message.split(/\s+/).slice(1);
  }
}

/**
 * Command is allowed to everyone.
 */
Command.ALLOW_ALL = 0;

/**
 * Command is allowed to admins only.
 */
Command.ALLOW_ADMIN = 1;

/**
 * Command is allowed to users who have authed to the server.
 */
Command.ALLOW_AUTHED = 2;

/**
 * Command is allowed to users specified in configuration.
 */
Command.ALLOW_USERS = 3;

class Context {
  constructor(name, ...args) {
    this.name = name;
    this.callback = args.pop();
    this.permissions = args.length ? args.shift() : Command.ALLOW_ALL;
  }
}

class CommandManager {
  constructor(whois) {
    this.commands = new Map;
    this.events = new events.AsyncEventManager;
  }

  add(name, ...args) {
    if (this.commands.has(name)) {
      throw new Error(util.format("Command %s is already registered", name));
    }
    this.commands.set(name, new Context(name, ...args));
  }

  get(name) {
    if (this.commands.has(name)) {
      return this.commands.get(name);
    } else {
      throw new Error(util.format("Unknown command '%s'", name));
    }
  }

  execute(command_id, nick, params) {
    return this.access(command_id, nick).then(context => context.callback(nick, ...params));
  }

  access(command_id, nick) {
    return new Promise((resolve, reject) => {
      let context = this.get(command_id);

      switch (context.permissions) {
        case Command.ALLOW_ALL:
          return resolve(context);

        case Command.ALLOW_AUTHED:
          return this.whois.auth(nick).then(account => account, error => new Error("You need to auth to use this command"));

        case Command.ALLOW_ADMIN:
          console.error("Command.ALLOW_ADMIN not supported yet");
          return reject(new Error("Command.ALLOW_ADMIN not supported yet"));

        case Command.ALLOW_USERS:
          console.error("Command.ALLOW_USERS not supported yet");
          return reject(new Error("Command.ALLOW_USERS not supported yet"));

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

  services.registerFactory("command.manager", () => new CommandManager(services.get("whois")));

  services.get("event.manager").on("command", command => {
    return services.get("command.manager").execute(command.command, command.nick, command.params)
      .then(result => command.send(result), error => command.send(error.toString()));
  });
};
