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
  results: [String]
});

EventSchema.statics.findCurrent = function() {

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
    return Event.findNext().then(event => {
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
    });
  });
};
