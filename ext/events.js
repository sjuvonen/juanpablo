/**
 * Displays info about F1 race events.
 *
 * Events are read from an ICS file stored locally.
 */

var fs = require("fs");
var ical = require("ical.js");
var moment = require("moment");
var Promise = require("promise");
var util = require("util");

exports.initialize = function(bot) {
  var events = new EventCache(bot.events, bot.config.events.file);
  bot.shared.events = events;

  events.reload().then(function() {
    events.watch();
  });

  bot.addCommand("next", function() {
    return new Promise(function(resolve, reject) {
      var event = events.nextEvent;

      if (!event) {
        return resolve("No event info found!");
      }

      var now = new Date;
      var date = moment.utc(event.date);
      var diff = moment.duration(date.diff(new Date));
      var timestamp = date.format("MMMM D, HH:mm UTC");
      var display = [timestamp];

      if (diff.days() > 0 || diff.hours() > 0 || diff.minutes() > 0) {
        display.push(" (in");

        if (diff.weeks() > 0) {
          display.push(util.format(" %d weeks", diff.weeks()));
        }

        if (diff.days() > 0) {
          display.push(util.format(" %d days", diff.days() % 7));
        }

        if (diff.hours()) {
          display.push(util.format(" %d hours", diff.hours()));
        }

        if (diff.minutes()) {
          display.push(util.format(" %d minutes", diff.minutes()));
        }

        display.push(")");
      }

      display.unshift(event.title + ": ");
      resolve(display.join(""));
    });
  });
};

var EventCache = function(event_manager, file) {
  this.events = event_manager;
  this.file = file;
  this.races = [];

  this.timers = {
    weekendStart: 0,
  };
};

EventCache.prototype = {
  watch: function() {
    if (!this.timers.weekendStart) {
      var race = this.nextRace;
      var ref = moment.utc(race.date).subtract(2, "days").hours(0);
      var diff = moment(ref).diff(new Date);

      var cache = this;

      this.timers.weekendStart = setTimeout(function() {
        cache.events.emit("race.weekend.begin");
      }, diff);

      this.timers.weekendEnd = setTimeout(function() {
        cache.events.emit("race.weekend.end");
      }, moment(race.date).add(1.5, "hours").diff(new Date));
    }
  },
  race: function(num) {
    for (var i = 0; i < this.races.length; i++) {
      var event = this.races[i];
      if (event.type == EventInfo.RACE) {
        if (--num == 0) {
          return event;
        }
      }
    }
  },
  reload: function() {
    var cache = this;
    return new Promise(function(resolve, reject) {
      fs.readFile(cache.file, function(err, data) {
        if (err) {
          throw err;
        }

        (new Parser).parse(data.toString()).then(function(races) {
          cache.races = races;
          resolve();
        });
      });
    });
  },
  _next: function(type) {
    var now = new Date;

    for (var i = 0; i < this.races.length; i++) {
      var event = this.races[i];
      if (event.date >= now) {
        if (!type || event.type == type) {
          return event;
        }
      }
    }
  }
};

Object.defineProperties(EventCache.prototype, {
  nextEvent: {
    get: function() {
      return this._next();
    }
  },
  nextRace: {
    get: function() {
      return this._next(EventInfo.RACE);
    }
  },
  nextQualifying: {
    get: function() {
      return this._next(EventInfo.QUALIFYING);
    }
  },
  lastRace: {
    get: function() {
      var now = new Date;
      var race_i = 0;
      for (var i = 0; i < this.races.length; i++) {
        var event = this.races[i];
        if (event.type == EventInfo.RACE) {
          race_i++;
          if (event.date > now) {
            return this.race(race_i - 1);
          }
        }
      }
      return this.races[this.races.length-1];
    }
  }
});

var EventInfo = function(data) {
  this.data = data;
};

EventInfo.PRACTISE = 1;
EventInfo.QUALIFYING = 2;
EventInfo.RACE = 3;

EventInfo.prototype = {

};

Object.defineProperties(EventInfo.prototype, {
  date: {
    get: function() {
      return this.data.start;
    }
  },
  title: {
    get: function() {
      return this.data.title;
    }
  },
  type: {
    get: function() {
      return this.data.type;
    }
  },
  round: {
    get: function() {
      return this.data.round;
    }
  },
});

var Parser = function() {

};

Parser.prototype = {
  parse: function(data) {
    return new Promise(function(resolve, reject) {
      var parsed = ical.parse(data);
      var cal = new ical.Component(parsed);
      var items = cal.getAllSubcomponents("vevent");
      var events = [];
      var round = 1;

      items.forEach(function(vevent, i) {
        process.nextTick(function() {
          var event = new ical.Event(vevent);
          var parsed = event.summary.match(/([\w\s]+) Session \(([\w\s]+)\)/);
          var title = event.summary;

          if (parsed) {
            title = parsed[1] + ", " + parsed[2];
          }

          var type = title.match(/practi[cs]e/i) ? EventInfo.PRACTISE
            : (title.match(/quali/i) ? EventInfo.QUALIFYING : EventInfo.RACE);

          events.push(new EventInfo({
            title: title,
            location: event.location,
            start: event.startDate.toJSDate(),
            end: event.endDate.toJSDate(),
            type: type,
            round: round,
          }));

          if (type == EventInfo.RACE) {
            round++;
          }

          if (events.length == items.length) {
            resolve(events);
          }
        });
      });
    });
  }
};
