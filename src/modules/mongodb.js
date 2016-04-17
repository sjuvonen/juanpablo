"use strict";

/*
 * NOTE: In modules the Mongoose instance has to be fetched using services.get("database")
 * in order to ensure that the database connection is created!
 */

exports.configure = services => {
  services.registerFactory("database", () => {
    let mongoose = require("mongoose");
    let util = require("util");
    let config = services.get("config");
    let host = config.get("database.mongodb.host");
    let database = config.get("database.mongodb.database");
    mongoose.connect(util.format("mongodb://%s/%s", host, database));
    return mongoose;
  });
};
