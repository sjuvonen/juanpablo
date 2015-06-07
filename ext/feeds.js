/**
 * Follows RSS feeds and publishes new articles to channels.
 */

var events = require("events");
var FeedParser = require("feedparser");
var Promise = require("promise");
var request = require("request");
var util = require("util");

exports.initialize = function(bot) {
  var feeds = new FeedManager(bot, bot.config.feeds);
  feeds.watch();
};

var FeedManager = function(bot, options) {
  if (options.refresh < 60) {
    throw new Error("Minimum feed polling interval is one minute!");
  }
  this.bot = bot;
  this.feeds = options.sources || [];
  this.refreshTime = options.refresh;
  this.publishTime = options.publish,
  this.events = new events.EventEmitter;
  this.queue = [];
  this.timers = {
    refresh: 0,
    publish: 0,
  };
};

FeedManager.prototype = {
  watch: function() {
    if (this.timers.refresh) {
      console.error("FeedManager already running");
      return false;
    }
    var manager = this;
    manager.refresh();

    this.timers.refresh = setInterval(function() {
      manager.refresh();
    }, this.refreshTime * 1000);
    this.timers.publish = setInterval(function() {
      manager.publishNext();
    }, this.publishTime * 1000);
  },
  stop: function() {
    if (this.timers.refresh) {
      clearInterval(this.timers.refresh);
      clearInterval(this.timers.publish);
    }
  },
  refresh: function() {
    var manager = this;
    return new Promise(function(resolve, reject) {
      var now = new Date;

      manager.feeds.forEach(function(feed) {
        if (now - feed.updated >= manager.refreshTime) {
          feed.refresh();
        }
      });
    }).catch(function(error) {
      console.error("Refreshing feeds failed:", error);
    });
  },
  enqueue: function(article) {
    this.queue.push(article);
  },
  publishNext: function() {
    if (!this.queue.length) {
      return;
    }
    var article = this.queue.shift();
    var message = this.formatArticle(article);
    this.bot.spam(message);
  },
  formatArticle: function(article) {
    return util.format("[%s] %s - %s",
      article.source.toUpperCase().replace(" ", ""),
      article.title,
      article.link);
  }
};

Object.defineProperties(FeedManager.prototype, {
  feeds: {
    get: function() {
      return this._feeds;
    },
    set: function(sources) {
      this._feeds = [];
      var manager = this;

      sources.forEach(function(source) {
        var feed = new Feed(source);
        manager.feeds.push(feed);

        feed.on("article", function(item) {
          manager.enqueue(item);
        });
      });
    }
  }
});

var Feed = function(options) {
  this.options = options;
  this.events = new events.EventEmitter;
  this.updated = new Date;
  this.updated.setMinutes(this.updated.getMinutes() - 5);
};

Feed.prototype = {
  on: function() {
    this.events.on.apply(this.events, arguments);
  },
  emit: function() {
    this.events.emit.apply(this.events, arguments);
  },
  refresh: function() {
    var req = request(this.url);
    var parser = new FeedParser({feedurl: this.url});
    var feed = this;
    var lastUpdate = this.updated;

    this.updated = new Date;

    req.on("error", function(error) {
      console.error("request error", error);
    });

    req.on("response", function(res) {
      if (res.statusCode != 200) {
        return this.emit("error", new Error("Bad status code: " + res.statusCode));
      }
      this.pipe(parser);
    });

    parser.on("error", function(error) {
      console.error("parser error", error);
    });

    parser.on("readable", function() {
      var item;

      while (item = this.read()) {
        if (lastUpdate < new Date(item.pubDate)) {
          feed.emit("article", {
            source: feed.name,
            title: item.title,
            date: new Date(item.pubDate),
            link: item.link,
          });
        }
      }
    });
  }
};

Object.defineProperties(Feed.prototype, {
  name: {
    get: function() {
      return this.options.name;
    }
  },
  url: {
    get: function() {
      return this.options.url;
    }
  },
});
