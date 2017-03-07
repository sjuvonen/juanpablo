"use strict";

let entities = require("entities");
let iconv = require("iconv-lite");
let net = require("../net");
let util = require("util");
let zlib = require("zlib");

class PageTitle {
  handleMessage(content) {
    let url = this.parseUrl(content);
    if (url) {
      return this.fetchTitle(url);
    } else {
      return Promise.reject(new Error("No URLs found"));
    }
  }

  fetchTitle(url) {
    return new Promise((resolve, reject) => {
      let download = net.request(url);
      download.on("response", response => {
        try {
          let headers = response.headers;

          if ("content-type" in headers) {
            if (headers["content-type"].match("html")) {
              return;
            }

            download.abort();

            if (headers["content-type"].match(/image|audio/)) {
              this.parseTypeInfo(response).then(resolve, reject);
            }
          }
        } catch (error) {
          console.error("pagetitle.fetchtitle:", error);
        }
      });

      download.start()
        .then(response => this.decodeResponse(response))
        .then(content => {
          let title = this.parseTitle(content);
          if (title) {
            resolve(title);
          }
        });
    });
  }

  parseTypeInfo(response) {
    return new Promise((resolve, reject) => {
      let mime = response.headers["content-type"];
      let type = mime.substring(0, mime.indexOf("/"));
      let size = response.headers["content-length"];
      resolve(util.format("%s file (%d MB)", type, Math.round(size / 1000) / 1000));
    });
  }

  decodeResponse(response) {
    return new Promise((resolve, reject) => {
      let decode = function(content) {
        let charset = response.headers["content-type"].match(/charset=\b(.+)\b/);
        charset = charset ? charset[1] : "UTF-8";
        if (charset) {
          let data = iconv.decode(content.slice(0, 30000), charset);
          resolve(data);
        }
      }
      if (response.headers["content-encoding"] == "gzip") {
        zlib.gunzip(response.data, (error, raw) => {
          decode(raw);
        });
      } else {
        decode(response.data);
      }

    })
  }

  parseUrl(content) {
    let result = content.match(this.urlRegex);
    return result ? result[0] : null;
  }

  parseTitle(html) {
    let start = html.search(this.titleOpenRegex);
    let end = html.search(this.titleCloseRegex);

    if (start >= 0 && end >= 0) {
      let title = html.substring(html.indexOf(">", start) + 1, end).replace(/\s+/, " ").trim();
      return entities.decodeHTML(title);
    }
  }

  get urlRegex() {
    if (!this._ur) {
      this._ur = /(http.{0,1}:\/\/|www\.)\S+/;
    }
    return this._ur;
  }

  get titleOpenRegex() {
    if (!this._otr) {
      this._otr = /<title/i;
    }
    return this._otr;
  }

  get titleCloseRegex() {
    if (!this._ctr) {
      this._ctr = /<\/title>/i;
    }
    return this._ctr;
  }
}

exports.configure = services => {
  let pagetitle = new PageTitle;

  services.get("event.manager").on("message", message => pagetitle.handleMessage(message.content).then(title => {
    message.reply("> " + title);
  }, error => {
    // pass
  }));
};
