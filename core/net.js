"use strict";

let EventEmitter = require("events");
let http = require("http");
let https = require("https");
let urllib = require("url");
let proxy = require("./proxy");

class Download {
  constructor(url) {
    this.url = url;
    this.events = new EventEmitter;
    this.aborted = false;
  }

  abort() {
    this.aborted = true;
    this.request.abort();
  }

  on(event, callback) {
    this.events.on(event, callback);
    return this;
  }

  off(event, callback) {
    this.events.off(event, callback);
    return this;
  }

  start() {
    let download = this;
    return new Promise((resolve, reject) => {
      let get = function(url) {
        let info = download.parseUrl(url);
        let client = info.protocol == "https:" ? https : http;
        let request = download.request = client.get(info);

        request.on("response", response => {
          if ("location" in response.headers) {
            request.abort();
            let redirect = urllib.resolve(info.href, response.headers.location);
            return get(redirect);
          }

          download.events.emit("response", response);
          let chunks = [];

          response.on("data", proxy(chunks.push, chunks));

          response.on("end", () => {
            if (!download.aborted) {
              let result = {
                data: Buffer.concat(chunks),
                headers: response.headers,
              };
              download.events.emit("end", result);
              resolve(result);
            }
          });
        });

        request.on("error", error => {
          console.error("ERROR", error);
          reject(error);
        });
      };


      get(download.url);
    });
  }

  parseUrl(url) {
    if (url.indexOf("://") == -1) {
      url = "http://" + url;
    }
    return urllib.parse(url);
  }

  static get(url) {
    let download = new Download(url);
    return download.start();
  }
}

/**
 * Returns a Promise that will resolve when download is finished.
 */
exports.download = function(url) {
  return Download.get(url);
};

/**
 * Return a Download object that can be connected to for advanced usage.
 */
exports.request = function(url) {
  return new Download(url);
};
