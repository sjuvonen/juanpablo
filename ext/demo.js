
var Promise = require("promise");

exports.initialize = function(bot) {
//   console.log("INITIALIZE");
  bot.addCommand("demo", demoCommand);
};

var demoCommand = function() {
  console.log("RUN COMMAND");

  return new Promise(function(resolve, reject) {
    resolve("oh la la");
  });
};
