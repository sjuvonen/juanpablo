var entities = require("entities");
var iconv = require("iconv-lite");
var Promise = require("promise");

exports.initialize = function(bot) {
  PageTitle.net = bot.net;
  bot.on("message", function(message) {
    var url = PageTitle.parseUrl(message.content);

    if (url) {
      PageTitle.fetchPage(url).then(function(title) {
        message.reply(title);
      }).catch(function(error) {
        console.log("ERROR", error);
      });
    }
  });
};

var PageTitle = {
  parseUrl: function(text) {
    var result = text.match(/(http.{0,1}:\/\/|www\.)\S+/);
    return result ? result[0] : null;
  },
  fetchPage: function(url) {
    return new Promise(function(resolve, reject) {
      PageTitle.net.download(url).then(function(response) {
        if ("content-type" in response.headers) {
          if (response.headers["content-type"].match("html")) {
            var charset = response.headers["content-type"].match(/charset=\b(.+)\b/);
            charset = charset ? charset[1] : "UTF-8";

            if (charset) {
              var data = iconv.decode(response.data, charset);
              var title = PageTitle.parseTitle(data);

              if (title) {
                return resolve("Title: " + title);
              }
            }
          }
        }
      });
    });
  },
  parseTitle: function(html) {
    var title = html.match(/<title.*?>(.+)<\/title>/i);
    return title ? entities.decodeHTML(title[1]) : null;
  },
};
