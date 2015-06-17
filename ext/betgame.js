
var moment = require("moment");
var util = require("util");

var commands = require("../core/commands");
var drivers = require("./standings").drivers;
var events = require("./events").events;

exports.initialize = function(bot) {
  var game = new Game(bot.database);
  game._initDatabase();

  bot.addCommand("bet", commands.Command.ALLOW_AUTHED, function(user, params) {
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
      }, reject);
    });
  });
};

var Game = function(database) {
  this.database = database;
};

Game.prototype = {
  _initDatabase: function() {
    var db = this.database;

    db.serialize(function() {
      db.run("CREATE TABLE IF NOT EXISTS betgame_bets( \
        round INT NOT NULL, \
        user TEXT NOT NULL, \
        d1 TEXT NOT NULL, \
        d2 TEXT NOT NULL, \
        d3 TEXT NOT NULL, \
        time TIMESTAMP DEFAULT CURRENT_TIMESTAMP, \
        PRIMARY KEY(user, round) \
      )");
    });
  },
  bet: function(user, d1, d2, d3) {
    var game = this;

    return new Promise(function(resolve, reject) {
      game.parseDrivers(d1, d2, d3).then(function(names) {
        game.saveBets(user, names).catch(function(error) {
          console.error(error);
        });

        var joined = names.map((n, i) => (i+1) + ". " + n).join("; ");
        resolve(util.format("%s: %s [OK]", user.nick, joined));
      }, reject);
    });
  },
  parseDrivers: function(d1, d2, d3) {
    var keys = Array.prototype.slice.apply(arguments).map(function(name) {
      return name.toLowerCase();
    });

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
  saveBets: function(user, names) {
    var game = this;
    var db = this.database;
    var event = events.nextQualifying;

    return new Promise(function(resolve, reject) {
      user.whois().then(function(info) {
        try {
          if (!("account" in info)) {
//             info.account = "DEMO";
          }

          var sql = "INSERT INTO betgame_bets (round, user, d1, d2, d3) \
              VALUES($round, $user, $d1, $d2, $d3)";

          var params = {
            $round: event.round,
            $user: info.account,
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
                console.warn("UNKNOWN DATABASE ERROR:", err);
              }

              sql = "UPDATE betgame_bets SET d1 = $d1, d2 = $d2, d3 = $d3, time=CURRENT_TIMESTAMP \
                WHERE round = $round AND user = $user";

              db.run(sql, params);
            });
          });
        } catch (e) {
          console.error("huoh");
          reject(e);
        }
      }).catch(function(e) {
        console.log("another", e);
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
      var event = events.nextQualifying;
      if (event) {
        return moment.utc(event.date).subtract(5, "days").hour(0).toDate();
      }
      return null;
    }
  }
});
