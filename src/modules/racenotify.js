"use strict";

let events = require("colibre-events");
let moment = require("moment");
let util = require("util");
let AgingCache = require("../collection").AgingCache;

/**
 * Implements a weight-sorted list of event listeners.
 */
class Listeners {
  constructor() {
    this.data = new Map;
  }

  add(event_id, weight, callback) {
    if (!callback) {
      callback = weight;
      weight = 0;
    }

    let entry = {
      weight: weight,
      callback: callback,
    };

    if (!this.data.has(event_id)) {
      this.data.set(event_id, [entry]);
    } else {
      let entries = this.data.get(event_id);
      for (let i = 0; i < entries; i++) {
        if (entry.weight < entries[i].weight) {
          entries.splice(i, 0, entry);
          return;
        }
      }
      entries.push(entry);
    }
  }

  get(event_id, with_weights) {
    if (!this.data.has(event_id)) {
      return [];
    }
    let entries = this.data.get(event_id);
    return with_weights ? entries : entries.map(entry => entry.callback);
  }

  forEach(with_weights, callback) {
    if (!callback) {
      callback = with_weights;
    }

    this.data.forEach((entry, key) => {
      if (with_weight) {
        callback(entry, key);
      } else {
        callback(entry, key.callback);
      }
    });
  }

  * keys() {
    return this.data.keys();
  }

  /**
   * @param with_weight {boolean} If set to true, yielded items contain weights, otherwise just the value.
   */
  * entries(with_weights) {
    for (let [event_id, entries] of this.data.entries()) {
      for (let entry of entries.values()) {
        yield [event_id, with_weights ? entry : entry.callback];
      }
    }
  }
}

class GroupingMap {
  constructor() {
    this.data = new Map;
  }

  get size() {
    return this.data.size;
  }

  add(...keys) {
    let value = keys.pop();
    if (this.data.has(keys)) {
      this.data.get(keys).push(value);
    } else {
      this.data.set(keys, [value]);
    }
  }

  get(keys) {
    return this.data.get(key) || [];
  }

  entries() {
    return this.data.entries();
  }
}

class EventNotifier {
  constructor(storage) {
    this.storage = storage;
    this.events = new events.EventManager;
    this.listeners = new Listeners;
    this.interval = 1000 * 60 * 5;
    this.timer = null;
    this.start();
  }

  /**
   * Listen for event.
   *
   * @param event {string} Type of race event (race, qualifying, ...).
   * @param time {number} Time delta relative to event start time in minutes.
   */
  on(event_type, time, callback) {
    if (!callback) {
      callback = time;
      time = 0;
    }
    this.listeners.add(event_type, time, callback);
  }

  start() {
    if (this.timer) {
      throw new Error("EventNotifier is already running");
    }
    this.timer = setInterval(() => this.test, this.interval);
  }

  test() {
    let cache = new GroupingMap;

    for (let [key, entry] of this.listeners.entries(true)) {
      cache.add(key, entry.weight, entry.callback);
    }

    for (let [[event_type, time], listeners] of cache.entries()) {
      let date_min = moment().add(-1 * time, "minutes").toDate();
      let date_max = moment(date_min).add(this.interval, "ms").toDate();
      let query = {type: event_type, start: {$gt: date_min, $lt: date_max}};
      this.storage.findOne(query).sort("-start").then(event => {
        if (event) {
          let timeout = Math.abs(moment(event.start).add(time, "minutes").diff(new Date));
          console.log("set notify for", event.name);
          setTimeout(() => {
            console.log("trigger notifiers");
            listeners.map(callback => callback(event));
          }, timeout);
        }
      });
    }
  }
}

exports.configure = services => {
  services.registerFactory("racecalendar.notifications", () => {
    let storage = services.get("database").model("event");
    let instance = new EventNotifier(storage);
    return instance;
  });
};
