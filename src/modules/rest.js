"use strict";

let express = require("express");
let AsyncEventManager = require("colibre/src/events").AsyncEventManager;
let Router = require("colibre/src/router").Router;

/**
 * TODO: Restructure Colibre to provide a minimal web server and replace this with it.
 */
class Server {
  constructor(config) {
    this.config = config;
    this.app = express();
    this.router = new Router;
  }

  start() {
    return new Promise((resolve, reject) => {
      let address = this.config.address || "localhost";
      let port = this.config.port || 8000;

      this.app.use((req, res, next) => {
        this.router.match(req.path, req.method, req.hostname)
          .then(match => {
            Promise.resolve(match.callback(match)).then(result => {
              if (typeof result == "object") {
                return res.type("json").send(result);
              }

              if (typeof result == "string") {
                return res.type("text").send(result);
              }
            });
          }, error => {
            res.status(404).send("Resource not found");
          });
      });

      this.app.listen(port, address, () => {
        let util = require("util");
        console.log(util.format("REST Server started at %s:%d", address, port));
        resolve();
      });
    });
  }
}

exports.configure = services => {

  // The factory is wired to start the server automaticly when the bot is also started.
  services.registerFactory("rest.server", () => {
    let config = services.get("config").get("modules.rest");
    let server = new Server(config);

    console.log("server loaded");
    services.get("event.manager").on("connect", () => console.log("HELLO"));
    services.get("event.manager").on("connect", () => server.start());

    return server;
  });

  // This factory is will ensure that the server is also loaded.
  services.registerFactory("rest.router", () => {
    return services.get("rest.server").router;
  })
};
