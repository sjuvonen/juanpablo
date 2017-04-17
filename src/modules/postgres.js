"use strict";

const db = require("colibre-pgsql");
const orm = require("colibre-pgsql");

exports.configure = services => {
  services.registerFactory("database", () => {
    let config = services.get("config");
    let database = new db.Database(config.get("database.postgres"));
    return database;
  });

  services.registerFactory("entity.manager", () => {
    const database = services.get("database");
    const manager = new orm.EntityManager(database);

    return manager;
  });

  services.get("event.manager").on("ready", () => {
    const entities = services.get("entity.manager");
    const modules = services.get("module.manager").modules;

    for (let module of modules.values()) {
      if ("entities" in module) {
        Object.keys(module.entities).forEach(key => entities.add(module.entities[key]));
      }
    }
  });
};
