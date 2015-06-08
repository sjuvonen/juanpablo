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
  var events = exports.events = new EventCache(bot.config.events.file);
  events.reload();

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

var EventCache = function(file) {
  this.file = file;
  this.events = [];
};

EventCache.prototype = {
  reload: function() {
    var cache = this;
    return new Promise(function(resolve, reject) {

      fs.readFile(cache.file, function(err, data) {
        if (err) {
          throw err;
        }

        (new Parser).parse(data.toString()).then(function(events) {
          cache.events = events;
          resolve();
        }).catch(function(error) {
          reject();
        });
      });
    });
  },
  _next: function(type) {
    var now = new Date;

    for (var i = 0; i < this.events.length; i++) {
      var event = this.events[i];
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
          }));

          if (events.length == items.length) {
            resolve(events);
          }
        });
      });
    });
  }
};
