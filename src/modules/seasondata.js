"use strict";

let htmlparser = require("htmlparser2");
let mongoose = require("mongoose");
let net = require("../net");
let util = require("util");
let Command = require("./commands");

let DefaultPoints = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

let SeasonSchema = new mongoose.Schema({
  _id: Number,

  /**
   * Drivers participating in this season.
   */
  drivers: [{
    _id: false,
    firstName: String,
    lastName: String,
    code: String,
    number: Number,
  }],

  teams: [{
    _id: false,
    name: String,
    code: String,
  }],

  /**
   * Points system used during the season.
   */
  points: {
    type: [Number],
    default: DefaultPoints
  }
});

SeasonSchema.virtual("year")
  .get(function() {
    return this._id;
  })
  .set(function(year) {
    this._id = year;
  });

SeasonSchema.statics.findCurrent = function() {
  return Promise.resolve(this.findOne({_id: (new Date).getFullYear()}));
};

SeasonSchema.statics.driversForNames = function(rawnames, year) {
  if (!year) {
    year = (new Date).getFullYear();
  }
  let names = rawnames.map(name => name.toLowerCase());
  return this.findOne({_id: year})
    .then(season => {
      return names.map(name => {
        for (let driver of season.drivers.values()) {
          if (driver.code.toLowerCase() == name) {
            return driver;
          }
          if (driver.lastName.substring(0, name.length).toLowerCase() == name) {
            return driver;
          }
        }
        throw new Error(util.format("No match found for '%s'", name));
      });
    });
};

class ErgastDriverParser {
  parse(json) {
    let data = JSON.parse(json).MRData.DriverTable;
    return {
      year: parseInt(data.season),
      drivers: data.Drivers.map(raw => ({
        number: parseInt(raw.permanentNumber),
        firstName: raw.givenName,
        lastName: raw.familyName,
        code: raw.code,
      })),
    };
  }
}

class ErgastTeamParser {
  parse(json) {
    let data = JSON.parse(json).MRData.ConstructorTable;
    return {
      year: parseInt(data.season),
      teams: data.Constructors.map(raw => ({
        name: raw.name,
        code: raw.constructorId,
      })),
    };
  }
}

class ErgastDownloader {
  constructor(config) {
    this.config = config;
  }

  download(year) {
    let p1 = net.download(this.url("drivers", year)).then(response => {
      return (new ErgastDriverParser).parse(response.data);
    });

    let p2 = net.download(this.url("constructors", year)).then(response => {
      return (new ErgastTeamParser).parse(response.data);
    });

    return Promise.all([p1, p2]).then(([doc1, doc2]) => {
      doc1.teams = doc2.teams;
      return doc1;
    });
  }

  url(resource, year) {
    if (!year) {
      year = (new Date).getFullYear();
    }
    return util.format("%s/%d/%s.json", this.config.get("modules.shared.ergast.url"), year, resource);
  }
}

exports.configure = services => {
  let database = services.get("database");
  let Season = database.model("season", SeasonSchema);

  services.registerFactory("seasondata.downloader", () => {
    return new ErgastDownloader(services.get("config"));
  });

  services.get("command.manager").add("rs", Command.ALLOW_WHITELIST, command => {
    let downloader = services.get("seasondata.downloader");
    return downloader.download(command.params[0]).then(data => {
      let season = new Season(data);
      return Season.update({_id: season.year}, season.toObject(), {upsert: true}).then(
        () => "OK",
        error => new Error("Failed to reload season")
      );
    });
  });
};
