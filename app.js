"use strict";

let config = require("./config");
let Bot = require("./core/bot").Bot;
let bot = new Bot(config);

let util = require("util");
let mongoose = require("mongoose");
let host = config.database.mongodb.host;
let database = config.database.mongodb.database;
mongoose.connect(util.format("mongodb://%s/%s", host, database));

bot.start().then(() => {
  console.log("Bot started...");
}, error => {
  console.error("Bot crashed", error);
});
