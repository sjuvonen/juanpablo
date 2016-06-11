"use strict";

let FeedParser = require("feedparser");
let mongoose = require("mongoose");
let request = require("request");
let urllib = require("url");
let util = require("util");
let AgingCache = require("../collection").AgingCache;

let FeedSchema = new mongoose.Schema({
  name: String,
  url: String,
  fetched: Date,
  created: {
    type: Date,
    default: Date.now
  },
});

let FeedItemSchema = new mongoose.Schema({
  feed: mongoose.Schema.ObjectId,
  feedName: String,
  title: String,
  url: String,
  date: {
    type: Date,
    default: Date.now,
  },
  published: {
    type: Boolean,
    default: false,
  }
});

class FeedWatcher {
  constructor(feed, config) {
    this.feed = feed;
    this.config = config;
    this.cache = new AgingCache(1000 * 60 * 60);
  }

  get interval() {
    return this.config.refresh * 1000;
  }

  update() {
    return new Promise((resolve, reject) => {
      let FeedItem = this.feed.db.model("feed_item");
      let req = request(this.feed.url);
      let parser = new FeedParser({feedurl: this.feed.url});
      let threshold = new Date - this.interval;

      threshold = new Date - 1000 * 60 * 80;

      req.on("error", reject);
      parser.on("error", reject);

      req.on("response", res => {
        if (res.statusCode != 200) {
          return reject(new Error("Feed returned invalid status " + res.statusCode));
        }
        req.pipe(parser);
      });

      parser.on("readable", () => {
        let raw;
        while (raw = parser.read()) {
          let cache_key = raw.title.substring(0, 70).toLowerCase();
          if (raw.pubDate > threshold && !this.cache.has(cache_key)) {
            this.cache.push(cache_key);
            let item = new FeedItem({
              feed: this.feed.id,
              feedName: this.feed.name,
              title: raw.title,
              url: this.stripQueryVariables(raw.link),
              date: raw.pubDate,
            });
            item.save();
          }
        }
      });
    });
  }

  watch() {
    this.timer = setInterval(() => {
      this.update().catch(error => console.error(error.stack));
    }, this.interval);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  stripQueryVariables(url) {
    let data = urllib.parse(url, true);
    delete data.search;
    Object.keys(data.query).forEach(key => {
      if (isNaN(data.query[key])) {
        delete data.query[key];
      }
    });
    return urllib.format(data);
  }
}

class FeedManager {
  constructor(storage, config) {
    this.storage = storage;
    this.config = config;
    this.watchers = new Map;
  }

  importFeeds(sources) {
    this.storage.find().then(feeds => {
      let names = feeds.map(f => f.name.toLowerCase());
      let urls = feeds.map(f => f.url.toLowerCase());

      sources.forEach(source => {
        let name = source.name.toLowerCase();
        let url = source.url.toLowerCase();
        if (names.indexOf(name) == -1 && urls.indexOf(url) == -1) {
          this.add(source.name, source.url);
        }
      })
    });
  }

  add(name, url) {
    let feed = new this.storage({
      name: name,
      url: url
    });
    this.watchFeed(feed);
    return feed.save();
  }

  get(name) {
    return this.storage.findOne({name: new RegExp(name, "i")});
  }

  remove(name) {
    return this.storage.remove({name: new RegExp(name, "i")});
  }

  watch() {
    this.storage.find().then(feeds => feeds.forEach(feed => this.watchFeed(feed)));
  }

  watchFeed(feed) {
    if (!this.watchers.has(feed.name)) {
      let watcher = new FeedWatcher(feed, this.config);
      watcher.watch();
      this.watchers.set(feed.name, watcher);
    }
  }
}

class FeedPublisher {
  constructor(storage, connection, config) {
    this.storage = storage;
    this.connection = connection;
    this.config = config;
  }

  get interval() {
    return this.config.publish * 1000;
  }

  start() {
    this.timer = setInterval(() => this.publish(), this.interval);
  }

  publish() {
    return this.storage.findOneAndUpdate({published: false}, {published: true}, {sort: {date: -1}})
      .then(item => {
        if (item) {
          let message = this.formatArticle(item);
          this.connection.amsg(message);
        }
      }).catch(error => console.error(error.stack));
  }

  formatArticle(article) {
    return util.format("[%s] %s - %s",
      article.feedName.toUpperCase().replace(/\W/, ""),
      article.title,
      article.url);
  }
}

exports.configure = services => {
  let config = services.get("config").get("modules.feeds");
  let connection = services.get("connection");
  let database = services.get("database");
  let Feed = database.model("feed", FeedSchema);
  let FeedItem = database.model("feed_item", FeedItemSchema);

  let feeds = new FeedManager(Feed, config);
  feeds.watch();
  feeds.importFeeds(config.sources);

  let publisher = new FeedPublisher(FeedItem, connection, config);
  publisher.start();

  services.register("feed.manager", feeds);
  services.register("feed.published", publisher);
};
