
var http = require("http");
var https = require("https");
var Promise = require("promise");

module.exports = {
  download: function(url) {
    url = this.completeUrl(url);

    return new Promise(function(resolve, reject) {
      var client = url.substring(0, 8) == "https://" ? https : http;

      client.get(url, function(res) {
        var chunks = [];

        res.on('data', function(chunk) {
          chunks.push(chunk);
        });

        res.on('end', function() {
          if (res.statusCode > 300 && res.statusCode <= 308) {
            if (res.headers.location) {
              resolve(module.exports.download(res.headers.location));
            }
          } else {
            resolve({
              data: Buffer.concat(chunks),
              headers: res.headers,
            });
          }
        });
      })
      .on('error', function(err) {
        reject(err.message);
      });
    });
  },
  completeUrl: function(url) {
    if (!url.match('://')) {
      url = 'http://' + url;
    }
    return url;
  },
};
