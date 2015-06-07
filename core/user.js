
var Promise = require("promise");

var User = function(nick, server) {
  this.nick = nick;
  this.server = server;
  this.info = null;
};

User.prototype = {
  whois: function() {
    var user = this;
    return new Promise(function(resolve, reject) {
      user.server.whois(user.nick).then(resolve, reject);
    });
  }
};

module.exports = User;
