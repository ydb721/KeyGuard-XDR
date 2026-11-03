import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { detectThreats } from '../rule-engine.mjs';
import { createLocalServer, DEMO_TOKEN } from '../server.mjs';
import { createEventStore } from '../event-store.mjs';

const client = readFileSync(new URL('../local-api.js', import.meta.url), 'utf8');
const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const htmlIds = new Set([...readFileSync(new URL('../index.html', import.meta.url), 'utf8').matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]));
function dataset(count = 5, success = true) {
  const events = Array.from({ length: count + (success ? 1 : 0) }, (_, i) => ({
    eventId: `00000000-0000-4000-8000-${i.toString(16).padStart(12,'0')}`,
    timestamp: new Date(Date.parse('2026-11-03T00:00:00.000Z') + i * 1000).toISOString(),
    source: 'local-http', eventType: i === count ? 'authentication_success' : 'authentication_failure',
    method: 'GET', path: '/api/test/resource', statusCode: i === count ? 200 : 401,
    outcome: i === count ? 'success' : 'failure', assetId: 'demo-test-resource',
  }));
  return { events: events.reverse(), detections: detectThreats(events) };
}
const response = (body, status = 200) => ({ ok: status === 200, status,
  headers: { get: () => 'application/json; charset=utf-8' }, json: async () => structuredClone(body) });
function payload(path, data) {
  if (path === '/api/health') return { status: 'ok', version: '0.4.0', scope: 'localhost-education-only' };
  const key = path.startsWith('/api/events') ? 'events' : 'detections';
  return { [key]: data[key], count: data[key].length, limit: 100 };
}
function harness(t, { data = dataset(), fetcher, protocol = 'http:', hostname = '127.0.0.1' } = {}) {
  const items = new Map(), documentListeners = new Map(), windowListeners = new Map(), local = new Map(), calls = [], timers = new Set();
  const element = (id = '') => {
    const classes = new Set(), listeners = new Map();
    return { id, innerHTML:'', textContent:'', value:'', hidden:false, disabled:false, dataset:{}, listeners,
      classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),toggle:(x,on)=>on?classes.add(x):classes.delete(x)},
      setAttribute(k,v){this[k]=String(v)},removeAttribute(k){delete this[k]},
      addEventListener(k,fn){listeners.set(k,fn)},click(){listeners.get('click')?.({target:this})},
    };
  };
  const get = id => { assert.ok(htmlIds.has(id), `Missing HTML element: ${id}`);if (!items.has(id)) items.set(id, element(id)); return items.get(id); };
  const pages = ['overview','incidents','lab'].map(id=>get('page-'+id));
  const statuses = ['ALL','OPEN','INVESTIGATING','CONTAINED'].map(status=>Object.assign(element(),{dataset:{status}}));
  const nav = ['overview','incidents','lab'].map(page=>Object.assign(element(),{dataset:{page}}));
  const document = {body:{dataset:{}},getElementById:get,createElement:()=>element(),
    querySelectorAll:s=>s==='.page'?pages:s==='[data-page]'?nav:s==='[data-status]'?statuses:[],
    addEventListener:(key,fn)=>documentListeners.set(key,fn)};
  const ctx = vm.createContext({document,window:{addEventListener:(key,fn)=>windowListeners.set(key,fn)},
    location:{protocol,hostname,hash:''},Date,Intl,structuredClone,AbortController,Blob,
    URL:{createObjectURL:()=>'',revokeObjectURL(){}},
    localStorage:{getItem:k=>local.get(k)??null,setItem:(k,v)=>local.set(k,v)},
    setTimeout:(fn,ms)=>{const timer=setTimeout(fn,ms);timers.add(timer);return timer},clearTimeout,
    fetch:async(path,options)=>{calls.push({path,options});return fetcher?fetcher(path,options):response(payload(path,data))},
  });
  vm.runInContext(client,ctx);vm.runInContext(app,ctx);
  t.after(()=>{vm.runInContext('cancelLocal()',ctx);for(const timer of timers)clearTimeout(timer)});
  return {items,ctx,calls,local,run:code=>vm.runInContext(code,ctx),ready:()=>vm.runInContext('live.pending',ctx),
    change:(id,value)=>{const el=get(id);el.value=value;return el.listeners.get('change')({target:el})},
    click:dataset=>documentListeners.get('click')({target:{closest:()=>({dataset})}}),
    hash:hash=>{ctx.location.hash=hash;windowListeners.get('hashchange')()},
  };
}

test('local HTTP responses populate Detect counters/events and R001 list/detail', async t => {
  const h=harness(t);assert.equal(h.run('live.status'),'Loading');await h.ready();
  assert.equal(h.run('dataMode'),'local');assert.equal(h.run('live.status'),'Connected');
  assert.match(h.items.get('metric-grid').innerHTML,/최근 조회 이벤트/);
  assert.match(h.items.get('metric-grid').innerHTML,/metric-value">6/);
  assert.match(h.items.get('local-event-body').innerHTML,/authentication_failure/);
  assert.match(h.items.get('queue-body').innerHTML,/KG-R001/);
  assert.match(h.items.get('rule-summary').textContent,/KG-R001: 1건/);
  const id=h.run("live.detections.find(d=>d.ruleId==='KG-R001').detectionId");
  h.click({detection:id});await h.ready();
  assert.match(h.items.get('incident-detail').innerHTML,/Authentication Failure Burst/);
  assert.match(h.items.get('incident-detail').innerHTML,/HTTP 401/);
  assert.match(h.items.get('incident-detail').innerHTML,/침해 확정이 아닙니다/);
  assert.ok(!h.items.get('metric-grid').innerHTML.includes('고위험'));
});

test('R002 detail links success ID and preceding failure evidence', async t => {
  const h=harness(t);await h.ready();
  const d=h.run("live.detections.find(d=>d.ruleId==='KG-R002')");
  h.click({detection:d.detectionId});await h.ready();
  const html=h.items.get('incident-detail').innerHTML;
  assert.ok(html.includes(d.successEventId));assert.match(html,/SUCCESS/);assert.match(html,/HTTP 200/);
  assert.match(html,/HTTP 401/);assert.match(html,/120초 구간/);assert.match(html,/실패 횟수/);
  for(const id of d.evidenceEventIds)assert.ok(html.includes(id));
});

test('normal empty responses are Empty while existing events with zero detections stay Connected', async t => {
  const empty=harness(t,{data:{events:[],detections:[]}});await empty.ready();
  assert.equal(empty.run('live.status'),'Empty');assert.match(empty.items.get('queue-body').innerHTML,/탐지 결과가 없습니다/);
  const normal=harness(t,{data:dataset(0,true)});await normal.ready();
  assert.equal(normal.run('live.status'),'Connected');assert.equal(normal.run('live.detections.length'),0);
  assert.match(normal.items.get('local-event-body').innerHTML,/HTTP|authentication_success/);
});

test('HTTP 503 and network failure have distinct safe messages, never a fake empty result', async t => {
  for(const kind of ['storage','network']){
    const h=harness(t,{fetcher:()=>{if(kind==='network')throw Error('private-path-token-stack');return response({error:'private-path-token-stack'},503)}});
    await h.ready();assert.equal(h.run('live.status'),'Error');
    assert.match(h.items.get('connection-status').textContent,kind==='storage'?/저장소 오류.*503/:/네트워크 연결/);
    assert.ok(!h.items.get('connection-status').textContent.includes('private-path-token-stack'));
    assert.match(h.items.get('metric-grid').innerHTML,/—/);assert.equal(h.items.get('refresh-local').textContent,'다시 시도');
  }
});

test('invalid JSON/body contracts and missing backend show Invalid Response or Unavailable', async t => {
  for(const fetcher of [
    ()=>response({events:'not-an-array'}),
    ()=>({ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>{throw Error('private')}}),
    ()=>({ok:true,status:200,headers:{get:()=> 'text/html'},json:async()=>({})}),
  ]){const h=harness(t,{fetcher});await h.ready();assert.equal(h.run('live.status'),'Invalid Response')}
  const unavailable=harness(t,{fetcher:()=>response({},404)});await unavailable.ready();
  assert.equal(unavailable.run('live.status'),'Unavailable');
});

test('retry failure preserves and clearly labels the previous successful snapshot', async t => {
  let fail=false;const data=dataset();
  const h=harness(t,{fetcher:path=>fail?response({},503):response(payload(path,data))});await h.ready();
  const before=h.run('JSON.stringify(live.detections)');fail=true;await h.run('refreshLocal()');
  assert.equal(h.run('JSON.stringify(live.detections)'),before);assert.equal(h.run('live.stale'),true);
  assert.match(h.items.get('connection-status').textContent,/이전 조회 데이터.*최신 상태가 아닙니다/);
  assert.equal(h.run('dataMode'),'local');fail=false;await h.run('refreshLocal()');
  assert.equal(h.run('live.stale'),false);assert.equal(h.run('live.status'),'Connected');
});

test('older ignored-abort responses cannot overwrite refresh, navigation or source changes', async t => {
  let generation=0;const waiting=[], data=dataset();
  const h=harness(t,{fetcher:path=>{
    if(path==='/api/health')generation++;
    if(generation===1)return new Promise(resolve=>waiting.push(()=>resolve(response(payload(path,data)))));
    return response(payload(path,{events:[],detections:[]}));
  }});
  const first=h.ready();await h.run('refreshLocal()');
  waiting.forEach(resolve=>resolve());await first;
  assert.equal(h.run('live.status'),'Empty');assert.equal(h.run('live.events.length'),0);
  h.hash('#incidents');await h.ready();assert.equal(h.run('live.status'),'Empty');
  h.change('data-source','demo');assert.equal(h.run('dataMode'),'demo');
  assert.match(h.items.get('incident-body').innerHTML,/KG-0214/);
  assert.equal(h.run('state.audit.length'),4);
});

test('leaving a loading page aborts requests and prevents late results replacing the demo', async t => {
  const waiting=[];const h=harness(t,{fetcher:path=>new Promise(resolve=>waiting.push(()=>resolve(response(payload(path,dataset())))))});
  const pending=h.ready();h.hash('#lab');assert.equal(h.run('dataMode'),'demo');
  assert.ok(h.calls.every(c=>c.options.signal.aborted));waiting.forEach(resolve=>resolve());await pending;
  assert.equal(h.run('live.lastSuccess'),null);assert.equal(h.run('state.incidents.length'),5);
  assert.match(h.items.get('source-title').textContent,/브라우저 시뮬레이션/);
  // A response can finish before the browser delivers a queued hashchange event.
  const delayed=[];const moving=harness(t,{fetcher:path=>new Promise(resolve=>delayed.push(()=>resolve(response(payload(path,dataset())))))});
  const old=moving.ready();moving.ctx.location.hash='#incidents';delayed.forEach(resolve=>resolve());await old;
  assert.equal(moving.run('live.lastSuccess'),null);
});

test('simulation state and audit survive source changes; real mode blocks all simulated actions', async t => {
  const h=harness(t);await h.ready();
  h.run("run();change('KG-0214','CONTAINED')");
  assert.equal(h.run('state.incidents.length'),5);assert.equal(h.run('state.audit.length'),4);
  assert.ok(!h.items.get('incident-detail').innerHTML.includes('data-contain'));
  h.change('data-source','demo');h.run('run()');
  const id=h.run('state.last');h.run(`change('${id}','INVESTIGATING');change('${id}','CONTAINED');change('${id}','CONTAINED')`);
  assert.equal(h.run('state.incidents.length'),6);assert.equal(h.run('state.audit.length'),8);
  await h.change('data-source','local');assert.ok(!h.items.get('queue-body').innerHTML.includes('KG-0214'));
  h.change('data-source','demo');assert.equal(h.run('state.audit.length'),8);
  assert.equal(h.run(`state.incidents.find(x=>x.id==='${id}').status`),'CONTAINED');
});

test('evidence missing from the last 100 events is explicitly reported rather than invented', async t => {
  const data=dataset();data.events=data.events.filter(e=>e.statusCode===200);
  const h=harness(t,{data});await h.ready();
  const id=h.run("live.detections.find(d=>d.ruleId==='KG-R001').detectionId");h.click({detection:id});await h.ready();
  const html=h.items.get('incident-detail').innerHTML;
  assert.match(html,/근거 이벤트 ID는 확인되었지만 현재 조회 범위에 상세 기록이 없습니다/);
  assert.ok(!html.includes('HTTP 401'));
});

test('API-provided HTML is escaped in list, detail, reason and asset text', async t => {
  const data=dataset();const attack='<img src=x onerror="window.PWNED=1"><script>window.PWNED=1</script>';
  for(const d of data.detections){d.ruleName=attack;d.reason=attack;d.assetId=attack}
  const h=harness(t,{data});await h.ready();
  const html=h.items.get('incident-detail').innerHTML+h.items.get('queue-body').innerHTML;
  assert.ok(!html.includes('<img'));assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;img'));
  assert.equal(h.ctx.window.PWNED,undefined);
});

test('GitHub Pages, file and non-local origins default to demo without any API request', async t => {
  for(const [protocol,hostname] of [['file:',''],['https:','ydb721.github.io'],['http:','external.example']]){
    const h=harness(t,{protocol,hostname});assert.equal(h.run('dataMode'),'demo');assert.equal(h.calls.length,0);
    assert.equal(h.items.get('local-source-option').disabled,true);
    assert.match(h.items.get('connection-status').textContent,/Unavailable/);
    h.run('run()');assert.equal(h.run('state.incidents.length'),6);
  }
});

test('manual refresh uses only same-origin read-only endpoints with credentials omitted', async t => {
  const h=harness(t);await h.ready();const count=h.calls.length;
  await h.items.get('refresh-local').listeners.get('click')();assert.equal(h.calls.length,count+3);
  for(const call of h.calls){
    assert.ok(['/api/health','/api/events?limit=100','/api/detections?limit=100'].includes(call.path));
    assert.equal(call.options.credentials,'omit');assert.equal(call.options.method,'GET');
    assert.equal(call.options.cache,'no-store');assert.equal(call.options.mode,'same-origin');
    assert.equal(call.options.redirect,'error');assert.equal(call.options.headers,undefined);
  }
});

test('client times out stalled requests and cancels their signals without exposing raw failures', async t => {
  const h=harness(t,{protocol:'file:'});const signals=[];
  h.ctx.stall=(path,options)=>{signals.push(options.signal);return new Promise(()=>{})};
  await assert.rejects(h.run('LocalApi.load({timeoutMs:10,fetcher:stall})'),err=>err.kind==='timeout');
  assert.ok(signals.every(signal=>signal.aborted));
});

test('VM-rendered UI integrates with real localhost API and never changes persisted JSONL on refresh', async t => {
  const dir=await mkdtemp(join(tmpdir(),'keyguard-ui-api-'));const file=join(dir,'events.jsonl');
  const server=await createLocalServer({store:createEventStore({file})});server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true})});
  const base=`http://127.0.0.1:${server.address().port}`;
  for(let i=0;i<5;i++)assert.equal((await fetch(base+'/api/test/resource')).status,401);
  await new Promise(resolve=>setTimeout(resolve,2));
  assert.equal((await fetch(base+'/api/test/resource',{headers:{Authorization:`Bearer ${DEMO_TOKEN}`}})).status,200);
  const before=await readFile(file);
  const h=harness(t,{fetcher:(path,options)=>fetch(base+path,options)});await h.ready();
  assert.equal(h.run('live.status'),'Connected');assert.equal(h.run('live.detections.length'),2);
  assert.match(h.items.get('queue-body').innerHTML,/KG-R001/);assert.match(h.items.get('queue-body').innerHTML,/KG-R002/);
  await h.run('refreshLocal()');assert.deepEqual(await readFile(file),before);
});
