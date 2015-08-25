"use strict";

var config = require("./config");
config.root = __dirname;

var bot = new (require("./core/bot").Bot)(config);
bot.start();
