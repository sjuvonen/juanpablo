/**
 * Follow RSS feeds and publish new articles to channels.
 */

"use strict";

let EventEmitter = require("events");
let FeedParser = require("feedparser");
let request = require("request");
let urllib = require("url");
let util = require("util");
let proxy = require("../core/proxy");

exports.configure = function(connection) {
  let feeds = new FeedManager(connection, connection.config.modules.feeds);
  feeds.watch();
  return feeds;
};

class FeedManager {
  constructor(connection, config) {
    this.connection = connection;
    this.config = config;
    this.events = new EventEmitter;
    this.queue = [];
    this.timers = {
      refresh: null,
      publish: null,
    };
    this.feeds = this.config.sources || [];
  }

  watch() {
    if (this.isWatching) {
      console.error("FeedManager is already running.");
      return false;
    }
    this.refresh();
    this.timers.refresh = setInterval(proxy(this.refresh, this), this.refreshInterval * 1000);
    this.timers.publish = setInterval(proxy(this.publishNext, this), this.publishInterval * 1000);
  }

  stop() {
    if (this.isWatching) {
      clearInterval(this.timers.refresh);
      clearInterval(this.timers.publish);

      this.timers = {
        refresh: null,
        publish: null,
      };
    }
  }

  refresh() {
    return new Promise((resolve, reject) => {
      let now = new Date;

      this.feeds.forEach(feed => {
        if (now - feed.updated >= this.refreshInterval) {
          feed.refresh();
        }
      });
    }, error => {
      console.error("feeds:", error.stack);
    });
  }

  enqueue(article) {
    this.queue.push(article);
  }

  publishNext() {
    if (this.queue.length) {
      let article = this.queue.shift();
      let message = this.formatArticle(article);
      this.connection.amsg(message);
    }
  }

  stripQueryVariables(url) {
    let data = urllib.parse(url, true);
    delete data.search;
    Object.keys(data.query).forEach(key => {
      if (Number.isNaN(data.query[key])) {
        delete data.query[key];
      }
    });
    return urllib.format(data);
  }

  formatArticle(article) {
    let link = this.stripQueryVariables(article.link);
    return util.format("[%s] %s - %s",
      article.source.toUpperCase().replace(/\W/, ""),
      article.title,
      link);
  }

  get isWatching() {
    return this.timers.refresh != null;
  }

  get refreshInterval() {
    return this.config.refresh;
  }

  get publishInterval() {
    return this.config.publish;
  }

  get feeds() {
    return this._feeds;
  }

  set feeds(sources) {
    this._feeds = [];
    sources.forEach(source => {
      let feed = new Feed(source);
      this._feeds.push(feed);

      feed.on("article", item => {
        this.enqueue(item);
      });
    });
  }
}

class Feed {
  constructor(config) {
    this.config = config;
    this.events = new EventEmitter;
    this.updated = new Date;
    this.updated.setMinutes(this.updated.getMinutes() - 5);
    this.cache = new Map;
  }

  refresh() {
    process.nextTick(() => {
      let req = request(this.url);
      let parser = new FeedParser({feedurl: this.url});
      let updated = this.updated - 1000 * 60 * 30;
      this.updated = new Date;

      req.on("error", error => {
        console.error("feed.refresh:", error.stack);
      })

      req.on("response", res => {
        if (res.statusCode != 200) {
          return console.error("feed.refresh: invalid status code", res.statusCode);
        }
        req.pipe(parser);
      });

      parser.on("error", error => {
        console.error("feed.parser:", error.stack);
      })

      parser.on("readable", () => {
        let item;
        while (item = parser.read()) {
          let cache_key = item.title.substring(0, 30).toLowerCase();
          if (updated < item.pubDate && !this.cache.has(cache_key)) {
            this.events.emit("article", {
              source: this.name,
              title: item.title,
              date: item.pubDate,
              link: item.link,
            });
            this.cache.set(cache_key, new Date);
          }
        }
      });

      let cache_expiry = new Date;
      cache_expiry.setHours(cache_expiry.getHours() - 1);

      this.cache.forEach((expires, key) => {
        if (expires < cache_expiry) {
          this.cache.delete(key);
        }
      });
    });
  }

  on() {
    this.events.on.apply(this.events, arguments);
  }

  get name() {
    return this.config.name;
  }

  get url() {
    return this.config.url;
  }
}
