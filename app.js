"use strict";

let config = require("./config");
config.root = __dirname;

let bot = new (require("./core/bot").Bot)(config);
bot.start();
