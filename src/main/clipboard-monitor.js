const { clipboard, nativeImage } = require('electron');
const crypto = require('crypto');

const POLL_INTERVAL = 500;

class ClipboardMonitor {
  constructor() {
    this.intervalId = null;
    this.lastText = '';
    this.lastImageHash = '';
    this.lastImageFormat = 'png';
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
      const image = clipboard.readImage();
      const imageEmpty = image.isEmpty();
      const imageHash = imageEmpty ? '' : this._hashImage(image);

      const textChanged = text !== this.lastText && text.length > 0;
      const imageChanged = !imageEmpty && imageHash !== this.lastImageHash;

      if (imageChanged) {
        this.lastImageHash = imageHash;
        this.lastText = text;
        if (this.onImage) {
          this.onImage(image.toDataURL());
        }
        return;
      }

      if (textChanged) {
        this.lastText = text;
        if (this.onText) {
          this.onText(text);
        }
      }
    } catch (e) {
      // ignore clipboard errors
    }
  }

  _hashImage(image) {
    const size = image.getSize();
    const pngBuffer = image.toPNG();
    const dataHash = crypto.createHash('md5').update(pngBuffer).digest('hex').slice(0, 16);
    return `${size.width}x${size.height}-${pngBuffer.length}-${dataHash}`;
  }

  setText(text) {
    this.lastText = text;
    clipboard.writeText(text);
  }

  setImage(dataUrl) {
    const image = nativeImage.createFromDataURL(dataUrl);
    this.lastImageHash = this._hashImage(image);
    this.lastText = clipboard.readText() || '';
    clipboard.writeImage(image);
  }
}

module.exports = ClipboardMonitor;
