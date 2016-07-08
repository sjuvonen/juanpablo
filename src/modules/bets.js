"use strict";

let moment = require("moment");
let mongoose = require("mongoose");
let util = require("util");

let BetSchema = new mongoose.Schema({
  account: String,
  nick: String,
  season: Number,
  round: Number,
  points: Number,
  maximum: Boolean,
  bets: [{
    _id: false,
    firstName: String,
    lastName: String,
    code: String,
    points: Number,
  }],
  created: {
    type: Date,
    default: Date.now,
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

BetSchema.statics.activeBetRound = function() {
  let max_date = moment().utc().isoWeekday(7).hour(23).minute(59).toDate();
  let season = max_date.getFullYear();
  return this.db.model("event").findOne({season: season, start: {$lte: max_date}}).sort("-start")
    .then(event => {
      if (event) {
        return event;
      } else {
        throw new Error("No active round found");
      }
    });
};

BetSchema.statics.userBets = function(nick, round) {
  return this.findOne({nick: nick, round: round, season: (new Date).getFullYear()});
};

BetSchema.statics.setUserBets = function(account, round, names) {
  return this.db.model("season").driversForNames(names).then(drivers => {
    drivers.forEach(driver => {
      if (drivers.indexOf(driver) < i) {
        throw new Error(util.format("Duplicate driver '%s'", driver.code));
      }
    });
    
    let query = {
      account: account.account,
      season: (new Date).getFullYear(),
      round: round,
    };
    let values = {
      nick: account.nick,
      account: account.account,
      season: query.season,
      round: query.round,
      bets: drivers,
      created: new Date,
    };
    return this
      .update(query, values, {upsert: true})
      .then(status => drivers);
  });
};

BetSchema.statics.latestRound = function(season) {
  let query = {points: {$exists: true}};

  if (season) {
    query.season = season;
  }

  return this.findOne(query)
    .sort({season: -1, round: -1})
    .then(bet => bet || Promise.reject(new Error("No points data")))
    .then(bet => ({season: bet.season, round: bet.round}));
};

BetSchema.statics.pointsForRound = function(round) {
  if (round == "last") {
    round = 0;
  }
  return Promise.resolve(round == 0 ? this.latestRound() : {round: round, season: (new Date).getFullYear()})
    .then(entry => this.find({round: entry.round, season: entry.season, points: {$exists: true}}).sort("-points"))
    .then(bets => {
      if (!bets.length) {
        throw new Error(util.format("No results for round %d", round));
      }

      return this.model("event").findOne({type: "race", season: bets[0].season, round: bets[0].round}).then(event => ({
        season: event.season,
        round: event.round,
        name: event.name,
        bets: bets
      }));
    });
};

BetSchema.statics.pointsForSeason = function(season) {
  return this.latestRound(season)
    .then(entry => this.model("event").findOne({type: "race", season: entry.season, round: entry.round}))
    .then(event => new Promise((resolve, reject) => {
      let query = [
        {$match: {season: event.season, points: {$exists: true}}},
        {$group: {_id: "$nick", points: {$sum: "$points"}, nick: {$first: "$nick"}}},
        {$sort: {points: -1}}
      ];
      this.aggregate(query, (error, result) => {
        if (error) {
          throw error;
        }
        resolve({
          season: event.season,
          round: event.round,
          name: event.name,
          bets: result
        });
      })
    }));
}

class PointsCalculator {
  constructor(results) {
    this.results = results;
    this.scoring = [10, 5, 3, 1];
    this.bonus = 5;
  }

  process(bet) {
    return new Promise((resolve, reject) => {
      bet.points = this.scores(bet);
      resolve(bet);
    });
  }

  scores(bet) {
    let points = [...bet.bets].reduce((value, driver, i) => {
      if (driver.code == this.results[i].code) {
        driver.points = this.scoring[i];
        return value + driver.points;
      } else if (this.driverOnPodium(driver)) {
        driver.points = this.scoring[3];
        return value + driver.points;
      } else {
        driver.points = 0;
      }
      return value;
    }, 0);

    let max = this.scoring.slice(0, 3).reduce((sum, x) => sum + x, 0);

    if (points == max) {
      bet.maximum = true;
      points += this.bonus;
    } else {
      bet.maximum = false;
    }

    return points;
  }

  driverOnPodium(driver) {
    return this.results.slice(0, 3).map(d => d.code).indexOf(driver.code) != -1;
  }
}
exports.configure = services => {
  let database = services.get("database");
  let whois = services.get("whois");
  let commands = services.get("command.manager");
  let events = services.get("event.manager");
  let Bet = database.model("bet", BetSchema);
  let Event = database.model("event");
  let connection = services.get("connection");

  commands.add("bet", command => {
    let names = command.params;
    if (names.length == 0) {
      return Bet.userBets(command.nick, this.activeEvent.round).then(doc => {
        if (doc) {
          let names = doc.bets.map((d, i) => util.format("%d. %s %s", i+1, d.firstName, d.lastName));
          return util.format("%s: %s", command.nick, names.join(" "));
        } else {
          return Promise.resolve(util.format("%s: You have no bets for this round", command.nick));
        }
      });
    } else {
      return whois.auth(command.nick)
        .then(account => Bet.setUserBets(account, this.activeEvent.round, names))
        .then(drivers => {
          let names = drivers.map((d, i) => util.format("%d. %s %s", i+1, d.firstName, d.lastName));
          return util.format("%s: %s [OK]", command.nick, names.join(" "));
        });
    }
  })
  .validate(() => Bet.isBetWindowOpen())
  .validate((nick, ...names) => {
    if (names.length != 0 && names.length != 3) {
      return Promise.reject("Need three names to bet");
    }
  })
  .validate(() => {
    return Bet.activeBetRound().then(event => {
      // console.log("GOT EVENT", event);
      this.activeEvent = event;
    });
  });

  commands.add("top", command => {
    let round = command.params[0];
    if (round) {
      return Bet.pointsForRound(round).then(result => {
        let points = result.bets.map(bet => util.format("%s %d", bet.nick, bet.points));
        let message = util.format("Score for %s: %s", result.name, points.join("; "));
        return {type: "notice", content: message};
      });
    } else {
      return Bet.pointsForSeason().then(result => {
        let points = result.bets.map(bet => util.format("%s %d", bet.nick, bet.points));
        let message = util.format("Points after %s: %s", result.name, points.join("; "));
        return {type: "notice", content: message};
      });
    }
  });

  events.on("racecalendar.results", event => {
    let query = {season: event.event.season, round: event.event.round};
    let results = event.event.results;

    Bet.find(query)
      .then(bets => Promise.all(bets.map(bet => (new PointsCalculator(results)).process(bet))))
      .then(bets => Promise.all(bets.map(bet => bet.save())))
      .then(() => console.log("Updated scores for round", event.event.round));
  });
};
