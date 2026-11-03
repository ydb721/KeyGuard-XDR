import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const app=readFileSync(resolve(root,'app.js'),'utf8');
const read=name=>readFileSync(resolve(root,name),'utf8');

function element(id='') {
 const classes=new Set();
 return {id,innerHTML:'',textContent:'',value:'',disabled:false,hidden:false,dataset:{},classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),toggle:(x,on)=>{if(on===undefined){classes.has(x)?classes.delete(x):classes.add(x);return classes.has(x)}on?classes.add(x):classes.delete(x);return on},contains:x=>classes.has(x)},setAttribute(name,value){this[name]=String(value)},removeAttribute(name){delete this[name]},addEventListener(){},click(){},remove(){}};
}

function harness(savedTheme=null,hash='') {
 const items=new Map(),local=new Map(savedTheme?[['keyguard-xdr-theme-v0.1',savedTheme]]:[]);
 const get=id=>{if(!items.has(id))items.set(id,element(id));return items.get(id)};
 const pages=['overview','incidents','lab'].map(id=>get(`page-${id}`));
 const nav=['overview','incidents','lab'].map(page=>Object.assign(element(),{dataset:{page}}));
 const statuses=['ALL','OPEN','INVESTIGATING','CONTAINED'].map(status=>Object.assign(element(),{dataset:{status}}));
 const document={body:{dataset:{theme:'light'}},getElementById:get,querySelectorAll(selector){if(selector==='.page')return pages;if(selector==='[data-page]')return nav;if(selector==='[data-status]')return statuses;return[]},addEventListener(){},createElement:()=>element()};
 const context=vm.createContext({document,window:{addEventListener(){},scrollTo(){}},localStorage:{getItem:k=>local.get(k)??null,setItem:(k,v)=>local.set(k,v)},location:{hash},console,Date,Intl,structuredClone,setTimeout:()=>1,clearTimeout(){},Blob,URL:{createObjectURL:()=>'',revokeObjectURL(){}}});
 vm.runInContext(app,context);
 return {items,local,ctx:context,run:code=>vm.runInContext(code,context)};
}

test('initial v0.1.0 demo dataset is preserved and rendered in v0.1.1',()=>{
 const h=harness();
 assert.equal(h.run('state.incidents.length'),5);
 assert.equal(h.run('state.audit.length'),4);
 assert.match(h.items.get('metric-grid').innerHTML,/조사 대기 사고/);
 assert.match(h.items.get('metric-grid').innerHTML,/metric-value">3/);
 assert.match(h.items.get('queue-body').innerHTML,/KG-0214/);
 assert.match(h.items.get('incident-detail').innerHTML,/KG-CRED-01/);
 assert.match(h.items.get('incident-detail').innerHTML,/테스트 키 식별자/);
 assert.match(h.items.get('incident-detail').innerHTML,/billing-api/);
});

test('simulation creates an incident, updates KPI and records audit events',()=>{
 const h=harness();h.run('run()');
 assert.equal(h.run('state.incidents.length'),6);
 assert.equal(h.run('state.audit.length'),6);
 assert.equal(h.run('state.incidents[0].asset'),'demo-payment-api');
 assert.match(h.items.get('metric-grid').innerHTML,/metric-value">4/);
 assert.match(h.items.get('incident-detail').innerHTML,/demo-payment-api/);
 assert.match(h.items.get('lab-output').innerHTML,/모의 사고가 생성되었습니다/);
});

test('search, status and severity filters execute against incident state',()=>{
 const h=harness();
 h.run("state.search='no-such-incident';incidents()");
 assert.match(h.items.get('incident-body').innerHTML,/검색 조건에 맞는 사고가 없습니다/);
 h.run("state.search='';state.status='CONTAINED';incidents()");
 assert.match(h.items.get('incident-body').innerHTML,/KG-0211/);
 assert.doesNotMatch(h.items.get('incident-body').innerHTML,/KG-0214/);
 h.run("state.status='ALL';state.severity='HIGH';incidents()");
 assert.match(h.items.get('incident-body').innerHTML,/KG-0214/);
 assert.doesNotMatch(h.items.get('incident-body').innerHTML,/KG-0212/);
});

test('investigation and response mutate state once and append observable audit records',()=>{
 const h=harness();h.run('run()');
 const id=h.run('state.last');
 h.run(`change('${id}','INVESTIGATING')`);
 assert.equal(h.run(`state.incidents.find(x=>x.id==='${id}').status`),'INVESTIGATING');
 assert.equal(h.run('state.audit.length'),7);
 h.run(`change('${id}','CONTAINED')`);
 assert.equal(h.run(`state.incidents.find(x=>x.id==='${id}').status`),'CONTAINED');
 assert.equal(h.run('state.audit.length'),8);
 h.run(`change('${id}','CONTAINED')`);
 assert.equal(h.run('state.audit.length'),8);
 assert.match(h.items.get('lab-output').innerHTML,/실제 API 요청 차단 여부: 미검증/);
 assert.match(h.items.get('audit-body').innerHTML,/RESPONSE/);
});

test('reset restores the documented seed data',()=>{
 const h=harness();h.run('run()');h.run('state=start();render()');
 assert.equal(h.run('state.incidents.length'),5);
 assert.equal(h.run('state.audit.length'),4);
 assert.match(h.items.get('queue-body').innerHTML,/KG-0210/);
});

test('theme selection persists and legacy hashes map to the unified pages',()=>{
 const h=harness();assert.equal(h.ctx.document.body.dataset.theme,'light');
 h.run("theme('dark')");assert.equal(h.ctx.document.body.dataset.theme,'dark');assert.equal(h.local.get('keyguard-xdr-theme-v0.1'),'dark');
 const restored=harness('dark');assert.equal(restored.ctx.document.body.dataset.theme,'dark');assert.equal(restored.items.get('theme-label').textContent,'라이트 모드');
 for(const [hash,location] of [['#rules','Investigate'],['#assets','Investigate'],['#audit','Respond & Verify'],['#unknown','Detect']]){const legacy=harness(null,hash);assert.equal(legacy.items.get('top-location').textContent,location)}
});

test('same-origin read-only API safety and minimal navigation contracts remain explicit',async()=>{
 const html=read('index.html'),css=read('styles.css');
 assert.equal((html.match(/data-page=/g)||[]).length,3);
 const calls=[];
 const ctx=vm.createContext({AbortController,setTimeout,clearTimeout,Date,fetch:async(path,options)=>{
  calls.push({path,options});
  const body=path==='/api/health'?{status:'ok',version:'0.4.0',scope:'localhost-education-only'}:path.startsWith('/api/events')?{events:[],count:0,limit:100}:{detections:[],count:0,limit:100};
  return{ok:true,headers:{get:()=> 'application/json'},json:async()=>body};
 }});
 vm.runInContext(read('local-api.js'),ctx);await vm.runInContext('LocalApi.load()',ctx);
 assert.deepEqual(calls.map(c=>c.path),['/api/health','/api/events?limit=100','/api/detections?limit=100']);
 for(const {options} of calls){assert.equal(options.credentials,'omit');assert.equal(options.cache,'no-store');assert.equal(options.mode,'same-origin');assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.headers,undefined)}
 assert.match(css,/data-theme=light/);assert.match(css,/data-theme=dark/);
});
