"use strict";

let moment = require("moment");
let util = require("util");

class DriverResolver {
  constructor(season) {
    this.season = season;
  }

  resolve(names) {
    let cache = new Map(this.season.drivers.map(driver => {
      let regexp = this.toRegExp(driver.lastName);
      return [regexp, driver];
    }));
    let drivers = names.map(name => {
      for (let regexp of cache.keys()) {
        if (regexp.test(name)) {
          return cache.get(regexp);
        }
      }
      throw new Error(util.format("Name '%s' not found in the of drivers", name));
    });

    drivers.forEach(driver => {
      if (drivers.indexOf(driver) < i) {
        throw new Error(util.format("Duplicate driver '%s'", driver.code));
      }
    });

    return drivers;
  }

  toRegExp(name) {
    let pattern = name.replace(/[^A-Z]/gi, ".");
    return new RegExp(pattern, "i");
  }
}

class TopicParser {
  static parse(topic) {
    /*
     * Matches topics formatted as list of results. Requires at least 10 names as that number of
     * drivers are granted points. Also, we might need them for calculating bet points in the future.
     */
    let regexp = /(\d+\.([\w\s\u00C0-\u0179]+)){10,}/g;
    let match = topic.match(regexp);

    if (!match) {
      throw new Error("Invalid topic");
    }

    let names = match[0].split(/[\d\.\s]+/).filter(s => s.length > 0);
    return names;
  }
}

exports.configure = services => {
  let events = services.get("event.manager");
  let database = services.get("database");
  let Season = database.model("season");
  let Event = database.model("event");

  events.on("topic", event => {
    try {
      let names = TopicParser.parse(event.topic);
      Season.findOne({_id: (new Date).getFullYear()}).then(season => {
        let resolver = new DriverResolver(season);
        let drivers = resolver.resolve(names);

        Event.findPendingRace()
          .then(race => {
            race.updateResults(drivers, false);
          })
          .catch(error => {
            console.error("topicresults.unofficial:", error.stack);
          });
      });

    } catch (error) {
      // pass
    }
  });
};
