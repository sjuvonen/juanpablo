/**
 * Provices event schedules for F1 season.
 */

"use strict";

let EventEmitter = require("events");
let fs = require("fs");
let ical = require("ical.js");
let moment = require("moment");
let proxy = require("../core/proxy");
let util = require("util");

class EventCalendar {
  constructor(config) {
    this.events = new EventEmitter;
    this.config = config;
    this.calendar = [];

    this.timers = {
      weekStart: null,
      weekendStart: null,
      weekendEnd: null,
    };
  }

  reload() {
    return new Promise((resolve, reject) => {
      fs.readFile(this.filePath, (error, data) => {
        if (error) {
          return reject(error);
        }

        (new CalendarParser).parse(data.toString()).then(events => {
          this.calendar = events;
          resolve();
        });
      });
    });
  }

  watch() {
    if (this.watching) {
      return;
    }

    let race = this.nextRace;
    let ref_date = moment.utc(race.date).substract(2, "days").hours(0);

    this.timers.weekStart = setTimeout(() => {
      this.events.emit("race.week.begin");
    }, moment(ref).startOf("isoweek").diff());

    this.timers.weekendStart = setTimeout(() => {
      this.events.emit("race.weekend.begin");
    }, moment(ref).diff());

    this.timers.weekendEnd = setTimeout(() => {
      this.events.emit("race.week.end");
      this.events.emit("race.weekend.end");
    }, moment(race.date).add(1.5, "hours").diff());
  }

  race(num) {
    for (let i = 0; i < this.calendar.length; i++) {
      let event = this.calendar[i];
      if (event.type == EventInfo.RACE) {
        if (--num == 0) {
          return event;
        }
      }
    }
  }

  findNext(type) {
    let now = new Date;
    for (let i = 0; i < this.calendar.length; i++) {
      let event = this.calendar[i];
      if (event.date >= now) {
        if (!type || event.type == type) {
          return event;
        }
      }
    }
  }

  get currentEvent() {
    let now = new Date;
    for (let i = 0; i < this.calendar.length; i++) {
      let event = this.calendar[i];
      if (event.data.start >= now && event.data.end <= now) {
        return event;
      }
    }
  }

  get nextEvent() {
    return this.findNext();
  }

  get nextRace() {
    return this.findNext(EventInfo.RACE);
  }

  get lastRace() {
    if (this.nextRace) {
      return this.race(this.nextRace.round - 1);
    } else {
      return this.race(this.calendar[this.calendar.length - 1].round - 1);
    }
  }

  get nextQualifying() {
    return this.findNext(EventInfo.QUALIFYING);
  }

  get lastRace() {
    let now = new Date;
    let race_i = 0;
    for (let i = 0; i < this.calendar.length; i++) {
      let event = this.calendar[i];
      if (event.type == EventInfo.RACE) {
        race_i++;
        if (event.date > now) {
          return this.race(race_i - 1);
        }
      }
    }
    return this.calendar[this.calendar.length - 1];
  }

  get filePath() {
    return this.config.file;
  }

  get watching() {
    return this.timers.weekendStart != null;
  }
}

class CalendarParser {
  parse(data) {
    return new Promise((resolve, reject) => {
      let parsed = ical.parse(data);
      let cal = new ical.Component(parsed);
      let items = cal.getAllSubcomponents("vevent");
      let events = [];
      let round = 1;

      items.forEach((vevent, i) => {
        process.nextTick(() => {
          let event = new ical.Event(vevent);
          let parsed = event.summary.match(/([\w\s]+) Session \(([\w\s]+)\)/);
          let title = event.summary;

          if (parsed) {
            title = parsed[1] + ", " + parsed[2];
          }

          let type = title.match(/practi[cs]e/i) ? EventInfo.PRACTISE
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
}

class EventInfo {
  constructor(data) {
    this.data = data;
  }

  get date() {
    return this.data.start;
  }

  get type() {
    return this.data.type;
  }

  get title() {
    return this.data.title;
  }

  get round() {
    return this.data.round;
  }
}

EventInfo.PRACTISE = 1;
EventInfo.QUALIFYING = 2;
EventInfo.RACE = 3;

exports.configure = function(connection) {
  let calendar = new EventCalendar(connection.config.modules.seasoncalendar);

  calendar.reload().then(proxy(calendar.watch, calendar), error => {
    console.error("eventcalendar:", error.stack);
  });

  connection.addCommand("next", () => {
    return new Promise((resolve, reject) => {
      let current = calendar.currentEvent;

      if (current) {
        return resolve(util.format("Currently running: %s", current.title));
      }

      let event = calendar.nextEvent;

      if (!event) {
        return reject("No event info found");
      }

      let date = moment.utc(event.date);
      let diff = moment.duration(date.diff());
      let timestamp = date.format("MMMM D, HH:mm UTC");
      let display = [event.title + ": ", timestamp];

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

      resolve(display.join(""));
    });
  });

  return calendar;
};
