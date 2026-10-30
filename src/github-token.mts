import fs from 'node:fs';
import path from 'node:path';
import { isRecord } from './shared/helpers.mts';

type Safe = { isEncryptionAvailable: () => boolean, encryptString: (text: string) => Buffer, decryptString: (data: Buffer) => string };
type SignIn = { token: string, login: string };
type KeepResult = { ok: true } | { ok: false, error: string };

const CANNOT_KEEP = 'Windows could not protect the sign-in on this PC, so Notes did not keep it.';

class TokenStore {
  file: string;
  safe: Safe;

  constructor(file: string, safe: Safe) {
    this.file = file;
    this.safe = safe;
  }

  canKeep() {
    try { return this.safe.isEncryptionAvailable(); } catch (_) { return false; }
  }

  read(): SignIn | null {
    let data: Buffer;
    try { data = fs.readFileSync(this.file); } catch (_) { return null; }
    let text: string;
    try { text = this.safe.decryptString(data); } catch (_) { return null; }
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch (_) { return null; }
    if (!isRecord(parsed) || typeof parsed.token !== 'string' || typeof parsed.login !== 'string' || !parsed.token) return null;
    return { token: parsed.token, login: parsed.login };
  }

  write(signIn: SignIn): KeepResult {
    if (!this.canKeep()) return { ok: false, error: CANNOT_KEEP };
    let data: Buffer;
    try { data = this.safe.encryptString(JSON.stringify(signIn)); } catch (_) { return { ok: false, error: CANNOT_KEEP }; }
    const tmp = this.file + '.tmp';
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(tmp, data);
      fs.renameSync(tmp, this.file);
    } catch (err) {
      fs.rmSync(tmp, { force: true });
      return { ok: false, error: 'Notes could not save the sign-in: ' + (err instanceof Error ? err.message : String(err)) };
    }
    return { ok: true };
  }

  clear() {
    fs.rmSync(this.file, { force: true });
  }
}

export type { Safe, SignIn, KeepResult };
export { TokenStore, CANNOT_KEEP };
