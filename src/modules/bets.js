"use strict";

let moment = require("moment");
let mongoose = require("mongoose");
let util = require("util");

let BetSchema = new mongoose.Schema({
  user: String,
  nick: String,
  season: Number,
  round: Number,
  points: Number,
  bets: [{
    _id: false,
    firstName: String,
    lastName: String,
    code: String
  }],
  created: {
    type: Date,
    default: Date.now(),
  },
});

BetSchema.statics.isBetWindowOpen = function() {
  return this.db.model("event").findNext("qualifying").then(event => {
    if (event) {
      let min = moment(event.start).startOf("isoweek");
      if (min.isBefore()) {
        return Promise.resolve(event.start);
      } else {
        let date = min.format("MMMM D, HH:mm UTC");
        let message = util.format("Bets will be allowed after %s, until qualifying!", date);
        throw new Error(message);
      }
    } else {
      throw new Error("Bets are not allowed");
    }
  });
};

BetSchema.statics.userBets = function(nick, round) {
  return this.findOne({nick: nick, round: round, season: (new Date).getFullYear()});
};

BetSchema.statics.setUserBets = function(account, round, names) {
  return this.db.model("season").driversForNames(names).then(drivers => {
    let query = {
      user: account.account,
      season: (new Date).getFullYear(),
      round: round,
    };
    let values = {
      nick: account.nick,
      user: query.user,
      season: query.season,
      round: query.round,
      bets: drivers,
      created: new Date,
    };
    return Bet
      .update({user: account.account, season: 2016, round: 1}, values, {upsert: true})
      .then(status => drivers);
  });
};

let Bet = mongoose.model("bet", BetSchema);

exports.configure = services => {
  let db = services.get("database");
  let whois = services.get("whois");
  let commands = services.get("command.manager");
  let round = 1;

  commands.add("bet", (nick, ...names) => {
    if (names.length == 0) {
      return Bet.userBets(nick, 1).then(doc => {
        if (doc) {
          let names = doc.bets.map((d, i) => util.format("%d. %s %s", i+1, d.firstName, d.lastName));
          return util.format("%s: %s", nick, names.join(" "));
        } else {
          return Promise.resolve(util.format("%s: You have no bets for this round", nick));
        }
      });
    } else {
      return whois.auth(nick)
        .catch(() => ({nick: nick, account: nick + "_auth"}))
        .then(account => Bet.setUserBets(account, 1, names))
        .then(drivers => {
          let names = drivers.map((d, i) => util.format("%d. %s %s", i+1, d.firstName, d.lastName));
          return util.format("%s: %s [OK]", nick, names.join(" "));
        });
    }
  })
  .validate(() => Bet.isBetWindowOpen())
  .validate((nick, ...names) => {
    if (names.length != 0 && names.length != 3) {
      return Promise.reject("Need three names to bet");
    }
  });

  commands.add("top", (nick, names) => {
    throw new Error("Command is disabled for now!");
  });
};
