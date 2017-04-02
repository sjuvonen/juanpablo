"use strict";

/*
 * NOTE: In modules the Mongoose instance has to be fetched using services.get("database")
 * in order to ensure that the database connection is created!
 */

class MongooseDataImporter {
 constructor(model, parser) {
   this.parser = parser;
   this.model = model;
 }

 importData(data) {
   let chain = [];
   let Model = this.model;
   for (let entry of this.parser.parse(data)) {
     let event = new Model(entry);
     chain.push(event.save());
   }
   return Promise.all(chain);
 }
}

exports.configure = services => {
  services.registerFactory("mongoose.importer", (model, parser) => {
    return new MongooseDataImporter(model, parser);
  }, false);

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
