"use strict";

const db = require("colibre-pgsql");

exports.configure = services => {
  services.registerFactory("database", () => {
    let config = services.get("config");
    let database = new db.Database(config.get("database.postgres"));
    return database;
  });
};
