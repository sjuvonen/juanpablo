"use strict";

let EventEmitter = require("events");
let http = require("http");
let https = require("https");
let urllib = require("url");
let proxy = require("./proxy");

class Download {
  constructor(url) {
    this.url = typeof url == "string" ? url : null;
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
      this.resolve(download.url).then(response => {
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
      }, reject);
    });
  }

  static parseUrl(url) {
    if (url.indexOf("://") == -1) {
      url = "http://" + url;
    }
    return urllib.parse(url);
  }

  static get(url) {
    let download = new Download(url);
    return download.start();
  }

  /**
   * Parse the URL and initiate a request.
   */
  static request(url) {
    let info = Download.parseUrl(url);
    let client = info.protocol == "https:" ? https : http;
    let request = client.get(info);
    return request;
  }

  /**
   * Resolve passed request or URL to a "final response" i.e. handle redirect loops.
   *
   * Promise will reject if there is an error.
   */
  resolve(request) {
    let download = this;
    return new Promise((resolve, reject) => {
      let get = function(request) {
        download.request = request;
        request.on("response", response => {
          if ("location" in response.headers) {
            request.abort();
            let redirect = urllib.resolve(download.url, response.headers.location);
            return get(Download.request(redirect));
          } else {
            download.response = response
            resolve(response);
          }
        });
        request.on("error", reject);
      };
      get(typeof request == "string" ? Download.request(request) : request);
    });
  }
}

/**
 * Returns a Promise that will resolve when download is finished.
 */
exports.download = function(url) {
  return Download.get(url);
};

/**
 * Download up to a defined number of bytes.
 */
exports.downloadBytes = function(url, max_size) {
  return new Promise((resolve, reject) => {
    let request = Download.request(url);
    let download = new Download;

    download.resolve(request).then(response => {
      let chunks = [];
      let size = 0;

      response.on("data", chunk => {
        chunks.push(chunk);
        size += chunk.length;

        if (size >= max_size) {
          request.abort();
          resolve({
            data: Buffer.concat(chunks).slice(0, max_size),
            headers: response.headers,
          });
        }
      });

      response.on("end", () => {
        resolve({
          data: Buffer.concat(chunks).slice(0, max_size),
          headers: response.headers,
        });
      });
    }, reject);
  });
}

/**
 * Return a Download object that can be connected to for advanced usage.
 */
exports.request = function(url) {
  return new Download(url);
};
