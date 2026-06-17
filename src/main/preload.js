const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('clipSync', {
  getDevices: () => ipcRenderer.invoke('get-devices'),
  getHistory: () => ipcRenderer.invoke('get-history'),
  clearHistory: () => ipcRenderer.invoke('clear-history'),
  setPassword: (password) => ipcRenderer.invoke('set-password', password),
  getPasswordStatus: () => ipcRenderer.invoke('get-password-status'),
  setDeviceName: (name) => ipcRenderer.invoke('set-device-name', name),
  getDeviceInfo: () => ipcRenderer.invoke('get-device-info'),
  sendToDevices: (targetDeviceIds) => ipcRenderer.invoke('send-to-devices', targetDeviceIds),
  deleteHistoryItem: (id) => ipcRenderer.invoke('delete-history-item', id),
  applyClipboard: (item) => ipcRenderer.invoke('apply-clipboard', item),
  setSyncTargets: (targetIds) => ipcRenderer.invoke('set-sync-targets', targetIds),

  onDeviceOnline: (callback) => ipcRenderer.on('device-online', (_e, data) => callback(data)),
  onDeviceOffline: (callback) => ipcRenderer.on('device-offline', (_e, data) => callback(data)),
  onHistoryUpdated: (callback) => ipcRenderer.on('history-updated', (_e, data) => callback(data)),
  onClipboardUpdated: (callback) => ipcRenderer.on('clipboard-updated', (_e, data) => callback(data))
});
