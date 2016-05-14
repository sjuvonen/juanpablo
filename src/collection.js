"use strict";

exports.mapWait = (items, callback) => {
  return new Promise((resolve, reject) => {
    let index = 0;
    let result = new Array(items.length);
    let run = () => {
      if (index >= items.length) {
        return resolve(result);
      }
      Promise.resolve(callback(items[index], index)).then(value => {
        result[index] = value;
        index++;
        run();
      }, error => {
        console.error(error);
        reject(error);
      });
    };
    run();
  });
};
