"use strict";

exports.configure = services => {
  let router = services.get("rest.router");
  let database = services.get("database");
  let Bet = database.model("bet");
  let Event = database.model("event");

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
    return Event.find({season: event.params.season, type: "race", results: {$ne: []}}).sort({round: 1});
  });

  router.route("/rest/results/:season/:round", event => {
    return Event.find({season: event.params.season, round: event.params.round, type: "race"});
  });
};
