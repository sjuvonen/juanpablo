
var User = function(nick, server) {
  this.nick = nick;
  this.server = server;
  this.info = null;
};

User.prototype = {
  whois: function(callback) {
    this.server.whois(this.nick, callback);
  }
};

module.exports = User;
