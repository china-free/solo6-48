const { WebSocketServer, WebSocket } = require('ws');
const { v4: uuidv4 } = require('uuid');
const os = require('os');

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
    const clientInfo = { ws, id: clientId, deviceId: null };

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

  broadcast(message, targetDeviceIds = null) {
    const payload = JSON.stringify(message);
    for (const [, client] of this.clients) {
      if (!client.deviceId) continue;
      if (targetDeviceIds && !targetDeviceIds.includes(client.deviceId)) continue;
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(payload);
      }
    }
  }

  sendToDevice(deviceId, message) {
    const payload = JSON.stringify(message);
    for (const [, client] of this.clients) {
      if (client.deviceId === deviceId && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(payload);
        return true;
      }
    }
    return false;
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
