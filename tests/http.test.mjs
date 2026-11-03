import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile, mkdir, rm, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createLocalServer, DEMO_TOKEN } from '../server.mjs';
import { createEventStore, MAX_STORE_BYTES } from '../event-store.mjs';

const auth = { Authorization: `Bearer ${DEMO_TOKEN}` };
function request(port, path = '/api/health', headers = {}, method = 'GET') {
  assert.ok(Number.isSafeInteger(port) && port > 0 && port <= 65535, 'INVALID_TEST_PORT');
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path, headers, method }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text,
        body: res.headers['content-type']?.includes('application/json') && text ? JSON.parse(text) : null }));
    });
    req.on('error', reject); req.end();
  });
}
async function fixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'keyguard-http-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'events.jsonl');
  if (options.content !== undefined) await writeFile(file, options.content);
  if (options.directory) await mkdir(file);
  const server = await createLocalServer({ store: createEventStore({ file, maxBytes: options.maxBytes, openFile: options.openFile }) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port;
  return { dir, file, server, port, get: (path, headers, method) => request(port, path, headers, method) };
}

test('HTTP 200/401 match exactly one persisted event each; credentials never persisted', async t => {
  const f = await fixture(t);
  assert.equal((await f.get('/api/health')).status, 200);
  assert.equal((await f.get('/api/events')).body.count, 0);
  const responses = [];
  for (const headers of [auth, {}, { Authorization: 'Bearer sim-wrong-private-marker' }]) {
    responses.push(await f.get('/api/test/resource', headers));
  }
  assert.deepEqual(responses.map(r => r.status), [200, 401, 401]);
  const disk = await readFile(f.file, 'utf8');
  const events = disk.trim().split('\n').map(JSON.parse);
  assert.equal(events.length, 3);
  events.forEach((e, i) => {
    assert.deepEqual(Object.keys(e).sort(), ['eventId','timestamp','source','eventType','method','path','statusCode','outcome','assetId'].sort());
    assert.equal(e.eventId, responses[i].body.eventId);
    assert.equal(e.statusCode, responses[i].status);
    assert.equal(e.outcome, i === 0 ? 'success' : 'failure');
    assert.equal(e.eventType, i === 0 ? 'authentication_success' : 'authentication_failure');
    assert.equal(new Date(e.timestamp).toISOString(), e.timestamp);
    assert.match(e.eventId, /^[0-9a-f-]{36}$/);
  });
  const listed = await f.get('/api/events?limit=2');
  assert.deepEqual(listed.body.events, events.slice(-2).reverse());
  assert.equal(listed.headers['cache-control'], 'no-store');
  assert.equal(listed.headers['access-control-allow-origin'], undefined);
  const observable = disk + JSON.stringify(responses) + listed.text;
  for (const secret of [DEMO_TOKEN, 'sim-wrong-private-marker', 'Authorization']) assert.ok(!observable.includes(secret));
  assert.equal((await f.get('/api/events')).body.count, 3);
});

test('concurrent HTTP requests persist once each and return unique IDs', async t => {
  const f = await fixture(t);
  const responses = await Promise.all(Array.from({ length: 32 }, (_, i) => f.get('/api/test/resource', i % 2 ? auth : {})));
  assert.equal(responses.filter(r => r.status === 200).length, 16);
  assert.equal(responses.filter(r => r.status === 401).length, 16);
  const events = (await f.get('/api/events?limit=100')).body.events;
  assert.equal(events.length, 32);
  assert.equal(new Set(events.map(e => e.eventId)).size, 32);
  assert.deepEqual(new Set(events.map(e => e.eventId)), new Set(responses.map(r => r.body.eventId)));
  assert.equal((await readFile(f.file, 'utf8')).trim().split('\n').length, 32);
});

test('event query default, boundaries and invalid values', async t => {
  const f = await fixture(t);
  for (const query of ['', '?limit=1', '?limit=100']) {
    const r = await f.get('/api/events' + query); assert.equal(r.status, 200); assert.deepEqual(r.body.events, []);
  }
  assert.equal((await f.get('/api/events')).body.limit, 50);
  for (const query of ['limit=', 'limit=0', 'limit=-1', 'limit=101', 'limit=1.2', 'limit=abc', 'limit=1&limit=2', 'other=1', 'limit=999999999999999999']) {
    assert.equal((await f.get('/api/events?' + query)).status, 400, query);
  }
});

test('Host, Origin, methods, paths and static GET/HEAD remain restricted', async t => {
  const f = await fixture(t);
  assert.equal(f.server.address().address, '127.0.0.1');
  for (const host of ['evil.example', `evil.example:${f.port}`, `127.0.0.1:${f.port + 1}`]) assert.equal((await f.get('/api/events', { Host: host })).status, 403);
  for (const origin of ['https://evil.example', 'null', 'http://localhost:1']) assert.equal((await f.get('/api/events', { Origin: origin })).status, 403);
  assert.equal((await f.get('/api/events', { Origin: `http://localhost:${f.port}`, Host: `localhost:${f.port}` })).status, 200);
  for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS', 'HEAD']) assert.equal((await f.get('/api/test/resource', auth, method)).status, 405);
  for (const path of ['/missing', '/data/events.jsonl', '/server.mjs', '/.env']) assert.equal((await f.get(path)).status, 404);
  for (const path of ['/%2e%2e/server.mjs', '/../server.mjs', '//evil.example/', '/api/test/resource?token=secret']) assert.equal((await f.get(path)).status, 400);
  for (const path of ['/', '/index.html', '/styles.css', '/app.js']) {
    const r = await f.get(path); assert.equal(r.status, 200);
    assert.match(r.headers['content-security-policy'], /connect-src 'none'/);
    const head = await f.get(path, {}, 'HEAD'); assert.equal(head.status, 200); assert.equal(head.text, '');
  }
  assert.equal((await f.get('/api/events')).body.count, 0);
});

test('store initialization filesystem failure returns 503 without resetting contents', async t => {
  const f = await fixture(t, { directory: true });
  for (const path of ['/api/health', '/api/events', '/api/test/resource']) assert.equal((await f.get(path, auth)).status, 503);
  assert.equal((await f.get('/')).status, 200);
});

test('runtime write failure cannot return authenticated success and preserves old data', async t => {
  const f = await fixture(t);
  assert.equal((await f.get('/api/test/resource', auth)).status, 200);
  const old = await readFile(f.file);
  // A read-only file descriptor failure is platform-dependent; replace its path with a directory deterministically.
  const backup = join(f.dir, 'preserved.jsonl');
  const { rename } = await import('node:fs/promises');
  await rename(f.file, backup); await mkdir(f.file);
  const r = await f.get('/api/test/resource', auth);
  assert.equal(r.status, 503); assert.equal(r.body.error.code, 'EVENT_STORE_UNAVAILABLE');
  assert.deepEqual(await readFile(backup), old);
  assert.ok(!r.text.includes(DEMO_TOKEN));
});

test('malformed JSONL, duplicate IDs, missing fields and invalid encoding fail closed', async t => {
  const valid = await fixture(t); await valid.get('/api/test/resource', auth);
  const line = await readFile(valid.file, 'utf8');
  const missing = JSON.parse(line); delete missing.assetId;
  for (const content of ['not-json\n', line + line, JSON.stringify(missing) + '\n', line.trimEnd(), Buffer.from([0xff, 10])]) {
    const f = await fixture(t, { content });
    for (const path of ['/api/health', '/api/events', '/api/test/resource']) {
      const r = await f.get(path, auth); assert.equal(r.status, 503); assert.equal(r.body.error.code, 'EVENT_STORE_CORRUPT');
    }
    assert.deepEqual(await readFile(f.file), Buffer.from(content));
  }
});

test('runtime corruption is detected before another append', async t => {
  const f = await fixture(t); await f.get('/api/test/resource', auth);
  const broken = (await readFile(f.file, 'utf8')) + '{broken\n';
  await writeFile(f.file, broken);
  assert.equal((await f.get('/api/test/resource', auth)).status, 503);
  assert.equal(await readFile(f.file, 'utf8'), broken);
});

test('append and sync errors return 503, preserve prior bytes and poison further writes', async t => {
  const seed = await fixture(t); await seed.get('/api/test/resource', auth);
  const original = await readFile(seed.file);
  for (const mode of ['open', 'partial', 'sync']) {
    let attempts = 0;
    const f = await fixture(t, { content: original, openFile: async (file, flags) => {
      if (flags !== 'r+') return open(file, flags);
      attempts++;
      const fail = () => { throw Error(`Authorization ${DEMO_TOKEN}`); };
      if (mode === 'open') fail();
      const handle = await open(file, flags);
      return {
        write: async (buffer, offset, length, position) => {
          if (mode === 'partial') { await handle.write(buffer, offset, 7, position); fail(); }
          return handle.write(buffer, offset, length, position);
        },
        sync: mode === 'sync' ? fail : () => handle.sync(),
        close: () => handle.close(),
      };
    } });
    for (let i = 0; i < 2; i++) {
      const r = await f.get('/api/test/resource', auth);
      assert.equal(r.status, 503); assert.equal(r.body.error.code, 'EVENT_STORE_UNAVAILABLE');
      assert.ok(!r.text.includes(DEMO_TOKEN)); assert.ok(!r.text.includes('Authorization'));
    }
    assert.equal(attempts, 1);
    const after = await readFile(f.file);
    assert.deepEqual(after.subarray(0, original.length), original);
    if (mode === 'open') assert.deepEqual(after, original);
    assert.equal((await f.get('/api/health')).status, 503);
  }
});

test('capacity boundary and oversized existing files preserve every byte', async t => {
  assert.equal(MAX_STORE_BYTES, 5 * 1024 * 1024);
  const reference = await fixture(t); await reference.get('/api/test/resource', auth);
  const line = await readFile(reference.file, 'utf8');
  const bytes = Buffer.byteLength(line);
  const exact = await fixture(t, { maxBytes: bytes });
  assert.equal((await exact.get('/api/test/resource', auth)).status, 200);
  const before = await readFile(exact.file);
  for (const headers of [auth, {}]) {
    const r = await exact.get('/api/test/resource', headers); assert.equal(r.status, 503); assert.equal(r.body.error.code, 'EVENT_STORE_FULL');
  }
  assert.deepEqual(await readFile(exact.file), before);
  assert.equal((await exact.get('/api/events')).body.count, 1);
  const oversized = await fixture(t, { content: line, maxBytes: bytes - 1 });
  assert.equal((await oversized.get('/api/health')).status, 503);
  assert.equal(await readFile(oversized.file, 'utf8'), line);
});

test('separate server processes preserve events across restart without logging credentials', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'keyguard-restart-'));
  const processes = [];
  t.after(async () => {
    try { await Promise.all(processes.map(process => process.stop())); }
    finally { await rm(dir, { recursive: true, force: true }); }
  });
  const file = join(dir, 'events.jsonl');
  let logs = '';
  async function start() {
    const code = `
      import {createLocalServer} from './server.mjs';
      import {createEventStore} from './event-store.mjs';
      // Regression: blank/non-port stdout must never select HTTP's default port.
      process.stdout.write('\\n');
      console.log('test worker starting');
      const server = await createLocalServer({store:createEventStore({file:process.env.KG_TEST_FILE})});
      process.on('message', message => {
        if (message?.type === 'stop') server.close(() => process.disconnect());
      });
      server.listen(0, '127.0.0.1', () => {
        process.send({type:'ready', port:server.address().port});
      });
    `;
    const child = spawn(process.execPath, ['--input-type=module', '-e', code], {
      cwd: new URL('..', import.meta.url),
      env: { ...process.env, KG_TEST_FILE: file },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true,
    });
    let closed = false, stopPromise;
    const completion = new Promise(resolve => child.once('close', (exitCode, signal) => {
      closed = true; resolve({ exitCode, signal });
    }));
    const stop = () => {
      if (stopPromise) return stopPromise;
      stopPromise = (async () => {
        if (closed) return completion;
        const timer = setTimeout(() => child.kill(), 5000);
        try {
          if (child.connected) child.send({ type: 'stop' }, err => { if (err) child.kill(); });
          else child.kill();
          return await completion;
        } finally { clearTimeout(timer); }
      })();
      return stopPromise;
    };
    processes.push({ stop });
    child.stdout.on('data', b => { logs += b; });
    child.stderr.on('data', b => { logs += b; });
    const port = await new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        child.off('message', onMessage); child.off('error', onError); child.off('exit', onExit);
      };
      const onError = err => { cleanup(); reject(err); };
      const onExit = () => onError(Error('SERVER_EXITED_BEFORE_READY'));
      const onMessage = message => {
        if (message?.type !== 'ready') return;
        if (!Number.isSafeInteger(message.port) || message.port < 1 || message.port > 65535) {
          return onError(Error('INVALID_CHILD_PORT'));
        }
        cleanup(); resolve(message.port);
      };
      const timer = setTimeout(() => onError(Error('SERVER_READY_TIMEOUT')), 10000);
      child.on('message', onMessage); child.once('error', onError); child.once('exit', onExit);
    });
    const health = await request(port);
    assert.equal(health.status, 200);
    assert.equal(health.body.status, 'ok');
    return { port, stop };
  }
  const first = await start();
  const a = await request(first.port, '/api/test/resource', auth); assert.equal(a.status, 200);
  await request(first.port, '/api/test/resource', { Authorization: 'Bearer sim-wrong-private-marker' });
  assert.deepEqual(await first.stop(), { exitCode: 0, signal: null });
  const second = await start();
  const events = (await request(second.port, '/api/events')).body.events;
  assert.equal(events.length, 2); assert.equal(events[1].eventId, a.body.eventId);
  const b = await request(second.port, '/api/test/resource', auth); assert.equal(b.status, 200);
  assert.ok(!events.some(e => e.eventId === b.body.eventId));
  assert.deepEqual(await second.stop(), { exitCode: 0, signal: null });
  for (const secret of [DEMO_TOKEN, 'sim-wrong-private-marker', 'Authorization']) assert.ok(!logs.includes(secret));
});

test('frontend repository contents match HEAD and event files are ignored by Git', () => {
  for (const file of ['app.js', 'index.html', 'styles.css', 'tests/smoke.test.mjs']) {
    const committed = execFileSync('git', ['show', `HEAD:${file}`]);
    // Git normalizes CRLF; compare canonical repository content.
    const working = execFileSync('git', ['hash-object', '--path=' + file, file], { encoding: 'utf8' }).trim();
    const original = execFileSync('git', ['hash-object', '--stdin'], { input: committed, encoding: 'utf8' }).trim();
    assert.equal(working, original, file);
  }
  assert.match(execFileSync('git', ['check-ignore', 'data/events.jsonl', 'example.jsonl'], { encoding: 'utf8' }), /data\/events.jsonl/);
});
