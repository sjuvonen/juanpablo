
var Manager = function() {
  this.ignores = [];
};

Manager.prototype = {
  /**
   * Add new item to ignore.
   *
   * Info block may contain keys: nick, user, host
   */
  addIgnore: function(info) {
    this.ignores.push(info);
  },
  isIgnored: function(info) {
    for (var i = 0; i < this.ignores.length; i++) {
      var item = this.ignores[i];

      if ("nick" in item && item.nick == info.nick) {
        return true;
      }
      if ("host" in item && item.host == info.host) {
        return true;
      }
      if ("user" in item && item.user == info.user) {
        return true;
      }
    }
    return false;
  },
};

module.exports = {
  Manager: Manager,
};
