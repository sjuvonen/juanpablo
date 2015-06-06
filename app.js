
var config = require("./config");
config.root = __dirname;

var Bot = require("./core/bot").Bot;
var bot = new Bot(config);
bot.start();
