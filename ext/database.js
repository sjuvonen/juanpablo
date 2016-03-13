"use strict";

let sqlite = require("sqlite3");

exports.configure = connection => {
  let database = new sqlite.Database(connection.config.database.sqlite.file);
  return database;
};
