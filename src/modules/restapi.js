"use strict";

exports.configure = services => {
  let router = services.get("rest.router");
  let database = services.get("database");
  let Bet = database.model("bet");
  let Result = database.model("result");

  router.route("/rest/bets/:season", event => {
    return Bet
      .find({season: event.params.season})
      .sort({"season": -1, "round": -1, "nick": 1});
  });

  router.route("/rest/bets/:season/:round", event => {
    return Bet
      .find({season: event.params.season, round: event.params.round})
      .sort({"season": -1, "nick": 1});
  });

  router.route("/rest/results/:season", event => {
    return Result.find({season: event.params.season}).sort({round: 1});
  });

  router.route("/rest/results/:season/:round", event => {
    return Result.find({season: event.params.season, round: event.params.round});
  });
};
