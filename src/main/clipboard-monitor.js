const { clipboard, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

const POLL_INTERVAL = 500;

class ClipboardMonitor {
  constructor() {
    this.intervalId = null;
    this.lastText = '';
    this.lastImageHash = '';
    this.onText = null;
    this.onImage = null;
    this._running = false;
  }

  start() {
    if (this._running) return;
    this._running = true;
    this.lastText = clipboard.readText() || '';
    const currentImage = clipboard.readImage();
    this.lastImageHash = currentImage.isEmpty() ? '' : this._hashImage(currentImage);

    this.intervalId = setInterval(() => this._poll(), POLL_INTERVAL);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this._running = false;
  }

  _poll() {
    try {
      const text = clipboard.readText() || '';
      if (text !== this.lastText && text.length > 0) {
        this.lastText = text;
        const image = clipboard.readImage();
        if (!image.isEmpty()) {
          const hash = this._hashImage(image);
          if (hash !== this.lastImageHash) {
            this.lastImageHash = hash;
            if (this.onImage) {
              this.onImage(image.toDataURL());
            }
          }
        } else {
          if (this.onText) {
            this.onText(text);
          }
        }
      } else {
        const image = clipboard.readImage();
        if (!image.isEmpty()) {
          const hash = this._hashImage(image);
          if (hash !== this.lastImageHash) {
            this.lastImageHash = hash;
            this.lastText = text;
            if (this.onImage) {
              this.onImage(image.toDataURL());
            }
          }
        }
      }
    } catch (e) {
      // ignore clipboard errors
    }
  }

  _hashImage(image) {
    const size = image.getSize();
    return `${size.width}x${size.height}`;
  }

  setText(text) {
    this.lastText = text;
    clipboard.writeText(text);
  }

  setImage(dataUrl) {
    const image = nativeImage.createFromDataURL(dataUrl);
    this.lastImageHash = this._hashImage(image);
    clipboard.writeImage(image);
  }
}

module.exports = ClipboardMonitor;
