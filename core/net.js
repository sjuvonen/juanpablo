
var http = require("http");
var https = require("https");
var Promise = require("promise");
var urllib = require("url");

module.exports = {
  head: function(url) {
    return this._request(url, "HEAD");
  },
  download: function(url) {
    return this._request(url, "GET");
  },
  _request: function(url, method) {
    return new Promise(function(resolve, reject) {
      if (url.indexOf("://") == -1) {
        url = "http://" + url;
      }

      var info = urllib.parse(url);
      info.method = method;

      var client = info.protocol == "https" ? https : http;

      var req = client.request(info, function(res) {
        var chunks = [];

        res.on("data", function(chunk) {
          chunks.push(chunk);
        });

        res.on("end", function() {
          if (res.statusCode > 300 && res.statusCode <= 308) {
            if (res.headers.location) {
              return resolve(module.exports.download(res.headers.location));
            }
          } else {
            return resolve({
              data: Buffer.concat(chunks),
              headers: res.headers,
            });
          }
          reject("unknown failure");
        });
      })
      .on("error", function(err) {
        console.error("ERROR", err);
        reject(err.message);
      }).end();
    });
  }
};
