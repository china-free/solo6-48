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
      sourceDevice: item.sourceDevice || os.hostname(),
      targets: item.targets || []
    };
    if (item.direction === 'received' && !item.targets?.length) {
      entry.targets = [];
    }
    this.items.unshift(entry);
    if (this.items.length > MAX_HISTORY) {
      this.items = this.items.slice(0, MAX_HISTORY);
    }
    return entry;
  }

  updateTargetStatus(entryId, deviceId, status, reason) {
    const entry = this.items.find(item => item.id === entryId);
    if (!entry) return false;
    const target = entry.targets.find(t => t.deviceId === deviceId);
    if (target) {
      target.status = status;
      if (reason !== undefined) {
        target.reason = reason;
      }
      target.updatedAt = Date.now();
      return true;
    }
    return false;
  }

  getById(id) {
    return this.items.find(item => item.id === id) || null;
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
