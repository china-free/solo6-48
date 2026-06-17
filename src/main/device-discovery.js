const Bonjour = require('bonjour-service');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

const SERVICE_TYPE = 'clip-sync';
const SERVICE_PORT = 9876;

class DeviceDiscovery {
  constructor(port) {
    this.port = port || SERVICE_PORT;
    this.bonjour = new Bonjour();
    this.service = null;
    this.browser = null;
    this.devices = new Map();
    this.deviceId = uuidv4();
    this.deviceName = os.hostname();
    this.onDeviceOnline = null;
    this.onDeviceOffline = null;
  }

  start() {
    this.service = this.bonjour.publish({
      name: `${this.deviceName}-${this.deviceId.slice(0, 8)}`,
      type: SERVICE_TYPE,
      port: this.port,
      txt: {
        deviceid: this.deviceId,
        devicename: this.deviceName
      }
    });

    this.browser = this.bonjour.find({ type: SERVICE_TYPE }, (service) => {
      this._handleServiceUp(service);
    });

    this.browser.on('down', (service) => {
      this._handleServiceDown(service);
    });
  }

  _handleServiceUp(service) {
    if (!service.txt || !service.txt.deviceid) return;
    if (service.txt.deviceid === this.deviceId) return;

    const addresses = service.addresses || [];
    const ipv4 = addresses.find(a => /^\d+\.\d+\.\d+\.\d+$/.test(a)) || addresses[0] || '0.0.0.0';

    const device = {
      id: service.txt.deviceid,
      name: service.txt.devicename || service.name,
      host: ipv4,
      port: service.port,
      online: true,
      lastSeen: Date.now()
    };

    const isNew = !this.devices.has(device.id);
    this.devices.set(device.id, device);

    if (isNew && this.onDeviceOnline) {
      this.onDeviceOnline(device);
    }
  }

  _handleServiceDown(service) {
    if (!service.txt || !service.txt.deviceid) return;
    const deviceId = service.txt.deviceid;
    if (deviceId === this.deviceId) return;

    const device = this.devices.get(deviceId);
    if (device) {
      device.online = false;
      if (this.onDeviceOffline) {
        this.onDeviceOffline(device);
      }
    }
  }

  getDevices() {
    return Array.from(this.devices.values());
  }

  getDeviceId() {
    return this.deviceId;
  }

  getDeviceName() {
    return this.deviceName;
  }

  setDeviceName(name) {
    this.deviceName = name;
  }

  stop() {
    if (this.service) {
      this.service.stop();
    }
    if (this.browser) {
      this.browser.stop();
    }
    this.bonjour.destroy();
  }
}

module.exports = DeviceDiscovery;
