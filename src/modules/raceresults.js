"use strict";

let mongoose = require("mongoose");
let net = require("../net");
let util = require("util");

let ResultSchema = new mongoose.Schema({
  season: Number,
  round: Number,
  date: Date,
  results: [{
    _id: false,
    number: Number,
    round: Number,
    code: String,
    firstName: String,
    lastName: String,
    points: Number,
  }],
});

ResultSchema.statics.latestResult = function() {
  return this.findOne().sort({season: -1, round: -1});
};

ResultSchema.statics.driverStandings = function() {
  return this.latestResult()
    .then(last => last || {})
    .then(last => this.find({season: last.season}))
    .then(races => races.reduce((standings, race) => {
      race.results.forEach(item => {
        let name = util.format("%s %s", item.firstName, item.lastName);
        let points = (standings.get(name) || 0) + item.points;
        standings.set(name, points);
      });
      return standings;
    }, new Map))
  .then(standings => [...standings.entries()].sort((a, b) => b[1] - a[1]))
  .then(entries => entries.length ? entries : Promise.reject(new Error("No points data found.")));
};

let Result = mongoose.model("result", ResultSchema);

class ErgastParser {
  parse(json) {
    let data = JSON.parse(json).MRData.RaceTable.Races[0];
    return {
      season: parseInt(data.season),
      round: parseInt(data.round),
      date: new Date(util.format("%sT%s", data.date, data.time)),
      results: data.Results.map(item => ({
        number: parseInt(item.number),
        points: parseInt(item.points),
        code: item.Driver.code,
        firstName: item.Driver.givenName,
        lastName: item.Driver.familyName,
      })),
    };
  }
}

class ErgastWatcher {
  constructor(season, round) {
    this.season = season;
    this.round = round;
    this.url = util.format("http://ergast.com/api/f1/%d/%d/results.json", season, round);
    this.interval = 10 * 1000;
  }

  watch() {
    return new Promise((resolve, reject) => {
      this.fetch().then(resolve, error => {
        console.error(error.stack);
        console.log("retry results", this.season, this.round);
        setTimeout(() => this.watch(), this.interval);
      });
    });
  }

  fetch() {
    return net.download(this.url).then(response => {
      let result = (new ErgastParser).parse(response.data);
      return result.results.length ? result : Promise.reject(new Error("Got invalid data"));
    });
  }
}

exports.configure = services => {
  // let watcher = new ErgastWatcher(2016, 2);
  // watcher.watch()
  //   .then(result => Result.update({season: result.season, round: result.round}, result, {upsert: true}))
  //   .then(() => {
  //     console.log("Updated result");
  //   });

  services.get("command.manager").add("points", () => {
    return services.get("database").model("result").driverStandings()
      .then(standings => standings.slice(0, 10).map((row, i) => util.format("%d. %s (%d)", i+1, row[0], row[1])))
      .then(standings => standings.join(" "));
  });

};
