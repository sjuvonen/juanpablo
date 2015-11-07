/**
 * Display information about worldchampionship standings.
 */

"use strict";

let entities = require("entities");
let htmlparser = require("htmlparser2");
let net = require("../core/net");
let util = require("util");

class Standings {
  constructor(parser, config) {
    this.parser = parser;
    this.config = config;
    this.updated = new Date(null);

    Object.defineProperty(this, "meta", {
      enumerable: false,
      value: {},
    });

    this.meta.standings = [];
    this.reload();
  }

  reload(force_cache) {
    return new Promise((resolve, reject) => {
      if (!this.shouldRefresh || (force_cache && this.standings)) {
        return resolve(this.standings);
      }

      net.download(this.url).then(response => {
        this.parser.parse(response.data.toString()).then(standings => {
          this.standings = standings;
          resolve(standings);
        });
      }).catch(error => {
        console.error("standings:", error.stack);
        return error;
      });
    });
  }

  get standings() {
    return this.meta.standings;
  }

  set standings(value) {
    this.meta.standings = value;
    this.updated = new Date;
  }

  get shouldRefresh() {
    let interval = 300 * 1000;
    return (new Date) - this.updated >= interval;
  }

  get url() {
    return this.config.url;
  }
}

class F1comParser {
  constructor(mode) {
    this.mode = mode;
  }

  parse(html) {
    let State = {
      WAIT: 0,
      WAIT_TABLE: 1,

      WAIT_NAME: 2,
      READ_NAME: 3,

      WAIT_POINTS: 30,
      READ_POINTS: 31,
    };

    let mode = this.mode;

    return new Promise((resolve, reject) => {
      process.nextTick(() => {
        let standings = [];
        let state = State.WAIT;
        let item;

        let parser = new htmlparser.Parser({
          onopentag: (tag, attrs) => {
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
                if (mode == F1comParser.READ_TEAMS) {
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
          ontext: text => {
            switch (state) {
              case State.READ_NAME:
                item.name = (item.name + " " + text.trim()).trim();
                break;

              case State.READ_POINTS:
                item.points = text;
                break;
            }
          },
          onclosetag: tag => {
            switch (state) {
              case State.READ_NAME:
                if (mode == F1comParser.READ_TEAMS && tag == "td") {
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

        standings.forEach(item => {
          item.name = entities.decodeHTML(item.name);
        });

        resolve(standings);
      });
    });
  }
}

F1comParser.READ_DRIVERS = 1;
F1comParser.READ_TEAMS = 2;

class ResultsArchive {
  constructor(drivers, teams) {
    this.drivers = drivers;
    this.teams = teams;
  }
}

exports.configure = function(connection) {
  let drivers = new Standings(new F1comParser(F1comParser.READ_DRIVERS), {
    url: connection.config.modules.standings.drivers
  });
  let teams = new Standings(new F1comParser(F1comParser.READ_TEAMS), {
    url: connection.config.modules.standings.teams
  });
  let formatItem = function(item, i) {
    return util.format("%d. %s (%d pts)", i+1, item.name, item.points);
  };

  connection.addCommand("points", () => {
    return new Promise((resolve, reject) => {
      let reply = [];
      drivers.reload().then(d_pts => {
        let row = d_pts.slice(0, 10).map(formatItem);
        reply.push("Drivers: " + row.join("; "));

        teams.reload().then(t_pts => {
          let row = t_pts.slice().map(formatItem);
          reply.push("Teams: " + row.join("; "));
          resolve(reply);
        }, reject);
      }, error => {
        console.error("standings:", error.stack);
        return error;
      });
    });
  });

  let archive = new ResultsArchive(drivers, teams);
  return archive;
};
