"use strict";

let mongoose = require("mongoose");
let net = require("../net");
let util = require("util");

class NoResultsError extends Error {
  constructor() {
    super("No results");
  }
}

class ErgastParser {
  parse(json) {
    let data = JSON.parse(json).MRData.RaceTable.Races[0];
    if (!data) {
      throw new NoResultsError;
    }
    return data.Results.map(item => ({
      code: item.Driver.code,
      firstName: item.Driver.givenName,
      lastName: item.Driver.familyName,
      number: parseInt(item.number),
      points: parseInt(item.points),
      team: item.Constructor.constructorId,
    }));
  }
}

class ErgastWatcher {
  constructor(season, round) {
    this.season = season;
    this.round = round;
    this.url = util.format("http://ergast.com/api/f1/%d/%d/results.json", season, round);
    this.interval = 1000 * 60 * 10;
  }

  watch() {
    return new Promise((resolve, reject) => {
      this.fetch().then(resolve, error => {
        if (!(error instanceof NoResultsError)) {
          console.error(error.stack);
          console.log("retry results", this.season, this.round);
        }
        setTimeout(() => this.watch(), this.interval);
      });
    });
  }

  fetch() {
    return net.download(this.url).then(response => {
      let results = (new ErgastParser).parse(response.data);
      return results.length ? results : Promise.reject(new Error("Got invalid data"));
    });
  }
}

exports.configure = services => {
  let commands = services.get("command.manager");
  let database = services.get("database");
  let events = services.get("event.manager");
  let Event = database.model("event");

  Event.on("results", race => events.emit("racecalendar.results", {event: race}));

  commands.add("points", () => {
    return Event.standings().then(standings => {
      let drivers = standings.drivers.slice(0, 10).map((row, i) => util.format("%d. %s (%d)", i+1, row[0], row[1]));
      let teams = standings.teams.map((row, i) => util.format("%d. %s (%d)", i+1, row[0], row[1]));
      let after = util.format("Standings after %s", standings.last.name);
      return [after, drivers.join(" "), teams.join(" ")];
    });
  });

  let watchers = new Map;

  let watchResults = () => {
    let query = {
      season: (new Date).getFullYear(),
      type: "race",
      end: {$lt: new Date},
      $or: [
        {results: {$size: 0}},
        {resultsAreUnofficial: true},
      ]
    };

    Event.find(query)
      .sort("-round")
      .then(races => races.map(race => {
        console.log("Wait for results", race.season, race.round);
        let wid = util.format("%d:%d", race.season, race.round);
        if (!watchers.has(wid)) {
          let watcher = new ErgastWatcher(race.season, race.round);
          watchers.set(wid, watcher);
          watcher.watch()
            .then(results => Event.updateResults({season: race.season, round: race.round, type: "race"}, results))
            .then(() => watchers.delete(wid))
            // .then(() => events.emit("racecalendar.result", {season: race.season, round: race.round}))
            .then(() => console.log("Updated result for round", race.round))
            .catch(error => {
              console.log(util.format("Updating results %d/%d failed:", race.round, race.season), error.stack);
            });

        }
      })).catch(error => {
        console.log("raceresults.watch:", error.stack);
      });
  };

  watchResults();

  setInterval(watchResults, 1000 * 60 * 10);
};
