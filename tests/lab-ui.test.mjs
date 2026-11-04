import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {createLocalServer} from '../server.mjs';
import {createKeyStore} from '../key-store.mjs';
import {createEventStore} from '../event-store.mjs';

const files=Object.fromEntries(['local-api.js','lab-api.js','app.js','lab-ui.js','index.html'].map(name=>[name,readFileSync(new URL('../'+name,import.meta.url),'utf8')]));
const ids=new Set([...files['index.html'].matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]));
const operator=randomBytes(32).toString('base64url');
function harness(t,{fetcher,protocol='http:',hostname='127.0.0.1',timeoutMs}={}){
  const elements=new Map(),docEvents=new Map(),winEvents=new Map(),timers=new Set(),local=new Map(),calls=[];
  function element(id=''){
    let html='',text='';const listeners=new Map();
    return{id,value:'',disabled:false,hidden:false,dataset:{},listeners,
      get innerHTML(){return html},set innerHTML(value){html=value;if(id==='lab-key-select'){this.value=/<option value="([^"]+)" selected/.exec(value)?.[1]??/<option value="([^"]+)"/.exec(value)?.[1]??''}},
      get textContent(){return text},set textContent(value){text=String(value);html=''},
      classList:{add(){},remove(){},toggle(){}},setAttribute(k,v){this[k]=String(v)},removeAttribute(k){delete this[k]},
      addEventListener:(kind,fn)=>listeners.set(kind,fn),click(){if(!this.disabled)return listeners.get('click')?.({target:this})}};
  }
  const get=id=>{assert.ok(ids.has(id),'Missing DOM ID '+id);if(!elements.has(id))elements.set(id,element(id));return elements.get(id)};
  for(const id of ids)get(id);
  const document={body:{dataset:{}},getElementById:get,createElement:()=>element(),addEventListener:(k,fn)=>docEvents.set(k,fn),
    querySelectorAll:s=>s==='.page'?['overview','incidents','lab'].map(p=>get('page-'+p)):s==='[data-page]'?['overview','incidents','lab'].map(page=>({...element(),dataset:{page}})):s==='[data-status]'?['ALL','OPEN','INVESTIGATING','CONTAINED'].map(status=>({...element(),dataset:{status}})):[]};
  const ctx=vm.createContext({document,window:{addEventListener:(k,fn)=>winEvents.set(k,fn)},location:{protocol,hostname,hash:'#lab'},Date,Intl,structuredClone,AbortController,Blob,
    URL:{createObjectURL:()=>'',revokeObjectURL(){}},localStorage:{getItem:k=>local.get(k)??null,setItem:(k,v)=>local.set(k,v)},
    setTimeout:(fn,ms)=>{const timer=setTimeout(fn,ms);timers.add(timer);return timer},clearTimeout,
    fetch:async(path,options)=>{calls.push({path,options});if(fetcher)return fetcher(path,options);throw Error('No fetch expected')},timeoutMs});
  for(const name of ['local-api.js','lab-api.js','app.js'])vm.runInContext(files[name],ctx);
  if(timeoutMs)vm.runInContext('const originalLabFactory=LabApi.create;LabApi.create=()=>originalLabFactory({timeoutMs})',ctx);
  vm.runInContext(files['lab-ui.js'],ctx);
  t.after(()=>{vm.runInContext("LabUI.onPage('overview')",ctx);for(const timer of timers)clearTimeout(timer)});
  return{elements,calls,local,ctx,run:s=>vm.runInContext(s,ctx),click:id=>get(id).click(),set:(id,value)=>{get(id).value=value},pagehide:()=>winEvents.get('pagehide')()};
}
async function fixture(t){
  const dir=await mkdtemp(join(tmpdir(),'keyguard-lab-ui-')),file=join(dir,'lab.json'),events=join(dir,'events.jsonl');
  const server=await createLocalServer({operatorSecret:operator,keyStore:createKeyStore({file}),store:createEventStore({file:events})});server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true})});
  const base=`http://127.0.0.1:${server.address().port}`;
  return{file,events,fetcher:(path,options)=>fetch(base+path,options)};
}
async function connect(h){h.set('lab-operator',operator);await h.click('lab-connect')}
async function issue(h){await h.click('lab-issue');return h.click('lab-confirm-yes')}

test('real HTTP UI: explicit confirmations, 200/401 lifecycle, separate audit and memory-only credentials',async t=>{
  const f=await fixture(t),h=harness(t,{fetcher:f.fetcher});assert.equal(h.calls.length,0);
  await connect(h);assert.equal(h.elements.get('lab-operator').value,'');
  await h.click('lab-issue');assert.equal(h.calls.filter(c=>c.options.method==='POST').length,0);
  const first=h.click('lab-confirm-yes');await h.click('lab-confirm-yes');await first;
  assert.equal(h.calls.filter(c=>c.path==='/api/lab/keys/issue').length,1);
  const masked=h.elements.get('lab-issued-key').textContent;assert.match(masked,/원문 보기/);assert.doesNotMatch(masked,/^kg-lab-/);
  await h.click('lab-issued-key');const revealed=h.elements.get('lab-issued-key').textContent,raw=revealed.split('\n')[0];assert.match(raw,/^kg-lab-/);assert.match(revealed,/원문 가리기/);
  await h.click('lab-issued-key');assert.ok(!h.elements.get('lab-issued-key').textContent.includes(raw));
  await h.click('lab-verify-current');assert.match(h.elements.get('lab-verification').textContent,/신규 테스트 키: HTTP 200 인증 성공/);
  await h.click('lab-revoke');assert.match(h.elements.get('lab-confirm-text').textContent,/폐기하시겠습니까/);
  assert.equal(h.calls.filter(c=>c.path==='/api/lab/keys/revoke').length,0);
  await h.click('lab-confirm-yes');await h.click('lab-verify-previous');assert.match(h.elements.get('lab-verification').textContent,/기존 테스트 키: HTTP 401 인증 거부 · 폐기된 기존 키 확인/);
  await issue(h);await h.click('lab-verify-current');assert.match(h.elements.get('lab-verification').textContent,/HTTP 200 인증 성공/);
  await h.click('lab-verify-previous');assert.match(h.elements.get('lab-verification').textContent,/HTTP 401 인증 거부 · 폐기된 기존 키 확인/);
  assert.equal(h.run('state.audit.length'),4);assert.match(h.elements.get('lab-audit-body').innerHTML,/REISSUE/);
  assert.ok(!h.elements.get('lab-audit-body').innerHTML.includes(raw));assert.ok(!JSON.stringify([...h.local]).includes(raw));assert.ok(!JSON.stringify([...h.local]).includes(operator));
  h.run('run()');assert.equal(h.run('state.audit.length'),6);assert.equal(h.run('state.incidents.length'),6);
  assert.equal(await readFile(f.events,'utf8'),'');
  h.run("go('overview')");assert.equal(h.elements.get('lab-issued-key').textContent,'');assert.equal(h.elements.get('lab-operator').value,'');
});

test('issue response loss is unknown, never auto-retried; status/audit reconcile but cannot recover raw key',async t=>{
  const f=await fixture(t);let lose=true;
  const h=harness(t,{fetcher:async(path,options)=>{const response=await f.fetcher(path,options);if(lose&&path==='/api/lab/keys/issue'){await response.json();throw Error('lost private-path-token')}return response}});
  await connect(h);await issue(h);
  assert.match(h.elements.get('lab-status').textContent,/확인 불가/);assert.match(h.elements.get('lab-verification').textContent,/확인 불가/);
  assert.equal(h.elements.get('lab-issue').disabled,true);assert.equal(h.calls.filter(c=>c.path==='/api/lab/keys/issue').length,1);
  assert.equal(h.elements.get('lab-issued-key').textContent,'');assert.ok(!h.elements.get('lab-status').textContent.includes('private-path-token'));
  lose=false;await h.click('lab-refresh');assert.match(h.elements.get('lab-status').textContent,/원문은 재조회할 수 없습니다/);
  assert.equal(h.elements.get('lab-issue').disabled,true);assert.equal(h.elements.get('lab-revoke').disabled,false);
  const disk=JSON.parse(await readFile(f.file,'utf8'));assert.equal(disk.keys.length,1);assert.equal(disk.audit.length,1);
});

test('leaving during issue cancels and ignores late credentials; explicit reauthentication is required',async t=>{
  const f=await fixture(t);let release,committed;
  const done=new Promise(resolve=>committed=resolve);
  const h=harness(t,{fetcher:async(path,options)=>{const response=await f.fetcher(path,path==='/api/lab/keys/issue'?{...options,signal:undefined}:options);if(path==='/api/lab/keys/issue')return new Promise(resolve=>{release=()=>resolve(response);committed()});return response}});
  await connect(h);await h.click('lab-issue');const pending=h.click('lab-confirm-yes');
  await done;
  h.run("go('overview')");await pending;
  assert.equal(h.elements.get('lab-issued-key').textContent,'');assert.equal(h.elements.get('lab-operator').value,'');
  // If fetch ignored abort and finished, its one-time credential still cannot update the page.
  release();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.elements.get('lab-issued-key').textContent,'');assert.equal(h.elements.get('lab-issue').disabled,true);
});

test('timeout is unknown, double-clicks and confirmations cannot trigger an automatic retry',async t=>{
  const f=await fixture(t);const signals=[];
  const h=harness(t,{timeoutMs:200,fetcher:(path,options)=>{
    if(path==='/api/lab/keys/issue'){signals.push(options.signal);return new Promise(()=>{})}return f.fetcher(path,options);
  }});
  await connect(h);await issue(h);
  assert.match(h.elements.get('lab-status').textContent,/확인 불가.*시간이 초과/);
  assert.ok(signals.every(s=>s.aborted));assert.equal(h.calls.filter(c=>c.path.endsWith('/issue')).length,1);
  assert.equal(h.elements.get('lab-revoke').disabled,true);
  await h.click('lab-refresh');assert.equal(h.elements.get('lab-issue').disabled,false);
});

test('operator failure, disabled service, invalid JSON and audit/state errors are safe and block mutations',async t=>{
  for(const [code,label] of [['OPERATOR_UNAUTHORIZED',/인증에 실패/],['LAB_DISABLED',/비활성화/],['LAB_AUDIT_CORRUPT',/감사 기록/],['KEY_STATE_CORRUPT',/키 상태/],['LAB_TRANSACTION_FAILED',/공동 저장/]]){
    const h=harness(t,{fetcher:async()=>({ok:false,status:code==='OPERATOR_UNAUTHORIZED'?401:503,headers:{get:()=> 'application/json'},json:async()=>({error:{code,message:'private-stack-path'}})})});
    await connect(h);assert.match(h.elements.get('lab-status').textContent,label);assert.ok(!h.elements.get('lab-status').textContent.includes('private-stack-path'));assert.equal(h.elements.get('lab-issue').disabled,true);
  }
  const invalid=harness(t,{fetcher:async()=>({ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>({keys:'wrong'})})});await connect(invalid);assert.match(invalid.elements.get('lab-status').textContent,/형식이 올바르지/);
});

test('Pages/file contexts disable key controls without API requests; pagehide forgets passwords',async t=>{
  for(const [protocol,hostname] of [['file:',''],['https:','ydb721.github.io']]){
    const h=harness(t,{protocol,hostname});h.set('lab-operator',operator);await h.click('lab-connect');
    assert.equal(h.calls.length,0);assert.equal(h.elements.get('lab-controls').hidden,true);assert.equal(h.elements.get('lab-unavailable').hidden,false);
    h.run('run()');assert.equal(h.run('state.incidents.length'),6);
    h.pagehide();assert.equal(h.elements.get('lab-operator').value,'');
  }
});

test('lab client uses same-origin protected POST and header-only verification without storing secrets',async t=>{
  const f=await fixture(t),h=harness(t,{fetcher:f.fetcher});await connect(h);await issue(h);await h.click('lab-verify-current');
  for(const {path,options} of h.calls){
    assert.ok(path.startsWith('/api/lab/'));assert.ok(!path.includes(operator));assert.ok(!path.includes('kg-lab-'));
    assert.equal(options.credentials,'omit');assert.equal(options.cache,'no-store');assert.equal(options.mode,'same-origin');assert.equal(options.redirect,'error');
    if(options.method==='POST'){assert.equal(options.headers['Content-Type'],'application/json');assert.equal(options.headers['X-KeyGuard-Operator'],operator);assert.equal(JSON.parse(options.body).confirm,true);assert.ok(!options.body.includes(operator))}
    if(path==='/api/lab/resource'){assert.match(options.headers.Authorization,/^Bearer kg-lab-/);assert.equal(options.headers['X-KeyGuard-Operator'],undefined)}
  }
  assert.ok(!files['lab-api.js'].includes(operator));assert.ok(!files['lab-ui.js'].includes(operator));
});
