const crypto = require('crypto');

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function sign(payload, secret) {
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(crypto.createHmac('sha256', secret).update(body).digest());
  return `${body}.${sig}`;
}

function verify(token, secret) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) throw new Error('Invalid token');
  const expect = b64url(crypto.createHmac('sha256', secret).update(body).digest());
  if (expect !== sig) throw new Error('Bad signature');
  const payload = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  if (payload.exp && Date.now() > payload.exp) throw new Error('Token expired');
  return payload;
}

function createSetupToken({ userId, guildId = 'dm', provider = 'openrouter', scope = 'user', ttlMs = 10 * 60 * 1000 }) {
  const secret = process.env.PORTAL_SIGNING_SECRET;
  if (!secret) throw new Error('PORTAL_SIGNING_SECRET not set');
  const payload = { userId, guildId, provider, scope, iat: Date.now(), exp: Date.now() + ttlMs };
  return sign(payload, secret);
}

function verifySetupToken(token) {
  const secret = process.env.PORTAL_SIGNING_SECRET;
  if (!secret) throw new Error('PORTAL_SIGNING_SECRET not set');
  return verify(token, secret);
}

function createSetupLink(params) {
  const base = process.env.RAILWAY_STATIC_URL ||
               process.env.PORTAL_BASE_URL ||
               `http://localhost:${process.env.PORTAL_PORT || 8787}`;
  const token = createSetupToken(params);
  return `${base}/setup?token=${encodeURIComponent(token)}`;
}

module.exports = { createSetupLink, verifySetupToken };
