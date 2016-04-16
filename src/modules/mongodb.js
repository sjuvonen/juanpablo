"use strict";

exports.configure = services => {
  services.registerFactory("database", () => {
    let mongoose = require("mongoose");
    let util = require("util");
    let config = services.get("config");
    let host = config.get("database.mongodb.host");
    let database = config.get("database.mongodb.database");
    console.log("open", util.format("mongodb://%s/%s", host, database));
    mongoose.connect(util.format("mongodb://%s/%s", host, database));
    return mongoose;
  });
};
