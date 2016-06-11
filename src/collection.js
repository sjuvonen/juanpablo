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
        reject(error);
      });
    };
    run();
  });
};



/**
 * Utility class for storing values that expire (are removed) automaticly after defined threshold time.
 */
class AgingCache {
  constructor(expire) {
    this.expire = expire || Number.MAX_SAFE_INTEGER;
    this.cache = new Map;
    this.timestamps = new Map;
  }

  push(key) {
    this.set(key, null);
  }

  set(key, value) {
    this.cache.set(key, value);
    this.timestamps.set(key, Date.now());
  }

  get(key) {
    if (this.has(key)) {
      return this.cache.get(key);
    }
  }

  has(key) {
    if (!this.timestamps.has(key)) {
      return false;
    }
    if (Date.now() - this.timestamps.get(key) >= this.expire) {
      this.delete(key);
      return false;
    }
    return true;
  }

  delete(key) {
    this.cache.delete(key);
    this.timestamps.delete(key);
  }
}

exports.AgingCache = AgingCache;
