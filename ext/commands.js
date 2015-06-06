
var Promise = require("promise");

exports.initialize = function(bot) {
  bot.addCommand("commands", function() {
    return new Promise(function(resolve, reject) {
      var names = Object.keys(bot.commands.commands);
      names.sort();

      var message = "Available commands: " + names.join(", ");
      resolve(message);
    });
  });
};
