"use strict";

let moment = require("moment");
let mongoose = require("mongoose");
let util = require("util");

let EventSchema = new mongoose.Schema({
  round: Number,
  season: Number,
  name: String,
  start: Date,
  end: Date,
  type: {
    type: String,
    enum: ["practise", "qualifying", "race", "test"]
  },
  resultsAreUnofficial: Boolean,
  results: [{
    _id: false,
    code: String,
    firstName: String,
    lastName: String,
    number: Number,
    points: Number,
    team: String,
  }],
});

EventSchema.statics.findPrevious = function(event_type) {
  let params = {
    end: {
      $lt: new Date
    }
  };
  if (event_type) {
    params.type = event_type;
  }
  return Promise.resolve(this.findOne(params).sort("-end"));
};

EventSchema.statics.findNext = function(event_type) {
  let params = {
    start: {
      $gt: new Date
    }
  };
  if (event_type) {
    params.type = event_type;
  }
  return Promise.resolve(this.findOne(params).sort("start"));
};

EventSchema.statics.findNextRace = function() {
  return this.findNext(Event.RACE);
};

EventSchema.statics.findPendingRace = function() {
  let time_limit = moment().subtract(30, "minutes").toDate();

  let query = {
    type: "race",
    start: {$lt: time_limit},
    end: {$gt: time_limit},
    $or: [
      {results: {$size: 0}},
      {resultsAreUnofficial: true},
    ]
  };

  return this.findOne(query).then(race => {
    return race || Promise.reject(new Error("There are no races waiting for results"));
  });
};

EventSchema.statics.latestResult = function() {
  return this.findOne({results: {$ne: []}}).sort({season: -1, round: -1});
};

EventSchema.statics.standings = function() {
  let Season = this.db.model("season");
  return this.find({type: "race", results: {$ne: []}}).sort({season: -1, round: -1}).limit(30)
    .then(races => {
      let standings = {
        last: null,
        drivers: null,
        teams: null,
      };
      let drivers = new Map;
      let teams = new Map;

      races.forEach((race, i) => {
        if (i == 0) {
          standings.last = race;
        }
        race.results.forEach(item => {
          let driver = util.format("%s %s", item.firstName, item.lastName);
          let d_points = (drivers.get(driver) || 0) + item.points;
          drivers.set(driver, d_points);

          let t_points = (teams.get(item.team) || 0) + item.points;
          teams.set(item.team, t_points);
        });
      });

      standings.drivers = [...drivers.entries()].sort((a, b) => b[1] - a[1]);
      standings.teams = [...teams.entries()].sort((a, b) => b[1] - a[1]);

      return standings;
    })
    .then(standings => standings.drivers.length ? standings : Promise.reject(new Error("No points data found.")))
    .then(standings => {
      return Season.findOne({_id: standings.last.season}).then(season => {
        let teams = new Map(season.teams.map(t => [t.code, t.name]));
        standings.teams.forEach(row => {
          row[0] = teams.get(row[0]) || row[0];
        });
        return standings;
      });
    });
};

EventSchema.methods.updateResults = function(results, final) {
  this.results = results;
  this.resultsAreUnofficial = !final;

  this.save().then(() => this.constructor.emit("results", this));
};

EventSchema.statics.updateResults = function(params, results, final) {
  this.findOne(params).then(event => event.updateResults(results, final));
};

let Event = mongoose.model("event", EventSchema);

Event.RACE = "race";
Event.PRACTISE = "practise";
Event.QUALIFYING = "qualifying";
Event.TEST = "test";

class IcsParser {
  * parse(data) {
    let ical = require("ical.js");
    let parsed = ical.parse(data);
    let cal = new ical.Component(parsed);
    let events = cal.getAllSubcomponents("vevent");
    let round = 1;

    for (let i = 0; i < events.length; i++) {
      let event = new ical.Event(events[i]);
      let parsed = event.summary.match(/([\w\s]+) Session \(([\w\s]+)\)/);
      let title = event.summary;

      if (parsed) {
        title = parsed[1] + ", " + parsed[2];
      }

      let type = title.match(/practi[cs]e/i) ? Event.PRACTISE
        : (title.match(/quali/i) ? Event.QUALIFYING : Event.RACE);

      let entry = {
        name: title,
        location: event.location,
        season: event.startDate.toJSDate().getFullYear(),
        start: event.startDate.toJSDate(),
        end: event.endDate.toJSDate(),
        type: type,
        round: [Event.PRACTISE, Event.QUALIFYING, Event.RACE].indexOf(type) != -1 ? round : null,
      };

      yield entry;

      if (type == Event.RACE) {
        round++;
      }
    }
  }
}

function timeToEvent(event) {
  let date = moment.utc(event.start);
  let diff = moment.duration(date.diff());
  let timestamp = date.format("MMMM D, HH:mm UTC");
  let display = [event.name + ": ", timestamp];

  if (diff.days() > 0 || diff.hours() > 0 || diff.minutes() > 0) {
    display.push(" (in");

    if (diff.months() == 1) {
      display.push(" 1 month");
    } else if (diff.months() > 1) {
      display.push(util.format(" %d months", diff.months()));
    }

    if (diff.weeks() == 1) {
      display.push(" 1 week");
    } else if (diff.months() > 1) {
      display.push(util.format(" %d weeks", diff.months()));
    }

    if (diff.days() == 1) {
      display.push(" 1 day");
    } else if (diff.days() > 1) {
      display.push(util.format(" %d days", diff.days() % 7));
    }

    if (diff.hours() == 1) {
      display.push(" 1 hour");
    } else if (diff.hours() > 1) {
      display.push(util.format(" %d hours", diff.hours()));
    }

    if (diff.minutes() == 1) {
      display.push(" 1 minute");
    } else if (diff.minutes() > 1) {
      display.push(util.format(" %d minutes", diff.minutes()));
    }

    display.push(")");
  }

  return display.join("");
}

exports.configure = services => {
  // Import calendar from file if current season has no events.
  services.get("database").model("event").where({season: (new Date).getFullYear()}).count().then(count => {
    if (!count) {
      let source = services.get("config").get("modules.racecalendar.file");
      let icsdata = require("fs").readFileSync(source).toString();
      let importer = services.get("mongoose.importer", Event, new IcsParser);
      importer.importData(icsdata).catch(error => console.error(error.stack));
    }
  });

  services.get("command.manager").add("next", () => {
    let now = {start: {$lt: new Date}, end: {$gt: new Date}};

    return Promise.all([Event.findOne(now), Event.findNext()]).then(([current, next]) => {
      if (!current && !next) {
        throw new Error("No event data found");
      }

      let message = [];

      if (current) {
        message.push("NOW RUNNING: " + timeToEvent(current));
      }

      if (next) {
        message.push("Next: " + timeToEvent(next));
      }

      return message;
    });
  });
};
