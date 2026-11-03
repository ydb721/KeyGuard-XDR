import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname, extname } from 'node:path';
import { createEventStore, StoreError } from './event-store.mjs';
import { detectThreats } from './rule-engine.mjs';

const root = dirname(fileURLToPath(import.meta.url));
export const DEMO_TOKEN = 'sim-keyguard-public-demo-v0.2';
const allowed = new Set(['/', '/index.html', '/styles.css', '/app.js', '/local-api.js']);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const headers = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
};
function json(res, status, body, extra = {}) {
  res.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8', ...extra });
  res.end(JSON.stringify(body));
}
const error = (res, status, code, extra) => json(res, status, { error: { code, message: code } }, extra);

export async function createLocalServer({ store = createEventStore() } = {}) {
  await store.initialize();
  return http.createServer(async (req, res) => {
    try {
      const port = res.socket.localPort;
      const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
      if (!hosts.includes(req.headers.host)) return error(res, 403, 'HOST_NOT_ALLOWED');
      if (req.headers.origin !== undefined && !hosts.map(h => `http://${h}`).includes(req.headers.origin)) {
        return error(res, 403, 'ORIGIN_NOT_ALLOWED');
      }
      if (!req.url.startsWith('/') || req.url.startsWith('//') || /[%\\]/.test(req.url.split('?')[0])) {
        return error(res, 400, 'INVALID_URL');
      }
      const url = new URL(req.url, 'http://127.0.0.1');
      const path = url.pathname;
      if (path !== req.url.split('?')[0]) return error(res, 400, 'INVALID_URL');
      const api = ['/api/health', '/api/test/resource', '/api/events', '/api/detections'].includes(path);
      if (!api && !allowed.has(path)) return error(res, 404, 'NOT_FOUND');
      if (req.method !== 'GET' && !(allowed.has(path) && req.method === 'HEAD')) {
        return error(res, 405, 'METHOD_NOT_ALLOWED', { Allow: api ? 'GET' : 'GET, HEAD' });
      }
      if (api && !['/api/events', '/api/detections'].includes(path) && url.search) return error(res, 400, 'INVALID_QUERY');
      if (path === '/api/health') {
        await store.check();
        return json(res, 200, { status: 'ok', version: '0.4.0', scope: 'localhost-education-only' });
      }
      if (path === '/api/test/resource') {
        const status = req.headers.authorization === `Bearer ${DEMO_TOKEN}` ? 200 : 401;
        const event = await store.record(status);
        return json(res, status, { outcome: event.outcome, eventId: event.eventId },
          status === 401 ? { 'WWW-Authenticate': 'Bearer realm="local-demo"' } : {});
      }
      if (path === '/api/events' || path === '/api/detections') {
        const values = url.searchParams.getAll('limit');
        if ([...url.searchParams.keys()].some(k => k !== 'limit') || values.length > 1 ||
            (values.length && !/^[1-9]\d*$/.test(values[0]))) return error(res, 400, 'INVALID_LIMIT');
        const limit = values.length ? Number(values[0]) : 50;
        if (!Number.isSafeInteger(limit) || limit > 100) return error(res, 400, 'INVALID_LIMIT');
        if (path === '/api/detections') {
          const detections = detectThreats(await store.readAll()).slice(0, limit);
          return json(res, 200, { detections, count: detections.length, limit });
        }
        const events = await store.list(limit);
        return json(res, 200, { events, count: events.length, limit });
      }
      const rel = path === '/' ? '/index.html' : path;
      const content = await readFile(resolve(root, '.' + rel));
      res.writeHead(200, { ...headers, 'Content-Type': types[extname(rel)] });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch (err) {
      error(res, err instanceof StoreError ? 503 : 500,
        err instanceof StoreError ? err.code : 'LOCAL_SERVER_ERROR');
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 5173);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw Error('INVALID_LOCAL_PORT');
  const server = await createLocalServer();
  server.on('error', () => { console.error('LOCAL_SERVER_START_FAILED'); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`KeyGuard XDR v0.4.0: http://127.0.0.1:${port}`));
}
