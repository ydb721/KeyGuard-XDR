import { mkdir, open, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

export const MAX_STORE_BYTES = 5 * 1024 * 1024;
const defaultFile = fileURLToPath(new URL('./data/events.jsonl', import.meta.url));
const keys = ['eventId', 'timestamp', 'source', 'eventType', 'method', 'path', 'statusCode', 'outcome', 'assetId'];
export class StoreError extends Error {
  constructor(code = 'EVENT_STORE_UNAVAILABLE') { super(code); this.code = code; }
}
const corrupt = () => { throw new StoreError('EVENT_STORE_CORRUPT'); };
function validate(event, ids) {
  if (!event || typeof event !== 'object' || Array.isArray(event) ||
      Object.keys(event).length !== keys.length || keys.some(k => !Object.hasOwn(event, k))) corrupt();
  if (typeof event.eventId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(event.eventId) || ids.has(event.eventId)) corrupt();
  if (typeof event.timestamp !== 'string' || !Number.isFinite(Date.parse(event.timestamp)) ||
      new Date(event.timestamp).toISOString() !== event.timestamp) corrupt();
  const success = event.statusCode === 200;
  if (![200, 401].includes(event.statusCode) || event.source !== 'local-http' || event.method !== 'GET' ||
      event.path !== '/api/test/resource' || event.assetId !== 'demo-test-resource' ||
      event.eventType !== (success ? 'authentication_success' : 'authentication_failure') ||
      event.outcome !== (success ? 'success' : 'failure')) corrupt();
  ids.add(event.eventId);
}

// Single-process ownership; reads and writes share a serial queue.
export function createEventStore({ file = defaultFile, maxBytes = MAX_STORE_BYTES, openFile = open } = {}) {
  file = resolve(file);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw Error('INVALID_STORE_LIMIT');
  let queue = Promise.resolve(), failure;
  const serial = fn => {
    const job = queue.then(async () => {
      if (failure) throw failure;
      try { return await fn(); }
      catch (err) {
        const safe = err instanceof StoreError ? err : new StoreError();
        if (safe.code !== 'EVENT_STORE_FULL') failure = safe;
        throw safe;
      }
    });
    queue = job.catch(() => {});
    return job;
  };
  async function read() {
    const info = await stat(file);
    if (!info.isFile()) throw new StoreError();
    if (info.size > maxBytes) throw new StoreError('EVENT_STORE_FULL');
    const handle = await openFile(file, 'r');
    let bytes;
    try {
      bytes = Buffer.alloc(maxBytes + 1);
      let count = 0;
      while (count < bytes.length) {
        const result = await handle.read(bytes, count, bytes.length - count, null);
        if (!result.bytesRead) break;
        count += result.bytesRead;
      }
      bytes = bytes.subarray(0, count);
    } finally { await handle.close(); }
    if (bytes.length > maxBytes) throw new StoreError('EVENT_STORE_FULL');
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { corrupt(); }
    if (text && !text.endsWith('\n')) corrupt();
    const events = [], ids = new Set();
    for (const line of text ? text.slice(0, -1).split('\n') : []) {
      let event;
      try { event = JSON.parse(line); } catch { corrupt(); }
      validate(event, ids);
      events.push(event);
    }
    return { events, ids, size: bytes.length };
  }
  return {
    async initialize() {
      try {
        await serial(async () => {
          await mkdir(dirname(file), { recursive: true });
          try { const handle = await openFile(file, 'wx'); await handle.close(); }
          catch (err) { if (err.code !== 'EEXIST') throw err; }
          await read();
        });
      } catch { /* API reports failure; existing file is never reset. */ }
    },
    check: () => serial(async () => { await read(); }),
    list: limit => serial(async () => (await read()).events.slice(-limit).reverse()),
    record: statusCode => serial(async () => {
      const { ids, size } = await read();
      let eventId;
      do { eventId = randomUUID(); } while (ids.has(eventId));
      const success = statusCode === 200;
      const event = { eventId, timestamp: new Date().toISOString(), source: 'local-http',
        eventType: success ? 'authentication_success' : 'authentication_failure',
        method: 'GET', path: '/api/test/resource', statusCode,
        outcome: success ? 'success' : 'failure', assetId: 'demo-test-resource' };
      validate(event, ids);
      const line = JSON.stringify(event) + '\n';
      if (size + Buffer.byteLength(line) > maxBytes) throw new StoreError('EVENT_STORE_FULL');
      // r+ never recreates a missing file; positional writes preserve existing bytes.
      const handle = await openFile(file, 'r+');
      try {
        const buffer = Buffer.from(line);
        let offset = 0;
        while (offset < buffer.length) {
          const result = await handle.write(buffer, offset, buffer.length - offset, size + offset);
          if (!result.bytesWritten) throw new StoreError();
          offset += result.bytesWritten;
        }
        await handle.sync();
      } finally { await handle.close(); }
      return event;
    }),
  };
}
