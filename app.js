"use strict";

let Bot = require("./core/bot").Bot;
let bot = new Bot(require("./config"));

bot.start().then(() => {
  console.log("Bot started...");
}, error => {
  console.error("Bot crashed", error);
});
