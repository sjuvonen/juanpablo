"use strict";

let htmlparser = require("htmlparser2");
let mongoose = require("mongoose");
let net = require("../net");
let util = require("util");

let DefaultPoints = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

let SeasonSchema = new mongoose.Schema({
  _id: Number,
  // drivers: [{
  //   number: Number,
  //   name: String,
  // }],
  drivers: [{
    firstName: String,
    lastName: String,
    code: String,
    number: Number,
    _id: false,
  }],
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

let Season = mongoose.model("season", SeasonSchema);

class ErgastParser {
  parse(json) {
    let data = JSON.parse(json).MRData.DriverTable;
    return {
      year: parseInt(data.season),
      drivers: data.Drivers.map(d => ({
        number: parseInt(d.permanentNumber),
        firstName: d.givenName,
        lastName: d.familyName,
        code: d.code,
      })),
    }
  }
}

exports.configure = services => {
  function updateSeasonData(year) {
    if (!year) {
      year = (new Date).getFullYear();
    }

    let url = services.get("config").get("modules.seasondata.source.ergast");
    let source = util.format(url, year);

    return net.download(source).then(result => {
      let season = (new ErgastParser).parse(result.data);
      return Season.update({_id: season.year}, season, {upsert: true});
    });
  }

  services.get("database").model("season").findCurrent().then(season => {
    if (!season) {
      updateSeasonData().catch(error => console.error("seasondata.update", error.stack));
    }
  }).catch(error => console.error(error.stack));

  services.get("command.manager").add("reloadSeason", () => {
    return updateSeasonData().then(() => "OK");
  });
};
