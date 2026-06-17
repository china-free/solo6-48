const crypto = require('crypto');

const ALGORITHM = 'aes-256-cbc';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;

function deriveKey(password) {
  return crypto.scryptSync(password, 'clip-sync-salt', KEY_LENGTH);
}

function encrypt(data, password) {
  if (!password) return { encrypted: false, data };
  const key = deriveKey(password);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const jsonStr = JSON.stringify(data);
  let encrypted = cipher.update(jsonStr, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  return {
    encrypted: true,
    iv: iv.toString('base64'),
    data: encrypted
  };
}

function decrypt(payload, password) {
  if (!payload.encrypted) return payload.data;
  const key = deriveKey(password);
  const iv = Buffer.from(payload.iv, 'base64');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  let decrypted = decipher.update(payload.data, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return JSON.parse(decrypted);
}

module.exports = { encrypt, decrypt };
