"use strict";

let mongoose = require("mongoose");

let BetSchema = new mongoose.Schema({
  user: String,
  nick: String,
  season: Number,
  round: Number,
  points: Number,
  bets: [{
    _id: false,
    firstName: String,
    lastName: String,
    code: String
  }],
  created: {
    type: Date,
    default: Date.now(),
  },
});

let Bet = mongoose.model("bet", BetSchema);

exports.configure = services => {
  let db = services.get("database");

  services.get("command.manager").add("bet", (user, ...names) => {
    if (names.length == 0) {
      console.log("return bets");
      return Promise.resolve("Your bets: 1. Foo 2. Bar 3. Baz");
    }
    if (names.length != 3) {
      console.log("reject betting");
      return Promise.reject("Need three names to bet");
    }
    return db.model("season").driversForNames(names).then(drivers => {
      let bet = {user: "foobar", "nick": "FooBar", season: 2016, round: 1, bets: drivers, created: new Date};
      Bet.update({user: "foobar", season: 2016, round: 1}, bet, {upsert: true}).then(status => {
        console.log("S", status);
      }, error => {
        console.error("E", error.stack);
      })
    });
  });
};
