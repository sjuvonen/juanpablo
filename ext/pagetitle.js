/**
 * Fetches page titles from links that are sent to channels.
 */

"use strict";

let entities = require("entities");
let iconv = require("iconv-lite");
let Promise = require("promise");

exports.initialize = function(bot) {
  PageTitle.net = bot.net;
  bot.on("message", function(message) {
    let url = PageTitle.parseUrl(message.content);

    if (url) {
      PageTitle.fetchPage(url).then(function(title) {
        message.reply(title);
      }).catch(function(error) {
        console.log("ERROR", error);
      });
    }
  });
};

let PageTitle = {
  parseUrl: function(text) {
    let result = text.match(/(http.{0,1}:\/\/|www\.)\S+/);
    return result ? result[0] : null;
  },
  fetchPage: function(url) {
    return new Promise(function(resolve, reject) {
      PageTitle.net.download(url).then(function(response) {
        if (!("content-type" in response.headers) || !response.headers["content-type"].match("html")) {
          return reject("Invalid content type");
        }
        // PageTitle.net.download(url).then(function(response) {
          let charset = response.headers["content-type"].match(/charset=\b(.+)\b/);
          charset = charset ? charset[1] : "UTF-8";

          if (charset) {
            let data = iconv.decode(response.data, charset);
            let title = PageTitle.parseTitle(data);

            if (title) {
              return resolve("> " + title);
            }
          }
        // });
      });
    });
  },
  parseTitle: function(html) {
    let title = html.match(/<title.*?>(.+)<\/title>/i);
    return title ? entities.decodeHTML(title[1]) : null;
  },
};
