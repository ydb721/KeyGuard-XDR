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
  for(const id of htmlIds)get(id); // The real document already contains every HTML element, including query controls.
  const pages = ['overview','incidents','lab'].map(id=>get('page-'+id));
  const statuses = ['ALL','OPEN','INVESTIGATING','CONTAINED'].map(status=>Object.assign(element(),{dataset:{status}}));
  const nav = ['overview','incidents','lab'].map(page=>Object.assign(element(),{dataset:{page}}));
  const document = {body:{dataset:{}},getElementById:get,createElement:()=>element(),
    querySelectorAll:s=>s==='.page'?pages:s==='[data-page]'?nav:s==='[data-status]'?statuses:[],
    addEventListener:(key,fn)=>documentListeners.set(key,fn)};
  let hash='';
  const location={protocol,hostname,get hash(){return hash},set hash(value){hash=value&&!value.startsWith('#')?'#'+value:value}};
  const ctx = vm.createContext({document,window:{addEventListener:(key,fn)=>windowListeners.set(key,fn)},
    location,Date,Intl,structuredClone,AbortController,Blob,
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
    key:(key,dataset)=>{let prevented=false;documentListeners.get('keydown')({key,preventDefault(){prevented=true},target:{closest:()=>({click:()=>documentListeners.get('click')({target:{closest:()=>({dataset})}})})}});return prevented},
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
  assert.ok(html.includes(d.successEventId));assert.match(html,/인증 성공/);assert.match(html,/HTTP 200/);
  assert.match(html,/HTTP 401/);assert.match(html,/120초 분석 구간/);assert.match(html,/실패 횟수/);
  assert.match(html,/사고 ID/);assert.match(html,/탐지 근거/);assert.match(html,/상세 정보/);
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
  assert.match(h.items.get('source-title').textContent,/로컬 테스트 키.*시나리오 분석/);
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
    assert.match(h.items.get('connection-status').textContent,/로컬 조회 불가/);
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

// Detect presentation checks complement the existing API/security contracts above.
test('Detect distinguishes before-query/loading from a successfully queried empty range', async t => {
  const h=harness(t,{data:{events:[],detections:[]}});
  assert.equal(h.items.get('detect-status').dataset.state,'loading');
  assert.match(h.items.get('metric-grid').innerHTML,/metric-value">—/);
  assert.equal(h.items.get('detect-table').hidden,true);
  await h.ready();
  assert.equal(h.items.get('detect-status').dataset.state,'empty');
  assert.equal(h.items.get('detect-status').hidden,false);
  assert.match(h.items.get('detect-status-title').textContent,/수집/);
  assert.equal(h.items.get('detect-status-description').hidden,true);
  assert.match(readFileSync(new URL('../README.md',import.meta.url),'utf8'),/PC 전체의 안전 여부를 판단할 수 없습니다/);
  for(const id of ['detect-table','event-table','event-technical'])assert.equal(h.items.get(id).hidden,true,id);
  assert.equal(h.items.get('event-empty').hidden,true);
  assert.equal(h.items.get('local-event-panel').hidden,true);
  assert.equal(h.items.get('detect-results-panel').hidden,true);
  assert.match(h.items.get('event-empty-title').textContent,/수집된 이벤트 없음/);
  h.run("live.lastSuccess=null;live.message='';live.status='Unavailable';render()");
  assert.equal(h.items.get('detect-status').dataset.state,'before');
  assert.match(h.items.get('metric-grid').innerHTML,/metric-value">—/);
});

test('Detect distinguishes collected events without detections from suspicious rule results', async t => {
  const normal=harness(t,{data:dataset(0,true)});await normal.ready();
  assert.equal(normal.items.get('detect-status').dataset.state,'events');
  assert.equal(normal.items.get('detect-table').hidden,true);
  assert.equal(normal.items.get('event-table').hidden,false);
  assert.match(normal.items.get('local-event-body').innerHTML,/인증 성공/);
  assert.equal(normal.items.get('detect-status-description').hidden,true);
  assert.match(readFileSync(new URL('../README.md',import.meta.url),'utf8'),/규칙에 해당하지 않는 위험/);
  const suspicious=harness(t);await suspicious.ready();
  assert.equal(suspicious.items.get('detect-status').dataset.state,'findings');
  assert.equal(suspicious.items.get('detect-empty').hidden,true);
  assert.equal(suspicious.items.get('detect-table').hidden,false);
  assert.match(suspicious.items.get('queue-body').innerHTML,/짧은 시간에 인증 실패/);
  assert.match(suspicious.items.get('detect-status-description').textContent,/의심 신호/);
  assert.match(suspicious.items.get('detect-scope').textContent,/각각 최근 최대 100건.*전체 누적 건수 아님.*마지막 성공 확인/);
});

test('Detect explains connection/invalid errors and stale snapshots without inventing results', async t => {
  const network=harness(t,{fetcher:()=>{throw Error('private-secret')}});await network.ready();
  assert.equal(network.items.get('detect-status').dataset.state,'error');
  assert.match(network.items.get('detect-status-description').textContent,/서버가 실행 중인지 확인/);
  assert.doesNotMatch(network.items.get('detect-status-description').textContent,/private-secret/);
  const invalid=harness(t,{fetcher:()=>response({bad:true})});await invalid.ready();
  assert.equal(invalid.items.get('detect-status').dataset.state,'invalid');
  let fail=false;const data=dataset();const h=harness(t,{fetcher:path=>fail?response({},503):response(payload(path,data))});await h.ready();
  const previous=h.run('JSON.stringify([live.events,live.detections,live.lastSuccess])');fail=true;await h.run('refreshLocal()');
  assert.equal(h.items.get('detect-status').dataset.state,'stale');
  assert.match(h.items.get('detect-status-title').textContent,/마지막 성공 조회 결과만/);
  assert.match(h.items.get('detect-status-description').textContent,/저장소 오류.*최신 상태가 아닙니다/);
  assert.equal(h.run('JSON.stringify([live.events,live.detections,live.lastSuccess])'),previous);
  assert.equal(h.items.get('detect-table').hidden,false);
});

test('Detect remains read-only while source changes and practice navigation preserve simulation', async t => {
  const h=harness(t);await h.ready();const before=h.calls.length;
  h.run('detectPresentation();detectPresentation()');assert.equal(h.calls.length,before);
  assert.equal(h.items.get('data-source-controls').hidden,false);
  h.run('render()');assert.equal(h.items.get('refresh-local').hidden,false);
  h.change('data-source','demo');assert.equal(h.items.get('detect-status').dataset.state,'simulation');
  assert.equal(h.items.get('detect-status').hidden,true);
  assert.equal(h.items.get('detect-source').textContent,'샘플 데이터');
  assert.match(h.items.get('queue-body').innerHTML,/샘플 사고/);
  assert.equal(h.run('state.incidents.length'),5);assert.equal(h.run('state.audit.length'),4);
  h.hash('#lab');assert.equal(h.items.get('detect-intro').hidden,true);
  assert.equal(h.run('current()'),'lab');assert.equal(h.run('dataMode'),'demo');
  h.run('run()');assert.equal(h.run('state.incidents.length'),6);
});


test('Detect zero/zero has one empty-state message and no meaningless detail action', async t => {
  const h=harness(t,{data:{events:[],detections:[]}});await h.ready();
  assert.equal(h.items.get('detect-status').dataset.state,'empty');
  assert.equal(h.items.get('detect-status-description').hidden,true);
  for(const id of ['detect-results-panel','local-event-panel','detect-empty','event-empty','detect-detail-link','detect-table','event-table'])assert.equal(h.items.get(id).hidden,true,id);
  assert.equal(h.items.get('source-banner').hidden,true);
  assert.equal(h.items.get('detect-source').textContent,'로컬 데이터');
  assert.match(h.items.get('detect-scope').textContent,/각각 최근 최대 100건.*마지막 성공 확인/);
  assert.equal(h.items.get('data-source-controls').hidden,false);
});

test('Detect keeps detections and evidence navigation when events fall outside the query range', async t => {
  const data=dataset();data.events=[];const h=harness(t,{data});await h.ready();
  assert.equal(h.items.get('detect-status').dataset.state,'findings');
  assert.equal(h.items.get('detect-status').dataset.severity,'MEDIUM');
  assert.equal(h.items.get('detect-detail-link').hidden,false);
  assert.equal(h.items.get('detect-results-panel').hidden,false);
  assert.equal(h.items.get('local-event-panel').hidden,true);
  const id=h.run('live.detections[0].detectionId');h.click({detection:id});await h.ready();
  assert.match(h.items.get('incident-detail').innerHTML,/현재 조회 범위에 상세 기록이 없습니다/);
  assert.match(h.items.get('incident-detail').innerHTML,/KG-R00/);
});

test('Direct query controls preserve theme, refresh and navigation without extra traffic', async t => {
  const h=harness(t);await h.ready();const controls=h.items.get('data-source-controls'),before=h.calls.length;
  h.run("theme('dark');render()");
  assert.equal(controls.hidden,false);assert.equal(h.items.get('refresh-local').hidden,false);assert.equal(h.calls.length,before);
  h.hash('#incidents');await h.ready();assert.equal(controls.hidden,false);
  assert.equal(h.items.get('source-banner').hidden,true);
  h.hash('#overview');await h.ready();assert.equal(controls.hidden,false);
  assert.equal(h.items.get('source-banner').hidden,true);
  assert.equal(h.ctx.document.body.dataset.theme,'dark');
  await h.run('refreshLocal()');assert.equal(controls.hidden,false);
  assert.equal(h.ctx.document.body.dataset.theme,'dark');
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.match(html,/<div id="data-source-controls" class="source-controls">/);
  const toolbar=html.slice(html.indexOf('<div id="data-source-controls"'),html.indexOf('<section id="page-overview"'));
  for(const id of ['data-source','refresh-local','connection-status','detect-scope'])assert.ok(toolbar.includes(`id="${id}"`),id);
  h.hash('#lab');await h.ready();assert.equal(h.items.get('source-banner').hidden,false);
  assert.equal(h.items.get('reset-demo').hidden,false);
});

test('Errors and stale status remain visible beside direct query controls; demo provenance stays distinct', async t => {
  let fail=false;const data=dataset();const h=harness(t,{fetcher:path=>fail?response({},503):response(payload(path,data))});await h.ready();
  fail=true;await h.run('refreshLocal()');
  assert.equal(h.items.get('data-source-controls').hidden,false);
  assert.equal(h.items.get('detect-intro').hidden,false);
  assert.equal(h.items.get('detect-status').dataset.state,'stale');
  assert.match(h.items.get('detect-status-description').textContent,/최신 상태가 아닙니다/);
  h.change('data-source','demo');
  assert.equal(h.items.get('detect-source').textContent,'샘플 데이터');
  assert.equal(h.items.get('detect-status').dataset.state,'simulation');
  assert.equal(h.items.get('detect-detail-link').hidden,false);
  assert.match(h.items.get('queue-body').innerHTML,/샘플 사고/);
  const normal=harness(t,{data:dataset(0,true)});await normal.ready();
  assert.equal(normal.items.get('detect-results-panel').hidden,true);
  assert.equal(normal.items.get('detect-detail-link').hidden,true);
  assert.equal(normal.items.get('local-event-panel').hidden,false);
  assert.equal(normal.items.get('detect-status').dataset.state,'events');
});


test('Concise UI keeps empty/normal results distinct from safety claims and preserves limitations in detail', async t => {
  const h=harness(t,{data:{events:[],detections:[]}});await h.ready();
  assert.equal(h.items.get('detect-status-title').textContent,'수집된 이벤트 없음');
  assert.equal(h.items.get('connection-status').textContent,'연결됨 · 기록 없음');
  assert.equal(h.items.get('detect-status-description').hidden,true);
  assert.equal(h.items.get('source-description').hidden,true);
  assert.equal(h.items.get('detect-results-panel').hidden,true);
  const normal=harness(t,{data:dataset(0,true)});await normal.ready();
  assert.equal(normal.items.get('detect-status-title').textContent,'조회된 탐지 결과 없음');
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.doesNotMatch(html,/<(?:details|summary)\b/);
  const documentation=readFileSync(new URL('../README.md',import.meta.url),'utf8');
  assert.match(documentation,/모의 실습은 브라우저의 합성 데이터만 변경/);
  assert.match(documentation,/키를 실제로 발급·폐기하고 HTTP 인증을 검증/);
  assert.match(documentation,/규칙에 해당하지 않는 위험/);
  assert.match(documentation,/PC 전체의 안전 여부/);
});

test('Concise source labels distinguish local key management from browser simulation', async t => {
  const h=harness(t);await h.ready();
  assert.equal(h.items.get('source-title').textContent,'로컬 데이터');
  h.change('data-source','demo');
  assert.equal(h.items.get('source-title').textContent,'시나리오 분석');
  assert.match(h.items.get('detect-scope').textContent,/데이터 출처: 샘플 데이터.*로컬 서버/);
  assert.equal(h.items.get('detect-source').textContent,'샘플 데이터');
  h.hash('#lab');
  assert.equal(h.items.get('source-title').textContent,'로컬 테스트 키 · 시나리오 분석');
  assert.equal(h.items.get('source-description').hidden,false);
  assert.match(h.items.get('source-description').textContent,/실제 이벤트 탐지 및 키 관리는 로컬 서버/);
  h.run("run();change(state.last,'CONTAINED')");
  assert.match(h.items.get('lab-output').innerHTML,/시나리오 처리 기록 완료.*미검증/);
  assert.equal(h.run('state.audit.length'),7);
});


test('Detect local row opens the chosen evidence despite previous Investigate filters; internal selection does not navigate or refetch', async t => {
  const h=harness(t);await h.ready();
  const [first,second]=h.run('live.detections.map(d=>d.detectionId)');
  h.run("live.search='not-present';live.severity='HIGH'");
  h.click({detection:first});await h.ready();
  assert.equal(h.run('current()'),'incidents');assert.equal(h.ctx.location.hash,'#incidents');
  assert.equal(h.run('live.selected'),first);assert.ok(h.items.get('incident-detail').innerHTML.includes(first));
  assert.equal(h.run('live.search'),'');assert.equal(h.run('live.severity'),'ALL');
  const calls=h.calls.length;h.click({detection:second});
  assert.equal(h.run('current()'),'incidents');assert.equal(h.run('live.selected'),second);
  assert.ok(h.items.get('incident-detail').innerHTML.includes(second));assert.equal(h.calls.length,calls);
});

test('Detect demo row opens the chosen incident; Investigate row changes only selection and preserves filters', async t => {
  const h=harness(t);await h.ready();h.change('data-source','demo');
  h.run("state.search='not-present';state.severity='LOW';state.status='CONTAINED'");
  const before=h.run('JSON.stringify([state.incidents,state.audit])');
  h.click({incident:'KG-0214'});
  assert.equal(h.run('current()'),'incidents');assert.equal(h.run('state.selected'),'KG-0214');
  assert.match(h.items.get('incident-detail').innerHTML,/billing-api/);
  assert.equal(h.run('state.search'),'');assert.equal(h.run('state.severity'),'ALL');assert.equal(h.run('state.status'),'ALL');
  h.run("state.severity='MEDIUM';state.status='OPEN';incidents()");const calls=h.calls.length;
  h.click({incident:'KG-0212'});
  assert.equal(h.run('current()'),'incidents');assert.equal(h.run('state.selected'),'KG-0212');
  assert.match(h.items.get('incident-detail').innerHTML,/identity-gateway/);
  assert.equal(h.run('state.severity'),'MEDIUM');assert.equal(h.run('state.status'),'OPEN');
  assert.equal(h.calls.length,calls);assert.equal(h.run('JSON.stringify([state.incidents,state.audit])'),before);
});

test('Enter and Space on local Detect rows follow the same selected-evidence navigation', async t => {
  for(const key of ['Enter',' ']){
    const h=harness(t);await h.ready();const id=h.run('live.detections[0].detectionId');
    assert.equal(h.key(key,{detection:id}),true);await h.ready();
    assert.equal(h.run('current()'),'incidents');assert.equal(h.run('live.selected'),id);
    assert.ok(h.items.get('incident-detail').innerHTML.includes(id));
  }
});

test('Enter and Space on demo Detect rows open the selected incident without changing simulation data', async t => {
  for(const key of ['Enter',' ']){
    const h=harness(t);await h.ready();h.change('data-source','demo');
    assert.equal(h.key(key,{incident:'KG-0213'}),true);
    assert.equal(h.run('current()'),'incidents');assert.equal(h.run('state.selected'),'KG-0213');
    assert.match(h.items.get('incident-detail').innerHTML,/archive-service/);
    assert.equal(h.run('state.incidents.length'),5);assert.equal(h.run('state.audit.length'),4);
  }
});

test('Detect shortcut is analysis-only and conditional; sidebar Respond navigation remains available', async t => {
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.match(html,/<button id="detect-detail-link" class="link-btn" data-go="incidents">사고 분석 →<\/button>/);
  const overview=html.slice(html.indexOf('<section id="page-overview"'),html.indexOf('<section id="page-incidents"'));
  assert.doesNotMatch(overview,/data-go="lab"|모의 실습 보기|detect-practice/);
  assert.match(html,/<button class="nav-item" data-page="lab">대응 및 검증/);
  const empty=harness(t,{data:{events:[],detections:[]}});await empty.ready();assert.equal(empty.items.get('detect-detail-link').hidden,true);
  const filled=harness(t);await filled.ready();assert.equal(filled.items.get('detect-detail-link').hidden,false);
  filled.click({page:'lab'});assert.equal(filled.run('current()'),'lab');
});


test('All application disclosure controls are removed while original events and key confirmations remain directly available', async t => {
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const css=readFileSync(new URL('../styles.css',import.meta.url),'utf8');
  assert.doesNotMatch(html,/<(?:details|summary)\b|id="ui-help"|detect-event-list/);
  assert.doesNotMatch(app,/\.open\b/);
  assert.doesNotMatch(css,/>summary|\[open\]|query-settings-content|detect-details|ui-help/);
  const data=dataset();const h=harness(t,{data});await h.ready();
  for(const id of ['data-source-controls','refresh-local','event-table','event-technical'])assert.equal(h.items.get(id).hidden,false,id);
  const raw=h.items.get('local-event-body').innerHTML;
  for(const value of Object.values(data.events[0]))assert.ok(raw.includes(String(value)),String(value));
  assert.match(raw,/인증 성공/);assert.match(raw,/HTTP 200/);assert.match(raw,/HTTP 401/);
  assert.match(html,/<div id="lab-confirm"[^>]*hidden>/);
  assert.ok(html.includes('id="lab-confirm-yes"'));assert.ok(html.includes('id="lab-confirm-no"'));
  h.hash('#lab');assert.equal(h.items.get('data-source-controls').hidden,true);
});


test('Investigate uses Detect Korean incident names while preserving every original title and technical record', async t => {
  const h=harness(t);await h.ready();h.change('data-source','demo');
  const original=h.run('JSON.stringify(state.incidents)');
  const names=[['KG-0214','인증정보 사용 이상'],['KG-0213','비정상 데이터 전송 징후'],['KG-0212','반복된 인증 실패'],['KG-0211','의심스러운 요청 내용'],['KG-0210','예상하지 못한 권한 변경']];
  for(const [id,name] of names){
    const record=h.run(`state.incidents.find(x=>x.id==='${id}')`);
    assert.ok(h.items.get('queue-body').innerHTML.includes(`<strong class="main-cell">${name}</strong>`));
    h.click({incident:id});
    assert.equal(h.run('current()'),'incidents');
    assert.ok(h.items.get('incident-body').innerHTML.includes(`<strong class="main-cell">${name}</strong>`));
    const detail=h.items.get('incident-detail').innerHTML;
    assert.ok(detail.includes(`<h2>${name}</h2>`));
    assert.match(detail,/사고 ID/);assert.match(detail,/탐지 근거/);assert.match(detail,/상세 정보/);
    assert.match(detail,/샘플 데이터/);assert.ok(!detail.includes('CASE FILE'));
    for(const value of [record.title,record.id,record.rule,record.asset,record.ruleName])assert.ok(detail.includes(value),value);
  }
  assert.equal(h.run('JSON.stringify(state.incidents)'),original);
  assert.equal(h.run('state.audit.length'),4);
});

test('Korean and original incident-name searches resolve the same record without altering original data', async t => {
  const h=harness(t);await h.ready();h.change('data-source','demo');h.hash('#incidents');
  for(const query of ['인증정보 사용 이상','Unusual API key activity']){
    h.run(`state.search=${JSON.stringify(query)};incidents()`);
    assert.match(h.items.get('incident-body').innerHTML,/KG-0214/);
    assert.doesNotMatch(h.items.get('incident-body').innerHTML,/KG-0213/);
    assert.match(h.items.get('incident-detail').innerHTML,/<h2>인증정보 사용 이상<\/h2>/);
  }
  assert.equal(h.run("state.incidents.find(x=>x.id==='KG-0214').title"),'Unusual API key activity');
  assert.equal(h.run("incidentName({rule:'unknown-rule',title:'Original unknown incident'})"),'Original unknown incident');
});


test('Investigate removes only the heading shortcut and retains all selected-incident actions and sidebar navigation', async t => {
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const investigate=html.slice(html.indexOf('<section id="page-incidents"'),html.indexOf('<section id="page-lab"'));
  const heading=investigate.slice(0,investigate.indexOf('<div class="toolbar">'));
  assert.doesNotMatch(heading,/data-go="lab"|대응 및 검증으로/);
  assert.match(html,/<button class="nav-item" data-page="lab">대응 및 검증/);
  const h=harness(t);await h.ready();h.change('data-source','demo');h.click({incident:'KG-0214'});
  const detail=h.items.get('incident-detail').innerHTML;
  assert.match(detail,/data-investigate="KG-0214"[^>]*>조사 시작/);
  assert.match(detail,/data-contain="KG-0214"[^>]*>시나리오 처리/);
  assert.match(detail,/data-go="lab">대응 및 검증으로/);
  h.click({investigate:'KG-0214'});assert.equal(h.run("state.incidents.find(x=>x.id==='KG-0214').status"),'INVESTIGATING');
  h.click({contain:'KG-0214'});assert.equal(h.run("state.incidents.find(x=>x.id==='KG-0214').status"),'CONTAINED');
  h.click({go:'lab'});assert.equal(h.run('current()'),'lab');
});


test('Simulation audit classification is Korean presentation only; original audit rows and CSV remain unchanged', async t => {
  const h=harness(t);await h.ready();h.change('data-source','demo');
  const original=h.run('JSON.stringify(state.audit)');h.run('audit()');
  assert.equal(h.run('JSON.stringify(state.audit)'),original);
  for(const [type,label] of [['DETECTION','탐지'],['RESPONSE','대응']])assert.ok(h.items.get('audit-body').innerHTML.includes(`class="event-type ${type.toLowerCase()}">${label}</span>`));
  h.run("run();change(state.last,'INVESTIGATING');change(state.last,'CONTAINED')");
  const beforeRender=h.run('JSON.stringify(state.audit)');h.run('audit()');
  assert.equal(h.run('JSON.stringify(state.audit)'),beforeRender);
  for(const [type,label] of [['DETECTION','탐지'],['RESPONSE','대응'],['TRIAGE','조사'],['SIMULATION','시나리오 분석']]){
    assert.ok(h.items.get('audit-body').innerHTML.includes(`class="event-type ${type.toLowerCase()}">${label}</span>`));
    assert.ok(h.run(`state.audit.some(x=>x.type==='${type}')`));
  }
  const blobs=[];h.ctx.URL.createObjectURL=blob=>{blobs.push(blob);return 'blob:audit-test'};
  h.items.get('export-csv').click();assert.equal(blobs.length,1);const csv=await blobs[0].text();
  for(const type of ['DETECTION','RESPONSE','TRIAGE','SIMULATION'])assert.ok(csv.includes(`"${type}"`));
  assert.equal(h.run('JSON.stringify(state.audit)'),beforeRender);
});

test('Hosted Investigate uses concise source badge without dead localhost lookup controls', async t => {
  const hosted=harness(t,{protocol:'https:',hostname:'keyguard-xdr-v050.vercel.app'});
  await hosted.ready();
  assert.equal(hosted.run('localEligible'),false);
  assert.equal(hosted.run('dataMode'),'demo');
  assert.equal(hosted.items.get('data-source-controls').hidden,true);
  hosted.hash('#incidents');
  assert.equal(hosted.items.get('data-source-controls').hidden,true);
  assert.equal(hosted.items.get('source-banner').hidden,true);
  assert.equal(hosted.items.get('source-diagnostics').hidden,true);
  assert.equal(hosted.items.get('connection-status').hidden,true);
  assert.equal(hosted.items.get('last-loaded').hidden,true);
  assert.equal(hosted.items.get('incidents-source').textContent,'샘플 데이터');
  assert.match(hosted.items.get('incident-body').innerHTML,/KG-0214/);
  assert.equal(hosted.calls.length,0);
  const local=harness(t);await local.ready();local.hash('#incidents');await local.ready();
  assert.equal(local.items.get('data-source-controls').hidden,false);
  assert.equal(local.items.get('incidents-source').textContent,'로컬 데이터');
  local.change('data-source','demo');
  assert.equal(local.items.get('data-source-controls').hidden,false);
  assert.equal(local.items.get('source-diagnostics').hidden,true);
  assert.equal(local.items.get('incidents-source').textContent,'샘플 데이터');
});
