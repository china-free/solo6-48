const { v4: uuidv4 } = require('uuid');
const os = require('os');

const MAX_HISTORY = 20;

class SyncHistory {
  constructor() {
    this.items = [];
  }

  add(item) {
    const entry = {
      id: uuidv4(),
      ...item,
      timestamp: Date.now(),
      sourceDevice: item.sourceDevice || os.hostname()
    };
    this.items.unshift(entry);
    if (this.items.length > MAX_HISTORY) {
      this.items = this.items.slice(0, MAX_HISTORY);
    }
    return entry;
  }

  getAll() {
    return [...this.items];
  }

  clear() {
    this.items = [];
  }

  removeById(id) {
    this.items = this.items.filter(item => item.id !== id);
  }
}

module.exports = SyncHistory;
