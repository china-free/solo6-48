const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const os = require('os');

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
    if (discovery) discovery.setDeviceName(name);
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

    const message = {
      type: 'clipboard',
      contentType: type,
      sourceDeviceId: discovery.getDeviceId(),
      sourceDeviceName: discovery.getDeviceName(),
      timestamp: Date.now()
    };

    const payload = encryptionPassword
      ? encrypt({ ...message, content }, encryptionPassword)
      : { encrypted: false, data: { ...message, content } };

    if (targetDeviceIds && targetDeviceIds.length > 0) {
      for (const deviceId of targetDeviceIds) {
        syncServer.sendToDevice(deviceId, payload);
      }
    } else {
      syncServer.broadcast(payload);
    }

    syncHistory.add({
      type,
      content,
      direction: 'sent',
      sourceDevice: discovery.getDeviceName()
    });

    sendToRenderer('history-updated', syncHistory.getAll());
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

function sendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

function handleIncomingClipboard(message, clientInfo) {
  let data;
  try {
    data = decrypt(message, encryptionPassword);
  } catch (e) {
    console.error('Decryption failed - password mismatch?');
    return;
  }

  if (data.type !== 'clipboard') return;

  if (data.contentType === 'text') {
    skipNextClipboard = true;
    clipboardMonitor.setText(data.content);
  } else if (data.contentType === 'image') {
    skipNextClipboard = true;
    clipboardMonitor.setImage(data.content);
  }

  const entry = syncHistory.add({
    type: data.contentType,
    content: data.content,
    direction: 'received',
    sourceDevice: data.sourceDeviceName
  });

  sendToRenderer('history-updated', syncHistory.getAll());
  sendToRenderer('clipboard-updated', entry);
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
    handleIncomingClipboard(msg, clientInfo);
  };

  syncClient.onMessage = (msg) => {
    handleIncomingClipboard(msg, null);
  };

  clipboardMonitor.onText = (text) => {
    if (skipNextClipboard) {
      skipNextClipboard = false;
      return;
    }
    const message = {
      type: 'clipboard',
      contentType: 'text',
      content: text,
      sourceDeviceId: discovery.getDeviceId(),
      sourceDeviceName: discovery.getDeviceName(),
      timestamp: Date.now()
    };

    const payload = encryptionPassword
      ? encrypt(message, encryptionPassword)
      : { encrypted: false, data: message };

    if (syncTargetDeviceIds && syncTargetDeviceIds.length > 0) {
      for (const deviceId of syncTargetDeviceIds) {
        syncServer.sendToDevice(deviceId, payload);
      }
    } else {
      syncServer.broadcast(payload);
    }

    syncHistory.add({
      type: 'text',
      content: text,
      direction: 'sent',
      sourceDevice: discovery.getDeviceName()
    });
    sendToRenderer('history-updated', syncHistory.getAll());
  };

  clipboardMonitor.onImage = (dataUrl) => {
    if (skipNextClipboard) {
      skipNextClipboard = false;
      return;
    }
    const message = {
      type: 'clipboard',
      contentType: 'image',
      content: dataUrl,
      sourceDeviceId: discovery.getDeviceId(),
      sourceDeviceName: discovery.getDeviceName(),
      timestamp: Date.now()
    };

    const payload = encryptionPassword
      ? encrypt(message, encryptionPassword)
      : { encrypted: false, data: message };

    if (syncTargetDeviceIds && syncTargetDeviceIds.length > 0) {
      for (const deviceId of syncTargetDeviceIds) {
        syncServer.sendToDevice(deviceId, payload);
      }
    } else {
      syncServer.broadcast(payload);
    }

    syncHistory.add({
      type: 'image',
      content: dataUrl,
      direction: 'sent',
      sourceDevice: discovery.getDeviceName()
    });
    sendToRenderer('history-updated', syncHistory.getAll());
  };

  discovery.onDeviceOnline = (device) => {
    sendToRenderer('device-online', device);
    syncClient.connect(device.host, device.port);
  };

  discovery.onDeviceOffline = (device) => {
    sendToRenderer('device-offline', device);
    syncClient.disconnect(device.host, device.port);
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
