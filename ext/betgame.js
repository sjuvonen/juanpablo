/**
 * Game for guessing race results
 */

"use strict";

let EventEmitter = require("events");
let htmlparser = require("htmlparser2");
let moment = require("moment");
let sqlite = require("sqlite3");
let util = require("util");

let commands = require("../core/commands");
let net = require("../core/net");

class RaceResults {
  constructor(config) {
    this.config = config;
    this.sources = [];
    this.results = [];
  }

  get url() {
    return this.config.results;
  }

  get(i) {
    if (arguments.length == 0) {
      throw new Error("Have to define which round to fetch");
    }
    return new Promise((resolve, reject) => {
      if (i < this.results.length) {
        return resolve(this.results[i]);
      }
      this.fetchRace(i).then(result => {
        resolve(result);
      });
    });
  }

  fetchRace(i) {
    let cache = this;
    return new Promise((resolve, reject) => {
      net.download(this.url).then(response => {
        (new WikipediaParser({round: i})).parse(response.data.toString()).then(result => {
          if (result.length) {
            this.results[i] = result;
            resolve(result);
          } else {
            return reject(-1);
          }
        }, error => {
          console.error("raceresults.fetchrace:", error);
          return error;
        });
      });
    });
  }
}

class WikipediaParser {
  constructor(config) {
    this.config = config;
  }

  get round() {
    return this.config.round;
  }

  parse(html) {
    let State = {
      WAIT: 0,
      WAIT_TITLE_SPAN: 1,
      WAIT_LEGEND_TABLE: 2,
      WAIT_RESULTS_TABLE: 3,
      RESULTS_TABLE: 4,
      CELL_NAME: 5,
      SKIP_FLAG_ANCHOR: 6,
      READ_NAME: 7,
      CELL_RESULT: 8,
    };
    let target_round = this.round;
    return new Promise((resolve, reject) => {
      let result = [];
      let cell_i = 0;
      let name = null;
      let state = State.WAIT;

      try {
        let parser = new htmlparser.Parser({
          onopentag: (tag, attrs) => {
            switch (state) {
              case State.WAIT:
                if (tag == "h3") {
                  state = State.WAIT_TITLE_SPAN;
                }
                break;
              case State.WAIT_TITLE_SPAN:
                if (tag == "span" && attrs.id && attrs.id.match(/drivers[\w\.]+standings/i)) {
                  state = State.WAIT_LEGEND_TABLE;
                }
                break;
              case State.WAIT_LEGEND_TABLE:
              case State.WAIT_RESULTS_TABLE:
                if (tag == "table") {
                  state++;
                }
                break;
              case State.RESULTS_TABLE:
                if (tag == "td") {
                  state++;
                }
                break;
              case State.CELL_NAME:
              case State.SKIP_FLAG_ANCHOR:
                if (tag == "a") {
                  state++;
                }
                break;
              case State.CELL_RESULT:
                if (tag == "td") {
                  cell_i++;
                }
                break;
            }
          },
          ontext: text => {
            switch (state) {
              case State.READ_NAME:
                name = text.trim();
                break;
              case State.CELL_RESULT:
                if (cell_i == target_round && text.trim().length) {
                  let pos = parseInt(text.trim());
                  if (pos) {
                    result[pos-1] = name;
                  }
                }
                break;
            }
          },
          onclosetag: tag => {
            switch (state) {
              case State.RESULTS_TABLE:
                if (tag == "table") {
                  state = -1;
                }
                break;
              case State.READ_NAME:
                if (tag == "a") {
                  state = State.CELL_RESULT;
                  cell_i = 0;
                }
                break;
              case State.CELL_RESULT:
                if (tag == "tr") {
                  state = State.RESULTS_TABLE;
                }
                break;
            }
          },
        });
        parser.write(html);
        parser.end();
      } catch (e) {
        console.error("betgame.parser:", error.stack);
        return reject(error.toString());
      }

      resolve(result.slice(0, 10));
    });
  }
}

class PointsCalculator {
  constructor(results) {
    this.results = results;
  }

  process(bets) {
    return new Promise((resolve, reject) => {
      let points = bets.map((row, i) => ({
        user: row.user,
        nick: row.nick,
        points: this.scores(row),
      }));
      points.sort((a, b) => b.points - a.points);
      resolve(points);
    });
  }

  scores(row) {
    let scoring = [10, 5, 3, 1];
    let bonus = 5;
    let res = this.results;

    let points = [row.d1, row.d2, row.d3].reduce((value, name, i) => {
      if (name == res[i]) {
        return value + scoring[i];
      } else if (this.driverOnPodium(name)) {
        return value + scoring[3];
      }
    }, 0);

    let max = scoring.slice(0, 3).reduce((sum, x) => sum + x, 0);

    if (points == max) {
      points += bonus;
    }

    return points;
  }
}

class Bets {
  constructor(database) {
    this.db = database;
  }

  round(round, user) {
    return new Promise((resolve, reject) => {
      let sql = "\
        SELECT user, nick, d1, d2, d3 \
        FROM betgame_bets \
        WHERE round = $round AND season = $season";
      let params = {
        $round: round,
        $season: (new Date).getUTCFullYear(),
      };

      if (user) {
        sql += " AND user = $user";
        params.$user = user.account;
      }

      this.db.all(sql, params, (error, data) => {
        error ? reject(error) : resolve(data);
      });
    });
  }

  user(user, round) {
    return new Promise((resolve, reject) => {
      user.whois().then(info => {
        this.round(round, info).then(data => {
          resolve(data[0]);
        }, reject);
      });
    });
  }

  scores(round) {
    return new Promise((resolve, reject) => {
      let sql = "\
        SELECT MAX(round) round, \
          SUM(points) points, \
          user, \
          nick \
        FROM betgame_points \
        WHERE season = $season \
        %s \
        GROUP BY user \
        ORDER BY points DESC";
      let params = {$season: (new Date).getUTCFullYear()};
      if (round) {
        params.$round = parseInt(round);
        sql = util.format(sql, " AND round = $round");
      } else {
        sql = util.format(sql, "");
      }

      this.db.all(sql, params, (error, points) => {
        error ? reject(error) : resolve(points);
      });
    });
  }

  save(round, user, names) {
    return new Promise((resolve, reject) => {
      user.whois().then(info => {
        let sql = "INSERT INTO betgame_bets (season, round, user, nick, d1, d2, d3) \
            VALUES ($season, $round, $user, $nick, $d1, $d2, $d3)";

        let params = {
          $season: (new Date).getUTCFullYear(),
          $round: round,
          $user: info.account || "DEMO",
          $nick: info.nick,
          $d1: names[0],
          $d2: names[1],
          $d3: names[2],
        };

        this.db.serialize(() => {
          this.db.run(sql, params, error => {
            if (!error) {
              return resolve(names);
            }
            if (error.errno != 19) {
              throw err;
            }

            sql = "\
              UPDATE betgame_bets \
              SET d1 = $d1, d2 = $d2, d3 = $d3, nick = $nick, time=CURRENT_TIMESTAMP \
              WHERE season = $season \
                AND round = $round \
                AND user = $user";
            this.db.run(sql, params);
            resolve(names);
          });
        });
      });
    });
  }

  saveScores(round, scores) {
    return new Promise((resolve, reject) => {
      this.db.run("DELETE FROM betgame_points WHERE round = $round", {$round: round});

      let season = (new Date).getUTCFullYear();
      let sql = "INSERT INTO betgame_points(season, round, user, nick, points) VALUES (?, ?, ?, ?, ?)";
      let smt = this.db.prepare(sql);

      scores.forEach(row => {
        smt.run(season, round, row.user, row.nick, row.points);
      });

      smt.finalize();
      resolve();
    });
  }
}

class BetGame {
  constructor(database, drivers, races, results) {
    this.db = database;
    this.drivers = drivers;
    this.races = races;
    this.results = results;
    this.events = new EventEmitter;

    this.timers = {
      betWindow: null,
    };

    this.bets = new Bets(this.db);
  }

  bet(user, d1, d2, d3) {
    return new Promise((resolve, reject) => {
      let round = this.races.nextQualifying.round;
      this.parseDrivers(d1, d2, d3).then(names => {
        this.bets.save(round, user, names).then(() => {
          let joined = names.map((n, i) => (i+1) + ". " + n).join("; ");
          resolve(util.format("%s: %s [OK]", user.nick, joined));
        }, error => {
          console.error("betgame.bet:", error.stack);
          return error;
        });
      }).catch(reject);
    });
  }

  userBets(user) {
    let round = this.races.nextRace.round;
    return this.bets.user(user, round);
  }

  scores(round) {
    return this.bets.scores.apply(this.bets, arguments);
  }

  topScores() {
    return new Promise((resolve, reject) => {
      return game.scores().then(scores => {
        let max_round = scores.reduce(((max, row) => Math.max(max, row.round)), 0);

        scores.forEach(row => {
          row.round = max_round;
        });

        resolve(scores);
      });
    });
  }

  updateScores(auto_retry) {
    if (!arguments.length) {
      auto_retry = true;
    }

    return new Promise((resolve, reject) => {
      let round = this.races.nextRace.round - 1;
      this.results.fetchRace(round).then(result => {
        this.bets.round(round).then(bets => {
          (new PointsCalculator(result)).process(bets).then(scores => {
            this.bets.saveScores(round, scores).then(resolve, error => {
              console.error("betgame.updatescores:", error.stack);
              reject(error);
            });
          });
        });
      }, error => {
        if (error) {
          return reject(error);
        } else if (auto_retry) {
          console.log("No score data, retry");
          setTimeout(() => {
            this.updateScores();
          }, 60 * 1000 * 10);
        }
      });
    });
  }

  parseDrivers(d1, d2, d3) {
    let keys = Array.prototype.slice.apply(arguments).map(name => name.toLowerCase());

    return new Promise((resolve, reject) => {
      this.drivers.reload(true).then(data => {
        let names = [null, null, null];

        for (let i = 0; i < keys.length; i++) {
          let d = keys[i];

          for (let j = 0; j < data.length; j++) {
            let row = data[j];
            let surname = row.name.split(" ", 2)[1]
              .toLowerCase()
              .replace("ä", "a")
              .replace("ö", "o");

            if (surname.substring(0, d.length) == d) {
              names[i] = row.name;
              break;
            }
          }

          if (!names[i]) {
            return reject(util.format("Could not find driver for '%s'", d));
          }
        }
        resolve(names);
      });
    });
  }

  _initDatabase() {
    this.db.serialize(() => {
      this.db.run("CREATE TABLE IF NOT EXISTS betgame_bets( \
        season INT NOT NULL, \
        round INT NOT NULL, \
        user TEXT NOT NULL, \
        nick TEXT NOT NULL, \
        d1 TEXT NOT NULL, \
        d2 TEXT NOT NULL, \
        d3 TEXT NOT NULL, \
        time TIMESTAMP DEFAULT CURRENT_TIMESTAMP, \
        PRIMARY KEY(season, round, user) \
      )");

      this.db.run("CREATE TABLE IF NOT EXISTS betgame_points( \
        season INT NOT NULL, \
        round INT NOT NULL, \
        user TEXT NOT NULL, \
        nick TEXT NOT NULL, \
        points INT NOT NULL, \
        PRIMARY KEY(season, round, user) \
      )");
    });
  }

  get betsAllowed() {
    return this.betsOpen <= new Date;
  }

  get betsOpen() {
    let event = this.races.nextQualifying;
    if (event) {
      return moment.utc(event.date).subtract(5, "days").hour(0).toDate();
    }
    return null;
  }
}

exports.configure = function(connection, modules) {
  let drivers = modules.get("standings").drivers;
  let seasoncalendar = modules.get("seasoncalendar");
  let races = seasoncalendar.calendar;
  let database = new sqlite.Database(connection.config.database.sqlite.file);

  let game = new BetGame(database, drivers, seasoncalendar, new RaceResults(connection.config.modules.betgame));
  game._initDatabase();

  let perms = connection.config.debug
    ? commands.Command.ALLOW_ALL
    : commands.Command.ALLOW_AUTHED;

  connection.addCommand("bet", perms, (user, params) => {
    return new Promise((resolve, reject) => {
      if (params.length == 0) {
        game.userBets(user).then(bets => {
          if (!bets) {
            return resolve("You have not placed any bets for this round");
          }
          let line = [bets.d1, bets.d2, bets.d3].map((name, i) => {
            return util.format("%d. %s", i+1, name);
          }).join("; ");

          resolve("Your bets for this round: " + line);
        });
      } else {
        if (!game.betsAllowed) {
          let datestr = moment.utc(game.betsOpen).format("MMMM D, HH:mm UTC");
          throw new Error(util.format("Bets will be allowed after %s, until qualifying!", datestr));
        }

        if (params.length != 3) {
          throw new Error("Need three names to bet");
        }

        params.forEach(name => {
          if (name.length < 3) {
            throw new Error("Name length has to be at least three characters");
          }
        });

        game.bet.apply(game, [user].concat(params)).then(resolve, reject);
      }
    });
  });

  connection.addCommand("top", perms, (user, params) => {
    return new Promise((resolve, reject) => {
      if (params.length) {
        if (params[0] == "last") {
          params[0] = races.lastRace.round;
        }

        let race = races.race(params[0]);

        if (!race) {
          return resolve("Invalid round " + params[0]);
        }

        game.scores(params[0]).then(points => {
          if (points.length) {
            let line = points.map((row, i) => {
              return util.format("%s %d", row.nick, row.points);
            }).join("; ");
            resolve({
              message: util.format("Points for %s: %s", race.title, line),
              method: "notice",
            });
          } else {
            resolve("No data for " + race.title);
          }
        });
      } else {
        game.topScores().then((points) => {
          let line = points.map((row, i) => {
            return util.format("%s %d", row.nick, row.points);
          }).join("; ");
          let race = races.race(points[0].round);
          resolve({
            message: util.format("Points after %s: %s", race.title, line),
            method: "notice",
          });
        }, error => {
          console.error("betgame.top", error);
        });
      }
    });
  });

  seasoncalendar.events.on("race.week.begin", () => {
    let notify = function() {
      connection.amsg("Hello everybody! Bet window is now open and bets are allowed until qualifying starts!");
    };

    setTimeout(notify, 1000 * 3600 * 6);
    setTimeout(notify, 1000 * 3600 * 10);
    setTimeout(notify, 1000 * 3600 * 16);
    setTimeout(notify, 1000 * 3600 * 20);

    notify();
  });

  seasoncalendar.events.on("race.weekend.begin", () => {
    let notify = function() {
      connection.amsg("Yo! Remember to !bet for race podium before quali!");
    };

    let last_chance = function() {
      connection.amsg("Last chance to !bet for race podium! Qualifying in 30 minutes!");
    };

    let deadline = moment(races.nextQualifying.date);

    setTimeout(last_chance, deadline.subtract(30, "minutes").diff());
    setTimeout(notify, deadline.subtract(1.5, "hours").diff());
    setTimeout(notify, deadline.subtract(2.5, "hours").diff());
    setTimeout(notify, deadline.subtract(9, "hours").diff());
    setTimeout(notify, deadline.subtract(3, "hours").diff());

    notify();
  });

  seasoncalendar.events.on("race.weekend.end", () => {
    game.updateScores().then(() => {
      connection.amsg(util.format("Scores updated for %s!", races.lastRace.title));
    }, error => {
      console.error("betgame:", error);
    });
  });

  setTimeout(() => {
    game.updateScores();
  }, 5000);
};