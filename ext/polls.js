"use strict";

let EventEmitter = require("events");
let moment = require("moment");
let util = require("util");
let Command = require("../core/commands").Command;

class Polls {
  constructor(database) {
    this.events = new EventEmitter;
    this.db = database;
    this.activePoll = null;
  }

  create(question, options, expires, user) {
    return new Promise((resolve, reject) => {
      if (this.activePoll) {
        throw new Error("Cannot start a new poll when there is another one active");
      }

      this.activePoll = new Poll(question, options, expires, user);
      let col_sql = options.map((option, i) => "option_" + ++i);
      let pm_sql = options.map((option, i) => "$option_" + ++i);

      let sql = util.format("INSERT INTO polls (question, %s, expires, user, nick) \
        VALUES ($question, %s, $expires, $user, $nick)", col_sql, pm_sql);

      let params = {
        $question: question,
        $user: user.account,
        $nick: user.nick,
        // $created: this.activePoll.created,
        $expires: moment(this.activePoll.expires).format("YYYY-MM-DD HH:mm:ss"),
      };

      options.forEach((option, i) => {
        params["$option_" + ++i] = option;
      });

      // NOTE: Cannot use an arrow function as we need to access the context for lastID.
      let self = this;
      this.db.run(sql, params, function(error) {
        if (error) {
          self.activePoll = null;
          return reject(error);
        }
        self.activePoll.id = this.lastID;
        self.wait();
        return resolve(self.activePoll);
      });
    });
  }

  vote(vote, user) {
    if (!this.activePoll) {
      return Promise.reject(new Error("There is no active poll"));
    }
    let options = this.activePoll.options.map(option => option.toLowerCase());
    if (options.indexOf(vote.toLowerCase()) == -1) {
      return Promise.reject(new Error(util.format("Invalid option '%s'", vote)));
    }
    return new Promise((resolve, reject) => {
      let sql = "INSERT INTO polls_votes (question_id, vote, user, nick) VALUES ($question, $vote, $user, $nick)";
      let params = {
        $question: this.activePoll.id,
        $vote: vote,
        $user: user.user,
        $nick: user.nick,
      };
      this.db.run(sql, params, error => {
        if (error) {
          return reject(new Error("You have already voted in this poll"));
        }
        this.activePoll.votes.push(vote);
        resolve();
      });
    });
  }

  wait() {
    if (this.activePoll) {
      return this.activePoll.wait().then(stats => {
        this.activePoll = null;
        return stats;
      });
    } else {
      return Promise.reject(new Error("No active poll"));
    }
  }

  _initDatabase() {
    this.db.serialize(() => {
      this.db.run("CREATE TABLE IF NOT EXISTS polls( \
        id INTEGER PRIMARY KEY AUTOINCREMENT, \
        question TEXT NOT NULL, \
        option_1 TEXT NOT NULL, \
        option_2 TEXT NOT NULL, \
        option_3 TEXT, \
        option_4 TEXT, \
        option_5 TEXT, \
        option_6 TEXT, \
        user TEXT NOT NULL, \
        nick TEXT NOT NULL, \
        created TIMESTAMP DEFAULT CURRENT_TIMESTAMP, \
        expires TIMESTAMP NOT NULL \
      )");
      this.db.run("CREATE TABLE IF NOT EXISTS polls_votes( \
        id INTEGER PRIMARY KEY AUTOINCREMENT, \
        question_id INTEGER NOT NULL, \
        vote TEXT NOT NULL, \
        user TEXT NOT NULL, \
        nick TEXT NOT NULL, \
        created TIMESTAMP DEFAULT CURRENT_TIMESTAMP, \
        UNIQUE(question_id, user) \
      )");
    });
  }
}

class Poll {
  constructor(question, options, expires, user) {
    this.id = null;
    this.created = new Date;
    this.question = question.replace(/\??$/, "?");
    this.options = options;
    this.expires = expires;
    this.user = user;
    this.votes = [];
  }

  wait() {
    return new Promise((resolve, reject) => {
      let diff = moment(this.expires).diff();

      setTimeout(() => {
        resolve(this.stats);
      }, diff);
    });
  }

  get stats() {
    return new Stats(this)
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
      let key = cache.get(vote.toLowerCase());
      votes.set(key, votes.get(key) + 1);
    });

    let output = [...votes.entries()]
      .sort((a, b) => a[1] - b[1])
      .map(item => item.join(": "))
      .join(", ");
    return output;
  }

  get votes() {
    return this.poll.votes;
  }
}

exports.configure = (connection, modules) => {
  let commands = connection.commands;
  let polls = new Polls(modules.get("database"));
  let config = connection.config.modules.polls;

  polls._initDatabase();

  connection.addCommand("poll", Command.ALLOW_AUTHED, (user, params, message) => {
    // By default params are split from message using white-space, so we join it and split by semicolon.
    let options = params.join(" ").split(";").map(raw => raw.trim());
    let question = options.shift();
    let timeout = options.pop();
    let expires = null;

    if (!timeout || timeout[0] != "+") {
      if (typeof timeout != "undefined") {
        options.push(timeout);
      }
      expires = moment().add(config.expires, "seconds");
    } else {
      expires = moment().add(timeout, "seconds");
    }

    if (!question) {
      return Promise.reject(new Error("Usage: !poll question [options...] [expires]"));
    }

    if (!expires.isAfter(new Date)) {
      expires = moment().add(config.expires, "seconds");
    }

    if (!options.length) {
      options = config.options.slice();
    }

    return user.whois()
      .then(info => polls.create(question, options, expires, info))
      .then(poll => {
        poll.options.forEach(option => {
          commands.add(option.toLowerCase(), (user, params) => {
            return user.whois()
              .then(info => polls.vote(option, info))
              .catch(error => {
                console.error("Failed to process answer", error.stack);
              });
          });
        });

        poll.wait().then(stats => {
          message.reply(["Poll finished!", stats.toString()]);
          poll.options.forEach(option => commands.delete(option.toLowerCase()));
        });

        return Promise.resolve("Poll: " + poll.question);
      });
  });

  return polls;
};
