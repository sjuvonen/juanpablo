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
  drivers: [String],
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

let Season = mongoose.model("season", SeasonSchema);

class WikipediaDriverParser {
  parse(html) {
    console.log("PARSE");
    let State = {
      WAIT: 0,
      WAIT_TITLE_SPAN: 1,
      WAIT_LEGEND_TABLE: 2,
      WAIT_RESULTS_TABLE: 3,
      RESULTS_TABLE: 4,
      CELL_NAME: 5,
      SKIP_FLAG_ANCHOR: 6,
      READ_NAME: 7,
      CELL_RESULT: 8,
    };
    let target_round = 0;

    let drivers = [];
    let result = [];
    let cell_i = 0;
    let name = null;
    let state = State.WAIT;

    try {
      let parser = new htmlparser.Parser({
        onopentag: (tag, attrs) => {
          switch (state) {
            case State.WAIT:
              if (tag == "h3") {
                state = State.WAIT_TITLE_SPAN;
              }
              break;
            case State.WAIT_TITLE_SPAN:
              if (tag == "span" && attrs.id && attrs.id.match(/drivers[\w\.]+standings/i)) {
                state = State.WAIT_LEGEND_TABLE;
              }
              break;
            case State.WAIT_LEGEND_TABLE:
            case State.WAIT_RESULTS_TABLE:
              if (tag == "table") {
                state++;
              }
              break;
            case State.RESULTS_TABLE:
              if (tag == "td") {
                state++;
              }
              break;
            case State.CELL_NAME:
            case State.SKIP_FLAG_ANCHOR:
              if (tag == "a") {
                state++;
              }
              break;
            case State.CELL_RESULT:
              if (tag == "td") {
                cell_i++;
              }
              break;
          }
        },
        ontext: text => {
          switch (state) {
            case State.READ_NAME:
              name = text.trim();
              drivers.push(text.trim());
              break;
            case State.CELL_RESULT:
              if (cell_i == target_round && text.trim().length) {
                let pos = parseInt(text.trim());
                if (pos) {
                  result[pos-1] = name;
                }
              }
              break;
          }
        },
        onclosetag: tag => {
          switch (state) {
            case State.RESULTS_TABLE:
              if (tag == "table") {
                state = -1;
              }
              break;
            case State.READ_NAME:
              if (tag == "a") {
                state = State.CELL_RESULT;
                cell_i = 0;
              }
              break;
            case State.CELL_RESULT:
              if (tag == "tr") {
                state = State.RESULTS_TABLE;
              }
              break;
          }
        },
      });
      parser.write(html);
      parser.end();

      return drivers;
    } catch (error) {
      console.error("seasondata.parse:", error.stack);
    }
  }
}

exports.configure = services => {
  function updateSeasonData(year) {
    if (!year) {
      year = (new Date).getFullYear();
    }

    let url = services.get("config").get("modules.seasondata.source.wikipedia");
    let source = util.format(url, year);

    return net.download(source).then(result => {
      let parser = new WikipediaDriverParser;
      let drivers = parser.parse(result.data.toString());

      drivers.sort();

      let entry = {
        _id: year,
        drivers: drivers,
        points: DefaultPoints,
      };

      return Season.update({_id: year}, {$set: entry}, {upsert: true});
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
