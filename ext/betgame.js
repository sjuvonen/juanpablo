
var events = require("events");
var htmlparser = require("htmlparser2");
var moment = require("moment");
var Promise = require("promise");
var util = require("util");

var commands = require("../core/commands");

exports.initialize = function(bot) {
  var drivers = bot.shared.drivers;
  var races = bot.shared.events;

  var game = new Game(bot.database, drivers, races, new RaceResults(bot.net, bot.config.betgame));
  game._initDatabase();

  var perms = bot.config.debug
    ? commands.Command.ALLOW_ALL
    : commands.Command.ALLOW_AUTHED;

  bot.addCommand("bet", perms, function(user, params) {
    return new Promise(function(resolve, reject) {
      if (params.length == 0) {
        game.userBets(user).then(function(bets) {
          if (!bets) {
            return resolve("You have not placed any bets for this round");
          }
          var line = [bets.d1, bets.d2, bets.d3].map(function(name, i) {
            return util.format("%d. %s", i+1, name);
          }).join("; ");

          resolve("Your bets for this round: " + line);
        });
      } else {
        if (!game.betsAllowed) {
          var datestr = moment.utc(game.betsOpen).format("MMMM D, HH:mm UTC");
          throw new Error(util.format("Bets will be allowed after %s, until qualifying!", datestr));
        }

        if (params.length != 3) {
          throw new Error("Need three names to bet");
        }

        params.forEach(function(name) {
          if (name.length < 3) {
            throw new Error("Name length has to be at least three characters");
          }
        });

        game.bet.apply(game, [user].concat(params)).then(resolve, reject);
      }
    });
  });

  bot.addCommand("top", perms, function(user, params) {
    return new Promise(function(resolve, reject) {
      if (params.length) {
        if (params[0] == "last") {
          params[0] = races.lastRace.round;
        }

        var race = races.race(params[0]);

        if (!race) {
          return resolve("Invalid round " + params[0]);
        }

        game.scores(params[0]).then(function(points) {
          if (points.length) {
            var line = points.map(function(row, i) {
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
        game.topScores().then(function(points) {
          var line = points.map(function(row, i) {
            return util.format("%s %d", row.nick, row.points);
          }).join("; ");
          var race = races.race(points[0].round);
          resolve({
            message: util.format("Points after %s: %s", race.title, line),
            method: "notice",
          });
        });
      }
    }, function(error) {
      console.error("ERROR", error);
    });
  });

  bot.events.on("race.week.begin", function() {
    console.log("race.week.begin()");

    var notify = function() {
      bot.spam("Hello everybody! Bet window is now open and bets are allowed until qualifying starts!");
    };

    setTimeout(notify, 1000 * 60 * 6);
    setTimeout(notify, 1000 * 60 * 10);
    setTimeout(notify, 1000 * 60 * 16);
    setTimeout(notify, 1000 * 60 * 20);

    notify();
  });

  bot.events.on("race.weekend.begin", function() {
    console.log("race.weekend.begin()");

    var now = new Date;
    var deadline = moment(races.nextQualifying.date);

    var notify = function() {
      bot.spam("Hello everybody! Remember to !bet for race podium before quali!");
    };

    var last_chance = function() {
      bot.spam("Last chance to !bet for race podium! Qualifying in 30 minutes!");
    };

    setTimeout(last_chance, deadline.subtract(30, "minutes").diff(now));
    setTimeout(notify, deadline.subtract(1.5, "hours").diff(now));
    setTimeout(notify, deadline.subtract(2.5, "hours").diff(now));
    setTimeout(notify, deadline.subtract(9, "hours").diff(now));
    setTimeout(notify, deadline.subtract(3, "hours").diff(now));

    notify();
  });

  bot.events.on("race.weekend.end", function() {
    console.log("race.weekend.end()");

    game.updateScores().then(function() {
      bot.spam(util.format("Scores updated for %s!", races.lastRace.title));
    }, function(err) {
      console.log("FETCH FAILED", err);
    });
  });
};

var RaceResults = function(net, options) {
  this.net = net;
  this.url = options.results;

  this.sources = [];
  this.results = [];
};

RaceResults.prototype = {
  get: function(i) {
    if (arguments.length == 0) {
      throw new Error("Have to define which round to fetch");
    }

    var cache = this;
    return new Promise(function(resolve, reject) {
      if (i < cache.results.length) {
        return resolve(cache.results[i]);
      }
      cache.fetchRace(i).then(function(result) {
        resolve(result);
      });
    });
  },
  fetchRace: function(i) {
    var cache = this;
    return new Promise(function(resolve, reject) {
      cache.net.download(cache.url).then(function(response) {
        (new ResultsParser({round: i})).parse(response.data.toString()).then(function(result) {
          if (result.length) {
            cache.results[i] = result;
            resolve(result);
          } else {
            return reject(-1);
            // throw new Error("Failed to fetch results");
          }
        });
      });
    });
  }
};

var ResultsParser = function(options) {
  this.round = options.round;
};

ResultsParser.prototype = {
  parse: function(html) {
    var State = {
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
    var target_round = this.round;
    return new Promise(function(resolve) {
      var result = [];
      var cell_i = 0;
      var name = null;
      var state = State.WAIT;

      try {
        var parser = new htmlparser.Parser({
          onopentag: function(tag, attrs) {
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
          ontext: function(text) {
            switch (state) {
              case State.READ_NAME:
                name = text.trim();
                break;
              case State.CELL_RESULT:
                if (cell_i == target_round && text.trim().length) {
                  var pos = parseInt(text.trim());
                  if (pos) {
                    result[pos-1] = name;
                  }
                }
                break;
            }
          },
          onclosetag: function(tag) {
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
        console.log(e);
      }

      resolve(result.slice(0, 10));
    });
  },
};

var PointsCalculator = function(results) {
  this.results = results;
};

/*
 * SCORING
 *
 * 1st place right: 10
 * 2nd place right: 5
 * 3rd place right: 3
 * driver in top 3 but wrong place: 1
 *
 * all positions right: +5
 */

PointsCalculator.prototype = {
  process: function(bets) {
    var calc = this;
    return new Promise(function(resolve) {
      process.nextTick(function() {
        var points = bets.map((row, i) => ({
          user: row.user,
          nick: row.nick,
          points: calc.scores(row),
        }));
        points.sort((a, b) => b.points - a.points);
        resolve(points);
      });
    });
  },
  scores: function(row) {
    var scoring = [10, 5, 3, 1];
    var bonus = 5;
    var res = this.results;
    var points = 0;

    [row.d1, row.d2, row.d3].forEach(function(name, i) {
      if (name == res[i]) {
        points += scoring[i];
      } else if (this.driverOnPodium(name)) {
        points += scoring[3];
      }
    }, this);

    var max = scoring.slice(0, 3).reduce((sum, x) => sum+x, 0);

    if (points == max) {
      points += bonus;
    }

    return points;
  },
  driverOnPodium: function(name) {
    return this.results.slice(0, 3).indexOf(name) != -1;
  },
};

var Bets = function(database) {
  this.database = database;
};

Bets.prototype = {
  /**
   * @param round Number of round to fetch
   * @param user Auth info for user [optional
   */
  round: function(round, user) {
    var db = this.database;
    return new Promise(function(resolve) {
      var sql = "\
        SELECT user, nick, d1, d2, d3 \
        FROM betgame_bets \
        WHERE round = $round AND season = $season";
      var params = {
        $round: round,
        $season: (new Date).getUTCFullYear(),
      };

      if (user) {
        sql += " AND user = $user";
        params.$user = user.account;
      }

      db.all(sql, params, function(err, data) {
        if (err) {
          throw new Error(err);
        }
        resolve(data);
      });
    });
  },
  user: function(user, round) {
    var bets = this;
    return new Promise(function(resolve) {
      user.whois().then(function(info) {
        bets.round(round, info).then(function(data) {
          resolve(data[0]);
        });
      });
    });
  },
  scores: function(round) {
    var db = this.database;
    return new Promise(function(resolve) {
      var sql = "\
        SELECT MAX(round) round, \
          SUM(points) points, \
          user, \
          nick \
        FROM betgame_points \
        WHERE season = $season \
        %s \
        GROUP BY user \
        ORDER BY points DESC";
      var params = {$season: (new Date).getUTCFullYear()};
      if (round) {
        params.$round = parseInt(round);
        sql = util.format(sql, " AND round = $round");
      } else {
        sql = util.format(sql, "");
      }

      db.all(sql, params, function(err, points) {
        if (err) {
          throw err;
        }
        resolve(points);
      });
    });
  },
  save: function(round, user, names) {
    var db = this.database;

    return new Promise(function(resolve) {
      user.whois().then(function(info) {
        var sql = "INSERT INTO betgame_bets (season, round, user, nick, d1, d2, d3) \
            VALUES ($season, $round, $user, $nick, $d1, $d2, $d3)";

        var params = {
          $season: (new Date).getUTCFullYear(),
          $round: round,
          $user: info.account || "DEMO",
          $nick: info.nick,
          $d1: names[0],
          $d2: names[1],
          $d3: names[2],
        };

        db.serialize(function() {
          db.run(sql, params, function(err) {
            if (!err) {
              return resolve(names);
            }
            if (err.errno != 19) {
              throw err;
            }

            sql = "\
              UPDATE betgame_bets \
              SET d1 = $d1, d2 = $d2, d3 = $d3, nick = $nick, time=CURRENT_TIMESTAMP \
              WHERE season = $season \
                AND round = $round \
                AND user = $user";
            db.run(sql, params);
            resolve(names);
          });
        });
      });
    });
  },
  saveScores: function(round, scores) {
    var db = this.database;
    return new Promise(function(resolve) {
      db.run("DELETE FROM betgame_points WHERE round = $round", {$round: round});

      var season = (new Date).getUTCFullYear();

      var sql = "INSERT INTO betgame_points(season, round, user, nick, points) VALUES (?, ?, ?, ?, ?)";
      var smt = db.prepare(sql);

      scores.forEach(function(row) {
        smt.run(season, round, row.user, row.nick, row.points);
      });

      smt.finalize();

      resolve();
    });
  },

};

var Game = function(database, drivers, races, results) {
  this.database = database;
  this.drivers = drivers;
  this.races = races;
  this.results = results;
  this.events = new events.EventEmitter;
  this.timers = {
    betWindow: 0,
  };

  this.bets = new Bets(this.database);
};

Game.prototype = {
  _initDatabase: function() {
    var db = this.database;

    db.serialize(function() {
      db.run("CREATE TABLE IF NOT EXISTS betgame_bets( \
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

      db.run("CREATE TABLE IF NOT EXISTS betgame_points( \
        season INT NOT NULL, \
        round INT NOT NULL, \
        user TEXT NOT NULL, \
        nick TEXT NOT NULL, \
        points INT NOT NULL, \
        PRIMARY KEY(season, round, user) \
      )");
    });
  },
  bet: function(user, d1, d2, d3) {
    var game = this;
    var round = this.races.nextQualifying.round;

    return new Promise(function(resolve, reject) {
      game.parseDrivers(d1, d2, d3).then(function(names) {
        game.bets.save(round, user, names).then(function() {
          var joined = names.map((n, i) => (i+1) + ". " + n).join("; ");
          resolve(util.format("%s: %s [OK]", user.nick, joined));
        }, function(err) {
          console.log("err", err);
        });
      }).catch(reject);
    });
  },
  userBets: function(user) {
    var round = this.races.nextRace.round;
    return this.bets.user(user, round);
  },
  scores: function(round) {
    return this.bets.scores.apply(this.bets, arguments);
  },
  topScores: function() {
    var game = this;

    return new Promise(function(resolve) {
      return game.scores().then(function(scores) {
        var max_round = scores.reduce(((max, row) => Math.max(max, row.round)), 0);

        scores.forEach(function(row) {
          row.round = max_round;
        });

        resolve(scores);
      });
    });
  },
  updateScores: function(auto_retry) {
    if (!arguments.length) {
      auto_retry = true;
    }

    var game = this;
    var round = this.races.nextRace.round - 1;

    return new Promise(function(resolve, reject) {
      game.results.fetchRace(round).then(function(result) {
        game.bets.round(round).then(function(bets) {
          (new PointsCalculator(result)).process(bets).then(function(scores) {
            game.bets.saveScores(round, scores).then(function() {
              resolve();
            }, function(err) {
              console.log(err);
            });
          });
        });
      }, function(err) {
        if (err == -1) {
          if (auto_retry) {
            console.log("No score data, retry");
            setTimeout(function() {
              game.updateScores();
            }, 60 * 1000 * 10);
          }
        } else {
          throw new Error(err.toString());
        }
      });
    });
  },
  parseDrivers: function(d1, d2, d3) {
    var keys = Array.prototype.slice.apply(arguments).map(function(name) {
      return name.toLowerCase();
    });

    var drivers = this.drivers;
    return new Promise(function(resolve, reject) {
      drivers.get(true).then(function(data) {
        var names = [null, null, null];

        for (var i = 0; i < keys.length; i++) {
          var d = keys[i];

          for (var j = 0; j < data.length; j++) {
            var row = data[j];
            var surname = row.name.split(" ", 2)[1]
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
  },
};

Object.defineProperties(Game.prototype, {
  betsAllowed: {
    get: function() {
      return this.betsOpen < new Date;
    }
  },
  betsOpen: {
    get: function() {
      var event = this.races.nextQualifying;
      if (event) {
        return moment.utc(event.date).subtract(5, "days").hour(0).toDate();
      }
      return null;
    }
  }
});
