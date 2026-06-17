const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

const DeviceDiscovery = require('./device-discovery');
const { SyncServer, SyncClient } = require('./sync-network');
const ClipboardMonitor = require('./clipboard-monitor');
const SyncHistory = require('./sync-history');
const { encrypt, decrypt } = require('./encryption');

let mainWindow = null;
let tray = null;
let discovery = null;
let syncServer = null;
let syncClient = null;
let clipboardMonitor = null;
let syncHistory = null;
let encryptionPassword = '';
let skipNextClipboard = false;
let syncTargetDeviceIds = null;

const isDev = process.argv.includes('--dev');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 680,
    minWidth: 800,
    minHeight: 600,
    title: 'ClipSync - 局域网剪贴板同步',
    icon: path.join(__dirname, '..', 'renderer', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('close', (e) => {
    e.preventDefault();
    mainWindow.hide();
  });
}

function createTray() {
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  const contextMenu = Menu.buildFromTemplate([
    { label: '显示窗口', click: () => { mainWindow.show(); } },
    { label: '退出', click: () => { cleanupAndQuit(); } }
  ]);
  tray.setToolTip('ClipSync');
  tray.setContextMenu(contextMenu);
  tray.on('click', () => { mainWindow.show(); });
}

function cleanupAndQuit() {
  if (clipboardMonitor) clipboardMonitor.stop();
  if (discovery) discovery.stop();
  if (syncServer) syncServer.stop();
  if (syncClient) syncClient.disconnectAll();
  mainWindow.destroy();
  tray.destroy();
  app.quit();
}

function sendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

function _broadcastDeviceUpdate(newName) {
  const msg = {
    type: 'device-update',
    deviceId: discovery.getDeviceId(),
    deviceName: newName
  };
  const payload = encryptionPassword
    ? encrypt(msg, encryptionPassword)
    : { encrypted: false, data: msg };
  if (syncServer) syncServer.broadcast(payload);
  if (syncClient) syncClient.send(payload);
}

function _handleDeviceUpdate(data) {
  const deviceId = data.deviceId;
  if (!deviceId || deviceId === discovery.getDeviceId()) return;
  const devices = discovery.getDevices();
  const device = devices.find(d => d.id === deviceId);
  if (device && device.name !== data.deviceName) {
    device.name = data.deviceName;
    sendToRenderer('device-updated', device);
  }
}

function _sendAck(clientInfo, messageId, status, reason) {
  const ack = {
    type: 'ack',
    messageId,
    status,
    reason: reason || null,
    deviceId: discovery.getDeviceId(),
    deviceName: discovery.getDeviceName()
  };
  const payload = encryptionPassword
    ? encrypt(ack, encryptionPassword)
    : { encrypted: false, data: ack };

  if (clientInfo && clientInfo.ws) {
    try {
      clientInfo.ws.send(JSON.stringify(payload));
    } catch (e) {
      // ignore
    }
  } else {
    syncClient.send(payload);
  }
}

function _doSyncSend(contentType, content, targetDeviceIds) {
  const messageId = uuidv4();
  const message = {
    type: 'clipboard',
    messageId,
    contentType,
    content,
    sourceDeviceId: discovery.getDeviceId(),
    sourceDeviceName: discovery.getDeviceName(),
    timestamp: Date.now()
  };

  const payload = encryptionPassword
    ? encrypt(message, encryptionPassword)
    : { encrypted: false, data: message };

  let deliveryResults = [];
  if (targetDeviceIds && targetDeviceIds.length > 0) {
    for (const deviceId of targetDeviceIds) {
      const result = syncServer.sendToDevice(deviceId, payload);
      deliveryResults.push(result);
    }
  } else {
    deliveryResults = syncServer.broadcast(payload);
  }

  const targets = deliveryResults.map(r => ({
    deviceId: r.deviceId,
    deviceName: r.deviceName || r.deviceId.slice(0, 8),
    status: r.sent ? 'sent' : 'failed',
    reason: r.reason || null,
    updatedAt: Date.now()
  }));

  const entry = syncHistory.add({
    type: contentType,
    content,
    direction: 'sent',
    sourceDevice: discovery.getDeviceName(),
    messageId,
    targets
  });

  sendToRenderer('history-updated', syncHistory.getAll());
  return entry;
}

function setupIpc() {
  ipcMain.handle('get-devices', () => {
    return discovery ? discovery.getDevices() : [];
  });

  ipcMain.handle('get-history', () => {
    return syncHistory ? syncHistory.getAll() : [];
  });

  ipcMain.handle('clear-history', () => {
    if (syncHistory) syncHistory.clear();
    return true;
  });

  ipcMain.handle('set-password', (_e, password) => {
    encryptionPassword = password || '';
    return true;
  });

  ipcMain.handle('get-password-status', () => {
    return { enabled: encryptionPassword.length > 0 };
  });

  ipcMain.handle('set-device-name', (_e, name) => {
    if (discovery) {
      const oldName = discovery.getDeviceName();
      discovery.setDeviceName(name);
      if (syncClient) syncClient.setIdentity(discovery.getDeviceId(), name);
      const newName = discovery.getDeviceName();
      if (oldName !== newName) {
        _broadcastDeviceUpdate(newName);
      }
    }
    return true;
  });

  ipcMain.handle('get-device-info', () => {
    if (!discovery) return null;
    return {
      id: discovery.getDeviceId(),
      name: discovery.getDeviceName()
    };
  });

  ipcMain.handle('send-to-devices', (_e, targetDeviceIds) => {
    const text = require('electron').clipboard.readText();
    const image = require('electron').clipboard.readImage();
    let content = null;
    let type = 'text';

    if (!image.isEmpty()) {
      content = image.toDataURL();
      type = 'image';
    } else if (text) {
      content = text;
      type = 'text';
    }

    if (!content) return false;
    _doSyncSend(type, content, targetDeviceIds);
    return true;
  });

  ipcMain.handle('delete-history-item', (_e, id) => {
    if (syncHistory) syncHistory.removeById(id);
    return syncHistory.getAll();
  });

  ipcMain.handle('apply-clipboard', (_e, item) => {
    skipNextClipboard = true;
    if (item.type === 'text') {
      clipboardMonitor.setText(item.content);
    } else if (item.type === 'image') {
      clipboardMonitor.setImage(item.content);
    }
    return true;
  });

  ipcMain.handle('set-sync-targets', (_e, targetIds) => {
    syncTargetDeviceIds = targetIds;
    return true;
  });
}

function handleIncomingMessage(message, clientInfo) {
  let data;
  try {
    data = decrypt(message, encryptionPassword);
  } catch (e) {
    if (clientInfo && data?.messageId) {
      _sendAck(clientInfo, data.messageId, 'failed', '解密失败：密码不匹配');
    }
    return;
  }

  if (data.type === 'clipboard') {
    let applyStatus = 'delivered';
    let applyReason = null;

    try {
      if (data.contentType === 'text') {
        skipNextClipboard = true;
        clipboardMonitor.setText(data.content);
      } else if (data.contentType === 'image') {
        skipNextClipboard = true;
        clipboardMonitor.setImage(data.content);
      }
    } catch (e) {
      applyStatus = 'failed';
      applyReason = `写入剪贴板失败: ${e.message}`;
    }

    _sendAck(clientInfo, data.messageId, applyStatus, applyReason);

    const entry = syncHistory.add({
      type: data.contentType,
      content: data.content,
      direction: 'received',
      sourceDevice: data.sourceDeviceName,
      sourceDeviceId: data.sourceDeviceId,
      messageId: data.messageId,
      status: applyStatus,
      reason: applyReason
    });

    sendToRenderer('history-updated', syncHistory.getAll());
    sendToRenderer('clipboard-updated', entry);

  } else if (data.type === 'ack') {
    _handleAck(data);

  } else if (data.type === 'device-update') {
    _handleDeviceUpdate(data);
  }
}

function _handleAck(ackData) {
  const messageId = ackData.messageId;
  if (!messageId) return;

  for (const item of syncHistory.items) {
    if (item.messageId === messageId && item.direction === 'sent') {
      const deviceId = ackData.deviceId;
      const updated = syncHistory.updateTargetStatus(
        item.id,
        deviceId,
        ackData.status || 'delivered',
        ackData.reason || undefined
      );
      if (updated) {
        sendToRenderer('history-updated', syncHistory.getAll());
        return;
      }
    }
  }
}

app.whenReady().then(async () => {
  syncHistory = new SyncHistory();
  clipboardMonitor = new ClipboardMonitor();
  discovery = new DeviceDiscovery();
  syncServer = new SyncServer();
  syncClient = new SyncClient();

  syncClient.setIdentity(discovery.getDeviceId(), discovery.getDeviceName());

  setupIpc();
  createWindow();
  createTray();

  const actualPort = await syncServer.start();
  discovery.port = actualPort;

  syncServer.onMessage = (msg, clientInfo) => {
    handleIncomingMessage(msg, clientInfo);
  };

  syncClient.onMessage = (msg) => {
    handleIncomingMessage(msg, null);
  };

  clipboardMonitor.onText = (text) => {
    if (skipNextClipboard) {
      skipNextClipboard = false;
      return;
    }
    _doSyncSend('text', text, syncTargetDeviceIds);
  };

  clipboardMonitor.onImage = (dataUrl) => {
    if (skipNextClipboard) {
      skipNextClipboard = false;
      return;
    }
    _doSyncSend('image', dataUrl, syncTargetDeviceIds);
  };

  discovery.onDeviceOnline = (device) => {
    sendToRenderer('device-online', device);
    syncClient.connect(device.host, device.port);
  };

  discovery.onDeviceOffline = (device) => {
    sendToRenderer('device-offline', device);
    syncClient.disconnect(device.host, device.port);
  };

  discovery.onDeviceUpdated = (device) => {
    sendToRenderer('device-updated', device);
  };

  discovery.start();
  clipboardMonitor.start();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      mainWindow.show();
    }
  });
});

app.on('window-all-closed', () => {
  // keep running in tray
});
