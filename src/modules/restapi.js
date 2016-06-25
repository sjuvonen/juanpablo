"use strict";

exports.configure = services => {
  let router = services.get("rest.router");
  let database = services.get("database");
  let Bet = database.model("bet");

  router.route("/rest/bets/:season", event => {
    return Bet
      .find({season: event.params.season})
      .sort({"season": 1, "round": 1, "nick": 1});
  });

  router.route("/rest/bets/:season/:round", event => {
    return Bet
      .find({season: event.params.season, round: event.params.round})
      .sort({"season": 1, "round": 1, "nick": 1});
  });
};
