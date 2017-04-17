"use strict";

const moment = require("moment");
const orm = require("colibre-pgsql");
const util = require("util");

class RaceWeekendStorage extends orm.Storage {
  async findNextEvent() {
    let query = this.entityManager
      .createQuery(this.entityType.id, "e")
      .where("e.ends", new Date, ">");

    let result = await query.execute();
    return result[0];
  }
}

class Season extends orm.Entity {
  static get schema() {
    return {
      id: "gp_season",
      fields: [
        { name: "id", type: "integer" },
        { name: "drivers", type: "object" },
        { name: "teams", type: "object" }
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
      id: "driver",
      virtual: true,
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
          container: SessionArray,
        }},
        { name: "results", type: "object", options: {
          multiple: true,
          property: "results",
          entity: "driver",
        }},
      ]
    };
  }

  static get storageClass() {
    return RaceWeekendStorage;
  }
}

class Session extends orm.Entity {
  constructor(values) {
    /*
     * FIXME: Remove this code when the ORM module supports converting types of nested objects' fields.
     */
    if (values.starts && !(values.starts instanceof Date)) {
      values.starts = new Date(values.starts);
    }
    if (values.ends && !(values.ends instanceof Date)) {
      values.ends = new Date(values.ends);
    }

    super(values);
  }

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

class SessionArray extends Array {
  nextSession() {
    const now = new Date;

    for (let session of this) {
      console.log("D", session.starts);
      if (now < session.starts) {
        return session;
      }
    }
  }
}

exports.entities = {
  Season: Season,
  RaceWeekend: RaceWeekend,
  Session: Session,

  Driver: Driver,
};

exports.configure = services => {
};
