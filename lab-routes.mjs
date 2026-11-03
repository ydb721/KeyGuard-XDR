import { timingSafeEqual } from 'node:crypto';
import { createKeyStore, hashSecret, LabError } from './key-store.mjs';

const routes = new Map([
  ['/api/lab/keys/issue','POST'], ['/api/lab/keys/revoke','POST'], ['/api/lab/keys/status','GET'],
  ['/api/lab/resource','GET'], ['/api/lab/audit','GET'],
]);
const reject = (code, status) => { throw new LabError(code, status); };
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
async function body(req) {
  if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(req.headers['content-type'] ?? '') || req.headers['content-encoding']) reject('JSON_REQUIRED',415);
  if (req.headers['content-length'] && Number(req.headers['content-length']) > 1024) reject('BODY_TOO_LARGE',413);
  const bytes = await new Promise((resolve,rejectPromise) => {
    let size = 0; const chunks = [];
    const cleanup = () => { clearTimeout(timer); req.off('data',data); req.off('end',end); req.off('error',error); req.off('aborted',aborted); };
    const error = () => { cleanup(); rejectPromise(new LabError('INVALID_BODY',400)); };
    const aborted = error;
    const data = chunk => {
      size += chunk.length;
      if (size > 1024) { cleanup(); req.resume(); rejectPromise(new LabError('BODY_TOO_LARGE',413)); }
      else chunks.push(chunk);
    };
    const end = () => { cleanup(); resolve(Buffer.concat(chunks)); };
    const timer = setTimeout(() => { cleanup(); req.resume(); rejectPromise(new LabError('BODY_TIMEOUT',408)); },5000);
    req.on('data',data); req.once('end',end); req.once('error',error); req.once('aborted',aborted);
  });
  try {
    const parsed = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error();
    return parsed;
  } catch { reject('INVALID_JSON',400); }
}

export async function createLabRoutes({ operatorSecret, publicToken, keyStore = createKeyStore() } = {}) {
  const enabled = typeof operatorSecret === 'string' && /^[\x21-\x7e]{32,256}$/.test(operatorSecret) && operatorSecret !== publicToken;
  const digest = enabled ? hashSecret(operatorSecret) : null;
  if (enabled) await keyStore.initialize();
  return async (req,res,url,send) => {
    const method = routes.get(url.pathname);
    if (!method) reject('NOT_FOUND',404);
    if (req.method !== method) return send(405,{error:{code:'METHOD_NOT_ALLOWED',message:'METHOD_NOT_ALLOWED'}},{Allow:method});
    // Stronger lab rule: an Origin must exactly match the request's already-validated Host.
    if (req.headers.origin !== undefined && req.headers.origin !== `http://${req.headers.host}`) reject('ORIGIN_NOT_ALLOWED',403);
    if (!enabled) reject('LAB_DISABLED',503);
    if (url.pathname !== '/api/lab/resource') {
      const secret = req.headers['x-keyguard-operator'];
      const duplicates = req.headersDistinct?.['x-keyguard-operator'];
      if (typeof secret !== 'string' || secret.length > 256 || duplicates?.length > 1 || !timingSafeEqual(hashSecret(secret),digest)) reject('OPERATOR_UNAUTHORIZED',401);
    }
    if (url.pathname !== '/api/lab/audit' && url.search) reject('INVALID_QUERY',400);
    if (url.pathname === '/api/lab/keys/status') return send(200,await keyStore.status());
    if (url.pathname === '/api/lab/audit') {
      const values = url.searchParams.getAll('limit');
      if ([...url.searchParams.keys()].some(key=>key!=='limit') || values.length>1 || (values.length && !/^[1-9]\d*$/.test(values[0]))) reject('INVALID_LIMIT',400);
      const limit = values.length ? Number(values[0]) : 50;
      if (!Number.isSafeInteger(limit) || limit>100) reject('INVALID_LIMIT',400);
      return send(200,await keyStore.audit(limit));
    }
    if (url.pathname === '/api/lab/resource') {
      const match = /^Bearer (kg-lab-[A-Za-z0-9_-]{43})$/.exec(req.headers.authorization ?? '');
      const result = await keyStore.verify(match?.[1]);
      return send(result.statusCode,result,result.statusCode===401?{'WWW-Authenticate':'Bearer realm="local-key-lab"'}:{});
    }
    const value = await body(req), revoke = url.pathname.endsWith('/revoke');
    if (value.confirm !== true || Object.keys(value).some(key=>!['confirm',...(revoke?['keyId']:[])].includes(key)) || (revoke && !uuid(value.keyId))) reject('CONFIRMATION_REQUIRED',400);
    return send(revoke?200:201,revoke?await keyStore.revoke(value.keyId):await keyStore.issue());
  };
}
