'use strict';
/* Note locking: the body is encrypted with AES-256-GCM under a key derived from a password with scrypt.
   The record on disk keeps only the ciphertext; plaintext lives in memory for the session once unlocked. */
const crypto = require('crypto');

const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function deriveKey(password, salt) {
  return crypto.scryptSync(String(password), salt, 32, SCRYPT);
}

// Encrypts plain under key. The salt is carried along so the same password keeps working.
function encrypt(plain, key, saltB64) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return { v: 1, kdf: 'scrypt', N: SCRYPT.N, salt: saltB64, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ct: ct.toString('base64') };
}

function decrypt(blob, key) {
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(blob.iv, 'base64'));
  d.setAuthTag(Buffer.from(blob.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(blob.ct, 'base64')), d.final()]).toString('utf8');
}

// New lock: fresh salt, derived key, encrypted body. Returns { blob, key }.
function lock(plain, password) {
  const salt = crypto.randomBytes(16);
  const key = deriveKey(password, salt);
  return { blob: encrypt(plain, key, salt.toString('base64')), key };
}

// Returns { body, key } or null when the password is wrong (or the data was tampered with).
function unlock(blob, password) {
  if (!blob) return null;
  const key = deriveKey(password, Buffer.from(blob.salt, 'base64'));
  try { return { body: decrypt(blob, key), key }; } catch (_) { return null; }
}

/** @returns {Lock | null} */
function sanitizeLock(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const ok = ['salt', 'iv', 'tag', 'ct'].every((k) => typeof raw[k] === 'string' && raw[k].length > 0);
  if (!ok) return null;
  return { v: 1, kdf: 'scrypt', N: Number.isFinite(raw.N) ? raw.N : SCRYPT.N, salt: raw.salt, iv: raw.iv, tag: raw.tag, ct: raw.ct };
}

module.exports = { lock, unlock, encrypt, decrypt, deriveKey, sanitizeLock };
