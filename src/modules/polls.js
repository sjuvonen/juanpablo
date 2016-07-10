"use strict";

let Command = require("./commands");
let mongoose = require("mongoose");
let util = require("util");

let PollSchema = new mongoose.Schema({
  question: String,
  user: {
    _id: false,
    nick: String,
    account: String,
  },
  options: [String],
  created: {
    type: Date,
    default: Date.now,
  },
  votes: [{
    _id: false,
    value: String,
    user: {
      _id: false,
      nick: String,
      account: String,
    }
  }]
});

PollSchema.methods.isAnswerValid = function(value) {
  return this.options.indexOf(value) != -1;
};

PollSchema.methods.vote = function(nick, value) {
  // if (!account || typeof account != "object") {
  //   throw new Error("Invalid user data");
  // }
  if (!this.isAnswerValid(value)) {
    throw new Error("Invalid answer");
  }

  for (let i = 0; i < this.votes.length; i++) {
    let vote = this.votes[i];
    if (vote.user.nick == nick) {
      vote.value = value;
      return;
    }
  }

  this.votes.push({value: value, user: {nick: nick}});
}

/**
 * NOTE: Currently does not allow concurrent polls on different channels.
 */
class PollManager {
  constructor(whois) {
    this.whois = whois;
    this.poll = null;
    this.timer = null;
  }

  start(poll, expires) {
    return new Promise((resolve, reject) => {
      if (this.poll) {
        return reject(new Error("Cannot start a new poll while another one is active"));
      }
      this.poll = poll;
      this.timer = setTimeout(() => {
        resolve(new Stats(poll));
        this.finish();
      }, (expires || 60) * 1000);
    });
  }

  vote(nick, value) {
    if (!this.poll) {
      throw new Error("There is no active poll");
    }
    this.poll.vote(nick, value);
  }

  finish() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.poll.save();
      this.poll = null;
      this.timer = null;
    }
  }
}

class Stats {
  constructor(poll) {
    this.poll = poll;
  }

  toString() {
    let cache = new Map(this.poll.options.map(option => [option.toLowerCase(), option]));
    let votes = new Map(this.poll.options.map(option => [option, 0]));

    this.votes.forEach(vote => {
      let key = cache.get(vote.value.toLowerCase());
      votes.set(key, votes.get(key) + 1);
    });

    let output = [...votes.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(item => item.join(": "))
      .join(", ");
    return output;
  }

  get votes() {
    return this.poll.votes;
  }
}

exports.configure = services => {
  let commands = services.get("command.manager");
  let database = services.get("database");
  let Poll = database.model("poll", PollSchema);

  services.registerFactory("poll.manager", () => new PollManager);

  commands.add("poll", Command.ALLOW_WHITELIST, command => {
    let manager = services.get("poll.manager");

    let config = new Map(command.params.filter(p => p.indexOf("=") != -1).map(p => p.split("=")));
    let question = command.params.slice(config.size).join(" ").replace(/\??$/, "?");
    let options = (config.get("o") || "yes,no").split(",");
    let poll = new Poll({question: question, options: options, user: {nick: command.nick}});

    options.forEach(cmd => commands.add(cmd, command => manager.vote(command.nick, cmd)));
    command.send(util.format("NEW POLL: %s (%s)", poll.question, options.map(o => "!" + o).join(", ")));

    return manager.start(poll, config.get("t")).then(stats => {
      options.forEach(cmd => commands.delete(cmd));
      return ["POLL FINISHED!", poll.question + " " + stats.toString()];
    });
  });
};
