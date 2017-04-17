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
  const entities = services.get("entity.manager");

  services.get("command.manager").add("next", (type) => {
    return entities.storage("gp_weekend").findNextEvent(type).then(event => {
      if (!event) {
        throw new Exception("No event data found");
      }

      let session = event.sessions.nextSession();
      let title = [session.name, event.title].join(", ");

      let date = moment.utc(session.starts);
      let diff = moment.duration(date.diff());
      let timestamp = date.format("MMMM D, HH:mm UTC");
      let display = [title + ": ", timestamp];

      if (diff.days() > 0 || diff.hours() > 0 || diff.minutes() > 0) {
        display.push(" (in");

        if (diff.months() == 1) {
          display.push(" 1 month");
        } else if (diff.months() > 1) {
          display.push(util.format(" %d months", diff.months()));
        }

        if (diff.weeks() == 1) {
          display.push(" 1 week");
        } else if (diff.weeks() > 1) {
          display.push(util.format(" %d weeks", diff.weeks()));
        }

        if (diff.days() == 1) {
          display.push(" 1 day");
        } else if (diff.days() > 1) {
          display.push(util.format(" %d days", diff.days() % 7));
        }

        if (diff.hours() == 1) {
          display.push(" 1 hour");
        } else if (diff.hours() > 1) {
          display.push(util.format(" %d hours", diff.hours()));
        }

        if (diff.minutes() == 1) {
          display.push(" 1 minute");
        } else if (diff.minutes() > 1) {
          display.push(util.format(" %d minutes", diff.minutes()));
        }

        display.push(")");
      }

      return display.join("");
    });
  });
};
