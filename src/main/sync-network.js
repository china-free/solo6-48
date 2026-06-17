const { WebSocketServer, WebSocket } = require('ws');
const { v4: uuidv4 } = require('uuid');

const DEFAULT_PORT = 9876;

class SyncServer {
  constructor(port) {
    this.port = port || DEFAULT_PORT;
    this.wss = null;
    this.clients = new Map();
    this.onMessage = null;
  }

  start() {
    return new Promise((resolve, reject) => {
      this.wss = new WebSocketServer({ port: this.port }, () => {
        resolve(this.port);
      });

      this.wss.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          this.port = this.port + 1;
          this.wss = new WebSocketServer({ port: this.port }, () => {
            resolve(this.port);
          });
          this.wss.on('connection', (ws) => this._handleConnection(ws));
          this.wss.on('error', reject);
        } else {
          reject(err);
        }
      });

      this.wss.on('connection', (ws) => this._handleConnection(ws));
    });
  }

  _handleConnection(ws) {
    const clientId = uuidv4();
    const clientInfo = { ws, id: clientId, deviceId: null, deviceName: null };

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'identify') {
          clientInfo.deviceId = msg.deviceId;
          clientInfo.deviceName = msg.deviceName;
          this.clients.set(clientId, clientInfo);
          return;
        }
        if (this.onMessage) {
          this.onMessage(msg, clientInfo);
        }
      } catch (e) {
        console.error('Failed to parse message:', e.message);
      }
    });

    ws.on('close', () => {
      this.clients.delete(clientId);
    });

    ws.on('error', () => {
      this.clients.delete(clientId);
    });

    this.clients.set(clientId, clientInfo);
  }

  getConnectedDevices() {
    const result = [];
    for (const [, client] of this.clients) {
      if (client.deviceId && client.ws.readyState === WebSocket.OPEN) {
        result.push({ deviceId: client.deviceId, deviceName: client.deviceName });
      }
    }
    return result;
  }

  broadcast(message, targetDeviceIds = null) {
    const payload = JSON.stringify(message);
    const results = [];

    for (const [, client] of this.clients) {
      if (!client.deviceId) continue;
      const isInTarget = !targetDeviceIds || targetDeviceIds.includes(client.deviceId);
      if (!isInTarget) continue;

      if (client.ws.readyState === WebSocket.OPEN) {
        try {
          client.ws.send(payload);
          results.push({ deviceId: client.deviceId, deviceName: client.deviceName, sent: true });
        } catch (e) {
          results.push({ deviceId: client.deviceId, deviceName: client.deviceName, sent: false, reason: e.message });
        }
      } else {
        results.push({ deviceId: client.deviceId, deviceName: client.deviceName, sent: false, reason: '连接未就绪' });
      }
    }

    if (targetDeviceIds) {
      for (const tid of targetDeviceIds) {
        if (!results.some(r => r.deviceId === tid)) {
          results.push({ deviceId: tid, deviceName: null, sent: false, reason: '设备未连接' });
        }
      }
    }

    return results;
  }

  sendToDevice(deviceId, message) {
    const payload = JSON.stringify(message);
    for (const [, client] of this.clients) {
      if (client.deviceId === deviceId) {
        if (client.ws.readyState === WebSocket.OPEN) {
          try {
            client.ws.send(payload);
            return { deviceId, deviceName: client.deviceName, sent: true };
          } catch (e) {
            return { deviceId, deviceName: client.deviceName, sent: false, reason: e.message };
          }
        } else {
          return { deviceId, deviceName: client.deviceName, sent: false, reason: '连接未就绪' };
        }
      }
    }
    return { deviceId, deviceName: null, sent: false, reason: '设备未连接' };
  }

  stop() {
    for (const [, client] of this.clients) {
      client.ws.close();
    }
    this.clients.clear();
    if (this.wss) {
      this.wss.close();
    }
  }
}

class SyncClient {
  constructor() {
    this.connections = new Map();
    this.onMessage = null;
    this.deviceId = null;
    this.deviceName = null;
  }

  setIdentity(deviceId, deviceName) {
    this.deviceId = deviceId;
    this.deviceName = deviceName;
  }

  connect(host, port) {
    const key = `${host}:${port}`;
    if (this.connections.has(key)) {
      const existing = this.connections.get(key);
      if (existing.ws.readyState === WebSocket.OPEN || existing.ws.readyState === WebSocket.CONNECTING) {
        return;
      }
    }

    const ws = new WebSocket(`ws://${host}:${port}`);

    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'identify',
        deviceId: this.deviceId,
        deviceName: this.deviceName
      }));
    });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (this.onMessage) {
          this.onMessage(msg);
        }
      } catch (e) {
        console.error('Client parse error:', e.message);
      }
    });

    ws.on('close', () => {
      this.connections.delete(key);
    });

    ws.on('error', () => {
      this.connections.delete(key);
    });

    this.connections.set(key, { ws, host, port });
  }

  disconnect(host, port) {
    const key = `${host}:${port}`;
    const conn = this.connections.get(key);
    if (conn) {
      conn.ws.close();
      this.connections.delete(key);
    }
  }

  disconnectAll() {
    for (const [, conn] of this.connections) {
      conn.ws.close();
    }
    this.connections.clear();
  }

  send(message) {
    const payload = JSON.stringify(message);
    for (const [, conn] of this.connections) {
      if (conn.ws.readyState === WebSocket.OPEN) {
        conn.ws.send(payload);
      }
    }
  }

  sendToHost(host, port, message) {
    const key = `${host}:${port}`;
    const conn = this.connections.get(key);
    if (conn && conn.ws.readyState === WebSocket.OPEN) {
      conn.ws.send(JSON.stringify(message));
      return true;
    }
    return false;
  }
}

module.exports = { SyncServer, SyncClient };
