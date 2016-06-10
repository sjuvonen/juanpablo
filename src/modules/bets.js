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
  bets: [{
    _id: false,
    firstName: String,
    lastName: String,
    code: String
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
  console.log("D", max_date);
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
    console.log("W", values);
    return Bet
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

let Bet = mongoose.model("bet", BetSchema);

class PointsCalculator {
  constructor(results) {
    this.results = results;
    this.scoring = [10, 5, 3, 1];
    this.bonus = 5;
  }

  process(bet) {
    return new Promise((resolve, reject) => {
      bet.points = this.scores(...bet.bets);
      resolve(bet);
    });
  }

  scores(d1, d2, d3) {
    let points = [d1, d2, d3].reduce((value, driver, i) => {
      if (driver.code == this.results[i].code) {
        return value + this.scoring[i];
      } else if (this.driverOnPodium(driver)) {
        return value + this.scoring[3];
      }
      return value;
    }, 0);

    let max = this.scoring.slice(0, 3).reduce((sum, x) => sum + x, 0);

    if (points == max) {
      points += this.bonus;
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
  let Result = database.model("result");
  let Event = database.model("event");

  commands.add("bet", (nick, ...names) => {
    if (names.length == 0) {
      return Bet.userBets(nick, this.activeEvent.round).then(doc => {
        if (doc) {
          let names = doc.bets.map((d, i) => util.format("%d. %s %s", i+1, d.firstName, d.lastName));
          return util.format("%s: %s", nick, names.join(" "));
        } else {
          return Promise.resolve(util.format("%s: You have no bets for this round", nick));
        }
      });
    } else {
      return whois.auth(nick)
        // .catch(() => ({nick: nick, account: nick + "_auth"}))
        .then(account => Bet.setUserBets(account, this.activeEvent.round, names))
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
  })
  .validate(() => {
    return Bet.activeBetRound().then(event => {
      // console.log("GOT EVENT", event);
      this.activeEvent = event;
    });
  });

  commands.add("top", (nick, round) => {
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

  events.on("raceresults.result", event => {
    let query = {season: event.season, round: event.round};
    Promise.all([Result.findOne(query), Bet.find(query)])
      .then(([result, bets]) => Promise.all(bets.map(bet => (new PointsCalculator(result.results)).process(bet))))
      .then(bets => Promise.all(bets.map(bet => bet.save())))
      .then(() => console.log("Updated scores for round", event.round));
  });

  // (new Bet({
  //   account: "foobar_demo",
  //   nick: "foobar",
  //   season: 2016,
  //   round: 3,
  //   bets: [
  //     {firstName: "Lewis", lastName: "Hamilton", code: "HAM"},
  //     {firstName: "Kimi", lastName: "Räikkönen", code: "RAI"},
  //     {firstName: "Sebastian", lastName: "Vettel", code: "VET"}
  //   ]
  // })).save();
  //
  // (new Bet({
  //   account: "foobar_demo",
  //   nick: "foobar",
  //   season: 2016,
  //   round: 2,
  //   bets: [
  //     {firstName: "Lewis", lastName: "Hamilton", code: "HAM"},
  //     {firstName: "Nico", lastName: "Rosberg", code: "ROS"},
  //     {firstName: "Jenson", lastName: "Button", code: "Button"}
  //   ]
  // })).save();
  //
  // (new Bet({
  //   account: "foobar_demo",
  //   nick: "foobar",
  //   season: 2016,
  //   round: 5,
  //   bets: [
  //     {firstName: "Nico", lastName: "Rosberg", code: "ROS"},
  //     {firstName: "Kimi", lastName: "Räikkönen", code: "RAI"},
  //     {firstName: "Fernando", lastName: "Alonso", code: "ALO"}
  //   ]
  // })).save();
  //
  // (new Bet({
  //   account: "miska_demo",
  //   nick: "miska",
  //   season: 2016,
  //   round: 3,
  //   bets: [
  //     {firstName: "Sebastian", lastName: "Vettel", code: "VET"},
  //     {firstName: "Lewis", lastName: "Hamilton", code: "HAM"},
  //     {firstName: "Kimi", lastName: "Räikkönen", code: "RAI"},
  //   ]
  // })).save();
  //
  // (new Bet({
  //   account: "miska_demo",
  //   nick: "miska",
  //   season: 2016,
  //   round: 5,
  //   bets: [
  //     {firstName: "Lewis", lastName: "Hamilton", code: "HAM"},
  //     {firstName: "Nico", lastName: "Rosberg", code: "ROS"},
  //       {firstName: "Sebastian", lastName: "Vettel", code: "VET"},
  //   ]
  // })).save();


  // let sqlite = require("sqlite3");
  // let source = new sqlite.Database("data/database.sqlite");

  // database.model("season").findOne({_id: 2016}).then(season => {
  //   let drivers = new Map(season.drivers.map(d => [d.firstName + " " + d.lastName, d]));
  //   drivers.set("Pastor Maldonado", {firstName: "Pastor", lastName: "Maldonado", code: "MAL"});
  //   drivers.set("Sergio Perez", {firstName: "Sergio", lastName: "Pérez", code: "PER"});
  //   drivers.set("Roberto Merhi", {firstName: "Roberto", lastName: "Merhi", code: "MER"});
  //   drivers.set("Nico Hulkenberg", {firstName: "Nico", lastName: "Hülkenberg", code: "HUL"});
  //
  //   source.all("SELECT * from betgame_bets", (error, rows) => {
  //     rows.map(row => {
  //       let bet = new Bet({
  //         account: row.user,
  //         nick: row.nick,
  //         season: row.season,
  //         round: row.round,
  //         created: new Date(row.time),
  //         bets: [row.d1, row.d2, row.d3].map(name => {
  //           if (!drivers.has(name)) {
  //             console.error("NO NAME", name);
  //           }
  //           return drivers.get(name)
  //         }),
  //       });
  //       bet.save();
  //     });
  //   });
  // });

  // source.all("SELECT * FROM betgame_points WHERE season = 2015", (error, rows) => {
  //   rows.map(row => {
  //     Bet.findOne({account: row.user, season: row.season, round: row.round}).then(bet => {
  //       bet.points = row.points;
  //       bet.save();
  //     });
  //   });
  // });
};
