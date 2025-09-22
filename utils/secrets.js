const crypto = require('crypto');

const PREFIX = 'enc:v1:';

function getKey() {
  const sec = process.env.SECRETS_KEY;
  if (!sec) return null;
  // Support base64 32 bytes or passphrase-derived
  if (/^[A-Za-z0-9+/=]{43,44}$/.test(sec)) {
    try { return Buffer.from(sec, 'base64'); } catch {}
  }
  return crypto.createHash('sha256').update(sec).digest();
}

function encryptIfPossible(plain) {
  const key = getKey();
  if (!key || !plain) return plain;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const packed = Buffer.concat([iv, tag, enc]).toString('base64');
  return PREFIX + packed;
}

function decryptIfPossible(value) {
  if (typeof value !== 'string' || !value.startsWith(PREFIX)) return value;
  const key = getKey();
  if (!key) return value;
  const packed = Buffer.from(value.slice(PREFIX.length), 'base64');
  const iv = packed.subarray(0, 12);
  const tag = packed.subarray(12, 28);
  const enc = packed.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString('utf8');
}

function maskKey(k) {
  if (!k || typeof k !== 'string') return '';
  const s = k.replace(/^enc:v1:/, '');
  return s.length <= 8 ? '****' : `${s.slice(0, 4)}…${s.slice(-4)}`;
}

module.exports = { encryptIfPossible, decryptIfPossible, maskKey };
