"use strict";

var http = require("http");
var https = require("https");
var Promise = require("promise");
var urllib = require("url");
var zlib = require("zlib");

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
      info["user-agent"] = "Mozilla/5.0 (X11; Linux i686 on x86_64; rv:10.0) Gecko/20100101 Firefox/10.0";

      var client = info.protocol == "https:" ? https : http;

      var req = client.get(info, function(res) {
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
  },
  _isGzip: function(response) {
    return response.headers["content-encoding"] == "gzip";
  },
  _uncompress: function(data) {
    var isGzip = this._isGzip;
    return new Promise(function(resolve, reject) {
      zlib.unzip(data, function(data) {
        console.log("UNCOMP!", data);
        resolve(data);
      });
    });
  }
};
