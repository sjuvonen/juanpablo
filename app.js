"use strict";

if (!("values" in Array.prototype)) {
  Array.prototype.values = function * () {
    for (let i = 0; i < this.length; i++) {
      yield this[i];
    }
  };
}

let config = require("./config");
let bot = require("./src/bot");
let app = bot(config);

app.start().then(() => {
  console.log("Bot started...");
}, error => {
  console.error("Bot crashed", error.stack);
});
