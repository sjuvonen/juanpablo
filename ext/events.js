
var fs = require("fs");
var ical = require("ical.js");
var moment = require("moment");
var Promise = require("promise");
var util = require("util");

exports.initialize = function(bot) {
  var events = new EventCache(bot.config.events.file);
  events.reload();

  bot.addCommand("next", function() {
    return new Promise(function(resolve, reject) {
      var event = events.nextEvent;

      if (!event) {
        return resolve("No event info found!");
      }

      var date = moment.utc(event.date);
      var diff = moment.duration(date.diff(new Date));
      var timestamp = date.format("MMMM D, HH:mm UTC");
      var display = [timestamp];

      if (diff.hours() > 0 || diff.minutes() > 0) {
        display.push(" (in");

        if (diff.hours() > 0) {
          display.push(util.format(" %d hours", diff.hours()));
        }

        if (diff.minutes() > 0) {
          display.push(util.format(" %d minutes", diff.minutes()));
        }

        display.push(")");
      }

      display.unshift(event.title + ": ");

      var message = display.join("");

      resolve(message);
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
  }
};

Object.defineProperties(EventCache.prototype, {
  nextEvent: {
    get: function() {
      var now = new Date;

      for (var i = 0; i < this.events.length; i++) {
        if (this.events[i].date >= now) {
          return this.events[i];
        }
      }
    }
  },
});

var EventInfo = function(data) {
  this.data = data;
};

EventInfo.PRACTISE = 1;
EventInfo.QUALI = 2;
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
  }
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

          events.push(new EventInfo({
            title: title,
            location: event.location,
            start: event.startDate.toJSDate(),
            end: event.endDate.toJSDate(),
          }));

          if (events.length == items.length) {
            resolve(events);
          }
        });
      });
    });
  }
};
