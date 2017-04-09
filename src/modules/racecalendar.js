"use strict";

const orm = require("colibre-pgsql");

class Season extends orm.Entity {
  static get schema() {
    return {
      id: "gp_season",
      fields: [
        { name: "id", type: "integer" },
        { }
      ]
    };
  }

  get year() {
    return this.id;
  }
}

class Driver extends orm.Entity {
  static get schema() {
    return {
      virtual: true,
      id: "driver",
      fields: [
        // { name: "id", type: "integer" },
        { name: "code", type: "string" },
        { name: "number", type: "integer" },
        { name: "name", type: "string" },
        // { name: "first_name", type: "string"},
        // { name: "last_name", type: "string" },
      ]
    };
  }
}

class RaceWeekend extends orm.Entity {
  static get schema() {
    return {
      id: "gp_weekend",
      fields: [
        { name: "id", type: "integer" },
        { name: "season", type: "integer" },
        { name: "round", type: "integer" },
        { name: "title", type: "string" },
        { name: "starts", type: "date" },
        { name: "ends", type: "date" },
        { name: "sessions", type: "object", options: {
          multiple: true,
          property: "sessions",
          entity: "gp_session",
        }},
        { name: "results", type: "object", options: {
          multiple: true,
          property: "results",
          entity: "driver",
        }}
      ]
    };
  }
}

class Session extends orm.Entity {
  static get schema() {
    return {
      virtual: true,
      id: "gp_session",
      fields: [
        { name: "type", type: "enum", options: {
          values: ["practise", "qualifying", "race", "other"]
        }},
        { name: "name", type: "string" },
        { name: "starts", type: "datetime" },
        { name: "ends", type: "datetime" },
      ]
    }
  }
}

exports.configure = services => {
  console.log("LOADED!");
};
