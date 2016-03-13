"use strict";

exports.configure = connection => {
  let database = new sqlite.Database(connection.config.database.sqlite.file);
  return database;
};
