
var events = require("events");
var htmlparser = require("htmlparser2");
var moment = require("moment");
var Promise = require("promise");
var util = require("util");

var commands = require("../core/commands");

exports.initialize = function(bot) {
  var drivers = bot.shared.drivers;
  var races = bot.shared.events;

  var game = new Game(bot.database, drivers, races);
  game._initDatabase();

  var perms = bot.config.debug
    ? commands.Command.ALLOW_ALL
    : commands.Command.ALLOW_AUTHED;

  bot.addCommand("bet", perms, function(user, params) {
    return new Promise(function(resolve, reject) {
      if (params.length != 3) {
        return reject("Need three drivers to bet!");
      }

      params.forEach(function(name) {
        if (name.length < 3) {
          throw new Error("Name length has to be at least three characters");
        }
      });

      if (!game.betsAllowed) {
        var datestr = moment.utc(game.betsOpen).format("MMMM D, HH:mm UTC");
        throw new Error(util.format("Bets will be allowed after %s, until qualifying!", datestr));
      }

      game.bet.apply(game, [user].concat(params)).then(function(reply) {
        resolve(reply);
      });
    });
  });

  bot.events.on("race.weekend.start", function() {
    bot.spam("Hello everybody! Bet window is now open and bets are allowed until qualifying starts!");

    var now = new Date;
    var deadline = races.nextQualifying.date;

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
  });

  bot.events.on("race.weekend.end", function() {
    var round = races.nextRace.round - 1;
    var iid = setInterval(function() {
      var results = new RaceResults(bot.net, bot.config.betgame);

      results.fetchRace(round).then(function(result) {
        game.bets.round(round).then(function(bets) {
          (new PointsCalculator(result)).process(bets).then(function(scores) {
//             console.log("SCORES:", scores.map(o => o.nick + ": " + o.points).join("; "));
            game.bets.saveScores(round, scores).then(function() {
              clearInterval(iid);

              bot.spam("Betting scores updated!");
            }, function(err) {
              console.log(err);
            });
          });
        });
      });
    }, 1000 * 15);
    // CALCULATE SCORES
  });
};

var RaceResults = function(net, options) {
  this.net = net;
  this.url = options.source;

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
            console.log("REJECT");
            reject("FOO");
            throw new Error("Failed to fetch results");
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
        var points = bets.map(function(row, i) {
          return {
            user: row.user,
            nick: row.nick,
            points: calc.scores(row),
          };
        });

        points.sort(function(a, b) {
          return b.points - a.points;
        });

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
  round: function(round) {
    var db = this.database;
    return new Promise(function(resolve) {
      var sql = "SELECT user, nick, d1, d2, d3 FROM betgame_bets WHERE round = $round";
      var params = {$round: round};

      db.all(sql, {$round: round}, function(err, data) {
        if (err) {
          throw new Error(err);
        }
        resolve(data);
      });
    });
  },
  save: function(round, user, names) {
    var game = this;
    var db = this.database;

    return new Promise(function(resolve) {
      user.whois().then(function(info) {
        var sql = "INSERT INTO betgame_bets (round, user, nick, d1, d2, d3) \
            VALUES ($round, $user, $nick, $d1, $d2, $d3)";

        var params = {
          $round: round,
          $user: info.account,
          $nick: info.nick,
          $d1: names[0],
          $d2: names[1],
          $d3: names[2],
        };

        db.serialize(function() {
          db.run(sql, params, function(err) {
            if (!err) {
              return;
            }
            if (err.errno != 19) {
              throw err;
            }

            sql = "UPDATE betgame_bets SET d1 = $d1, d2 = $d2, d3 = $d3, time=CURRENT_TIMESTAMP \
              WHERE round = $round AND user = $user";

            db.run(sql, params);
          });
        });
      });
    });
  },
  saveScores: function(round, scores) {
    var db = this.database;
    return new Promise(function(resolve) {
      db.run("DELETE FROM betgame_points WHERE round = $round", {$round: round});

      var sql = "INSERT INTO betgame_points(round, user, nick, points) VALUES (?, ?, ?, ?)";
      var smt = db.prepare(sql);

      scores.forEach(function(row) {
        smt.run(round, row.user, row.nick, row.points);
      });

      smt.finalize();

      resolve();
    });
  },
};

var Game = function(database, drivers, races) {
  this.database = database;
  this.drivers = drivers;
  this.races = races;
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
        round INT NOT NULL, \
        user TEXT NOT NULL, \
        nick TEXT NOT NULL, \
        d1 TEXT NOT NULL, \
        d2 TEXT NOT NULL, \
        d3 TEXT NOT NULL, \
        time TIMESTAMP DEFAULT CURRENT_TIMESTAMP, \
        PRIMARY KEY(round, user) \
      )");

      db.run("CREATE TABLE IF NOT EXISTS betgame_points( \
        round INT NOT NULL, \
        user TEXT NOT NULL, \
        nick TEXT NOT NULL, \
        points INT NOT NULL, \
        PRIMARY KEY(round, user) \
      )");
    });
  },
  bet: function(user, d1, d2, d3) {
    var game = this;
    var round = this.races.nextQualifying.round;

    return new Promise(function(resolve) {
      game.parseDrivers(d1, d2, d3).then(function(names) {
        game.bets.save(rounds, user, names).then(function() {
          var joined = names.map((n, i) => (i+1) + ". " + n).join("; ");
          resolve(util.format("%s: %s [OK]", user.nick, joined));
        });
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
