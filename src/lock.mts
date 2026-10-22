import crypto from 'node:crypto';
import { isObjectLike } from './shared/helpers.mts';

const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.scryptSync(String(password), salt, 32, SCRYPT);
}

function encrypt(plain: string, key: Buffer, saltB64: string): NoteLock {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return { v: 1, kdf: 'scrypt', N: SCRYPT.N, salt: saltB64, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ct: ct.toString('base64') };
}

function decrypt(blob: NoteLock, key: Buffer): string {
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(blob.iv, 'base64'));
  d.setAuthTag(Buffer.from(blob.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(blob.ct, 'base64')), d.final()]).toString('utf8');
}

function lock(plain: string, password: string): { blob: NoteLock, key: Buffer } {
  const salt = crypto.randomBytes(16);
  const key = deriveKey(password, salt);
  return { blob: encrypt(plain, key, salt.toString('base64')), key };
}

function unlock(blob: NoteLock | null, password: string): { body: string, key: Buffer } | null {
  if (!blob) return null;
  const key = deriveKey(password, Buffer.from(blob.salt, 'base64'));
  try { return { body: decrypt(blob, key), key }; } catch (_) { return null; }
}

function sanitizeLock(raw: unknown): NoteLock | null {
  if (!isObjectLike(raw)) return null;
  const { salt, iv, tag, ct, N } = raw;
  if (typeof salt !== 'string' || !salt || typeof iv !== 'string' || !iv || typeof tag !== 'string' || !tag || typeof ct !== 'string' || !ct) return null;
  return { v: 1, kdf: 'scrypt', N: typeof N === 'number' && Number.isFinite(N) ? N : SCRYPT.N, salt, iv, tag, ct };
}

export { lock, unlock, encrypt, decrypt, deriveKey, sanitizeLock };
