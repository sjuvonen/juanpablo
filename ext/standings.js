/**
 * Prints driver and team points.
 *
 * Standings are parsed from formula1.com.
 */

"use strict";

let entities = require("entities");
let htmlparser = require("htmlparser2");
let Promise = require("promise");
let net = require("../core/net");
let util = require("util");

exports.initialize = function(bot) {
  let drivers = new Standings({
    net: net,
    mode: Parser.READ_DRIVERS,
    url: bot.config.standings.drivers
  });

  let teams = new Standings({
    net: net,
    mode: Parser.READ_TEAMS,
    url: bot.config.standings.teams
  });

  bot.shared.drivers = drivers;
  bot.shared.teams = teams;

  bot.addCommand("points", function() {
    return new Promise(function(resolve, reject) {
      let reply = [];
      drivers.get().then(function(d_pts) {
        let row = d_pts.slice(0, 3).map(formatItem);
        reply.push("Drivers: " + row.join("; "));

        teams.get().then(function(t_pts) {
          let row = t_pts.slice(0, 3).map(formatItem);
          reply.push("Teams: " + row.join("; "));

          resolve(reply);
        });
      }).catch(function(e) {
        console.log("f", e);
      });
    });
  });
};

let formatItem = function(item, i) {
  return util.format("%d. %s (%d pts)", i+1, item.name, item.points);
};

let Standings = function(options) {
  this.net = options.net;
  this.mode = options.mode;
  this.url = options.url;
  this.updated = new Date(null);
  this._standings = null;

  this.get();
};

Standings.prototype = {
  get: function(force_cache) {
    let cache = this;
    return new Promise(function(resolve, reject) {
      if (!cache.needsRefresh || (force_cache && cache.standings)) {
        return resolve(cache.standings);
      }

      cache.net.download(cache.url).then(function(response) {
        (new Parser(cache.mode)).parse(response.data.toString()).then(function(standings) {
          cache.standings = standings;
          resolve(standings);
        });
      }).catch(function(error) {
        console.log("failed", error);
      });
    });
  }
};

Object.defineProperties(Standings.prototype, {
  standings: {
    get: function() {
      return this._standings;
    },
    set: function(value) {
      this._standings = value;
      this.updated = new Date;
    }
  },
  needsRefresh: {
    get: function() {
      let interval = 300 * 1000;
      return (new Date) - this.updated >= interval;
    }
  }
});

let Parser = function(mode) {
  this.mode = mode;
};

Parser.READ_DRIVERS = 1;
Parser.READ_TEAMS = 2;

Parser.prototype = {
  parse: function(html) {
    let State = {
      WAIT: 0,
      WAIT_TABLE: 1,

      WAIT_NAME: 2,
      READ_NAME: 3,

      WAIT_POINTS: 30,
      READ_POINTS: 31,
    };

    let mode = this.mode;

    return new Promise(function(resolve, reject) {
      process.nextTick(function() {
        let standings = [];
        let state = State.WAIT;
        let item;

        let parser = new htmlparser.Parser({
          onopentag: function(tag, attrs) {
            switch (state) {
              case State.WAIT:
                if (tag == "div" && attrs.class == "standings") {
                  state = State.WAIT_TABLE;
                }
                break;

              case State.WAIT_TABLE:
                if (tag == "tbody") {
                  state = State.WAIT_NAME;
                }
                break;

              case State.WAIT_NAME:
                if (tag == "tr") {
                  item = {
                    name: "",
                    points: null,
                  };

                  standings.push(item);
                }
                if (mode == Parser.READ_TEAMS) {
                  if (tag == "td" && attrs.class == "name") {
                    state = State.READ_NAME;
                  }
                } else {
                  if (tag == "span" && ["first-name", "last-name"].indexOf(attrs.class) >= 0) {
                    state = State.READ_NAME;
                  }
                }
                break;

              case State.READ_NAME:
                if (tag == "span" && attrs.class == "tla") {
                  state = State.WAIT_POINTS;
                }
                break;

              case State.WAIT_POINTS:
                if (tag == "td" && attrs.class == "points") {
                  state = State.READ_POINTS;
                }
                break;
            }
          },
          ontext: function(text) {
            switch (state) {
              case State.READ_NAME:
                item.name = (item.name + " " + text.trim()).trim();
                break;

              case State.READ_POINTS:
                item.points = text;
                break;
            }
          },
          onclosetag: function(tag) {
            switch (state) {
              case State.READ_NAME:
                if (mode == Parser.READ_TEAMS && tag == "td") {
                  state = State.WAIT_POINTS;
                }
                break;
              case State.READ_POINTS:
                if (tag == "td") {
                  state = State.WAIT_NAME;
                }
                break;
            }
          },
        });

        parser.write(html);
        parser.end();

        standings.forEach(function(item) {
          item.name = entities.decodeHTML(item.name);
        });

        resolve(standings);
      });
    });
  }
};
