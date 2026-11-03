import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

export const MAX_LAB_BYTES = 5 * 1024 * 1024;
export const hashSecret = value => createHash('sha256').update(value).digest();
export class LabError extends Error {
  constructor(code, status = 503) { super(code); this.code = code; this.status = status; }
}
const fail = code => { throw new LabError(code); };
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const time = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const shape = (value, fields) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === fields.length && fields.every(k => Object.hasOwn(value, k));
const empty = () => ({ version: 1, revision: 0, keys: [], audit: [] });
const metadata = ({ hash, ...key }) => key;

function validate(state) {
  if (!shape(state, ['version','revision','keys','audit']) || state.version !== 1 || !Array.isArray(state.keys) ||
      !Array.isArray(state.audit) || !Number.isSafeInteger(state.revision) || state.revision < 0) fail('KEY_STATE_CORRUPT');
  const keys = new Map(), hashes = new Set();
  for (const key of state.keys) {
    if (!shape(key, ['keyId','hash','status','createdAt','revokedAt']) || !uuid(key.keyId) || keys.has(key.keyId) ||
        typeof key.hash !== 'string' || !/^[0-9a-f]{64}$/.test(key.hash) || hashes.has(key.hash) || !time(key.createdAt) ||
        !['ACTIVE','REVOKED'].includes(key.status) || (key.status === 'ACTIVE' ? key.revokedAt !== null : !time(key.revokedAt))) fail('KEY_STATE_CORRUPT');
    keys.set(key.keyId, key); hashes.add(key.hash);
  }
  if (state.keys.filter(k => k.status === 'ACTIVE').length > 1) fail('KEY_STATE_CORRUPT');
  const replay = new Map(), audits = new Set(), actions = new Set();
  for (const a of state.audit) {
    if (!shape(a, ['auditId','actionId','requestId','timestamp','actor','action','keyId','result','beforeStatus','afterStatus','statusCode']) ||
        !uuid(a.auditId) || audits.has(a.auditId) || !uuid(a.actionId) || a.requestId !== a.actionId || actions.has(a.actionId) ||
        !time(a.timestamp) || !['ISSUE','REISSUE','REVOKE','VERIFY'].includes(a.action)) fail('LAB_AUDIT_CORRUPT');
    audits.add(a.auditId); actions.add(a.actionId);
    if (a.action === 'ISSUE' || a.action === 'REISSUE') {
      if (!uuid(a.keyId) || replay.has(a.keyId) || [...replay.values()].some(k => k.status === 'ACTIVE') ||
          (a.action === 'ISSUE' ? replay.size !== 0 : replay.size === 0) || a.actor !== 'local-operator' || a.result !== 'SUCCESS' ||
          a.beforeStatus !== null || a.afterStatus !== 'ACTIVE' || a.statusCode !== null) fail('LAB_AUDIT_CORRUPT');
      replay.set(a.keyId, { status: 'ACTIVE', createdAt: a.timestamp, revokedAt: null });
    } else if (a.action === 'REVOKE') {
      const key = replay.get(a.keyId);
      if (!key || key.status !== 'ACTIVE' || a.actor !== 'local-operator' || a.result !== 'SUCCESS' || a.beforeStatus !== 'ACTIVE' ||
          a.afterStatus !== 'REVOKED' || a.statusCode !== null) fail('LAB_AUDIT_CORRUPT');
      key.status = 'REVOKED'; key.revokedAt = a.timestamp;
    } else {
      const key = replay.get(a.keyId), status = key?.status ?? null;
      if (a.actor !== 'local-test-client' || (a.keyId !== null && !key) || a.beforeStatus !== status || a.afterStatus !== status ||
          a.statusCode !== (status === 'ACTIVE' ? 200 : 401) || a.result !== `HTTP_${a.statusCode}`) fail('LAB_AUDIT_CORRUPT');
    }
  }
  if (state.revision !== state.audit.length || replay.size !== keys.size) fail('LAB_AUDIT_CORRUPT');
  for (const [id, key] of keys) {
    const history = replay.get(id);
    if (!history || history.status !== key.status || history.createdAt !== key.createdAt || history.revokedAt !== key.revokedAt) fail('LAB_AUDIT_CORRUPT');
  }
}

// One process owns the file. Every authentication also commits its audit before replying.
export function createKeyStore({ file = fileURLToPath(new URL('./data/lab-state.json', import.meta.url)),
  maxBytes = MAX_LAB_BYTES, io = {} } = {}) {
  file = resolve(file);
  if(!Number.isSafeInteger(maxBytes)||maxBytes<1)throw Error('INVALID_LAB_LIMIT');
  const fs = { open, rename, unlink, ...io };
  let queue = Promise.resolve(), failure;
  const serial = fn => {
    const work = queue.then(async () => {
      if (failure) throw failure;
      try { return await fn(); }
      catch (err) {
        const safe = err instanceof LabError ? err : new LabError('KEY_STORE_UNAVAILABLE');
        if (safe.status === 503 && safe.code !== 'LAB_STORE_FULL') failure = safe;
        throw safe;
      }
    });
    queue = work.catch(() => {}); return work;
  };
  async function read() {
    const handle = await fs.open(file, 'r');
    let bytes;
    try {
      const info = await handle.stat();
      if (!info.isFile()) fail('KEY_STORE_UNAVAILABLE');
      if (info.size > maxBytes) fail('LAB_STORE_FULL');
      bytes = Buffer.alloc(maxBytes + 1); let size = 0;
      while (size < bytes.length) {
        const { bytesRead } = await handle.read(bytes, size, bytes.length - size, null);
        if (!bytesRead) break; size += bytesRead;
      }
      bytes = bytes.subarray(0, size);
    } finally { await handle.close(); }
    if (bytes.length > maxBytes) fail('LAB_STORE_FULL');
    let state;
    try { state = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { fail('KEY_STATE_CORRUPT'); }
    validate(state); return state;
  }
  async function commit(state) {
    validate(state);
    const bytes = Buffer.from(JSON.stringify(state) + '\n');
    if (bytes.length > maxBytes) fail('LAB_STORE_FULL');
    const temporary = resolve(dirname(file), `.lab-state-${randomUUID()}.tmp`);
    let replaced = false, renameStarted = false;
    try {
      const handle = await fs.open(temporary, 'wx', 0o600);
      try { await handle.writeFile(bytes); await handle.sync(); }
      finally { await handle.close(); }
      renameStarted = true; await fs.rename(temporary, file); replaced = true;
      if (process.platform !== 'win32') {
        const directory = await fs.open(dirname(file), 'r');
        try { await directory.sync(); } finally { await directory.close(); }
      }
    } catch { throw new LabError(renameStarted ? 'LAB_COMMIT_UNCERTAIN' : 'LAB_TRANSACTION_FAILED'); }
    finally { if (!replaced) await fs.unlink(temporary).catch(() => {}); }
  }
  const addAudit = (state, action, key, beforeStatus, statusCode = null) => {
    const actionId = randomUUID();
    const audit = { auditId: randomUUID(), actionId, requestId: actionId, timestamp: new Date().toISOString(),
      actor: action === 'VERIFY' ? 'local-test-client' : 'local-operator', action, keyId: key?.keyId ?? null,
      result: action === 'VERIFY' ? `HTTP_${statusCode}` : 'SUCCESS', beforeStatus,
      afterStatus: key?.status ?? null, statusCode };
    state.audit.push(audit); state.revision++; return audit;
  };
  return {
    async initialize() {
      try { await serial(async () => {
        await mkdir(dirname(file), { recursive: true });
        try {
          const handle = await fs.open(file, 'wx', 0o600);
          try { await handle.writeFile(JSON.stringify(empty()) + '\n'); await handle.sync(); }
          finally { await handle.close(); }
        } catch (err) { if (err.code !== 'EEXIST') throw err; }
        await read();
      }); } catch { /* Keep the file; lab API reports a safe error. */ }
    },
    status: () => serial(async () => {
      const state = await read();
      return { keys: state.keys.map(metadata), activeKeyId: state.keys.find(k => k.status === 'ACTIVE')?.keyId ?? null,
        revision: state.revision, scope: 'local-lab' };
    }),
    audit: limit => serial(async () => {
      const state = await read(); const audit = state.audit.slice(-limit).reverse();
      return { audit, count: audit.length, limit, revision: state.revision, scope: 'local-lab' };
    }),
    issue: () => serial(async () => {
      const state = await read();
      if (state.keys.some(k => k.status === 'ACTIVE')) throw new LabError('ACTIVE_KEY_EXISTS', 409);
      let token, hash;
      do { token = `kg-lab-${randomBytes(32).toString('base64url')}`; hash = hashSecret(token).toString('hex'); }
      while (state.keys.some(k => k.hash === hash));
      const key = { keyId: randomUUID(), hash, status: 'ACTIVE', createdAt: new Date().toISOString(), revokedAt: null };
      const audit = addAudit(state, state.keys.length ? 'REISSUE' : 'ISSUE', key, null);
      key.createdAt = audit.timestamp; state.keys.push(key);
      await commit(state);
      return { key: metadata(key), token, actionId: audit.actionId, auditId: audit.auditId };
    }),
    revoke: keyId => serial(async () => {
      const state = await read(), key = state.keys.find(k => k.keyId === keyId);
      if (!key) throw new LabError('KEY_NOT_FOUND', 404);
      if (key.status === 'REVOKED') throw new LabError('KEY_ALREADY_REVOKED', 409);
      key.status = 'REVOKED'; const audit = addAudit(state, 'REVOKE', key, 'ACTIVE'); key.revokedAt = audit.timestamp;
      await commit(state);
      return { key: metadata(key), actionId: audit.actionId, auditId: audit.auditId };
    }),
    verify: token => serial(async () => {
      const state = await read(), digest = hashSecret(typeof token === 'string' && token.length <= 256 ? token : '');
      let key;
      for (const candidate of state.keys) {
        if (timingSafeEqual(Buffer.from(candidate.hash, 'hex'), digest)) key = candidate;
      }
      const statusCode = key?.status === 'ACTIVE' ? 200 : 401;
      const audit = addAudit(state, 'VERIFY', key, key?.status ?? null, statusCode);
      await commit(state);
      return { statusCode, outcome: statusCode === 200 ? 'success' : 'failure', keyId: key?.keyId ?? null,
        verificationId: audit.actionId, auditId: audit.auditId };
    }),
  };
}
