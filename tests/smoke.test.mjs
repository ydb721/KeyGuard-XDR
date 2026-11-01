import { test } from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');

function harness(savedTheme=null){
 const listeners=new Map();const cache=new Map();
 const classes=()=>({add(){},remove(){},toggle(){}});
 const el=id=>({id,innerHTML:'',textContent:'',value:'',disabled:false,hidden:false,dataset:{},classList:classes(),setAttribute(name,value){this[name]=value},removeAttribute(){},addEventListener(e,fn){listeners.set(id+':'+e,fn)}});
 const items=new Map();
 const localCache=new Map(savedTheme?[['keyguard-xdr-theme-v0.1',savedTheme]]:[]);
 const document={body:{dataset:{theme:'light'}},getElementById(id){if(!items.has(id))items.set(id,el(id));return items.get(id)},querySelectorAll(){return[]},addEventListener(e,fn){listeners.set('document:'+e,fn)}};
 const window={scrollTo(){},addEventListener(e,fn){listeners.set('window:'+e,fn)}};
 const localStorage={getItem:k=>localCache.get(k)??null,setItem:(k,v)=>localCache.set(k,v)};
 const context=vm.createContext({document,window,localStorage,location:{hash:''},console,Date,Intl,structuredClone,setTimeout,clearTimeout,setInterval:()=>1,Blob,URL});
 vm.runInContext(readFileSync(resolve(root,'app.js'),'utf8'),context);
 return {ctx:context,items,cache:localCache,run:s=>vm.runInContext(s,context),listeners};
}

test('v0.1 renders original demo data and asset inventory',()=>{
 const h=harness();
 assert.equal(h.run('state.incidents.length'),5);
 assert.equal(h.run('state.audit.length'),4);
 assert.match(h.items.get('asset-count').textContent,/5건/);
 assert.match(h.items.get('metric-grid').innerHTML,/조치 대기 사고/);
 assert.match(h.items.get('asset-body').innerHTML,/billing-api/);
 assert.match(h.items.get('rules-body').innerHTML,/KG-CRED-01/);
});

test('simulation changes incidents, assets, audit and blocks duplicate response',()=>{
 const h=harness();
 h.run('runScenario()');
 assert.equal(h.run('state.incidents.length'),6);
 assert.equal(h.run('state.audit.length'),6);
 assert.match(h.items.get('asset-body').innerHTML,/demo-payment-api/);
 h.run('respondScenario()');
 assert.equal(h.run('state.incidents[0].status'),'CONTAINED');
 assert.equal(h.run('state.audit.length'),7);
 h.run('respondScenario()');
 assert.equal(h.run('state.audit.length'),7);
 assert.match(h.items.get('lab-output').innerHTML,/실제 키 폐기나 외부 API 차단 효과는 검증되지 않았습니다/);
});

test('incident and asset filtering and reset',()=>{
 const h=harness();
 h.run("state.assetFilter='Cloud';renderAssets()");
 assert.match(h.items.get('asset-count').textContent,/3건 \/ 총 5건/);
 h.run("state.assetSearch='not-a-real-asset';renderAssets()");
 assert.match(h.items.get('asset-body').innerHTML,/검색 조건에 맞는 자산이 없습니다/);
 h.run("state.search='no-such-incident';renderIncidents()");
 assert.match(h.items.get('incident-body').innerHTML,/검색 조건에 맞는 사건이 없습니다/);
 h.run('state=INITIAL_STATE();renderAll()');
 assert.equal(h.run('state.incidents.length'),5);
});

test('theme default, persisted dark, and switching',()=>{
 const a=harness();assert.equal(a.ctx.document.body.dataset.theme,'light');
 a.run("applyTheme('dark')");
 assert.equal(a.ctx.document.body.dataset.theme,'dark');
 assert.equal(a.cache.get('keyguard-xdr-theme-v0.1'),'dark');
 const b=harness('dark');assert.equal(b.ctx.document.body.dataset.theme,'dark');
 assert.equal(b.items.get('theme-label').textContent,'라이트 모드');
});

test('no external network request APIs in app and dark/light styles included',()=>{
 const app=readFileSync(resolve(root,'app.js'),'utf8');
 const css=readFileSync(resolve(root,'styles.css'),'utf8');
 assert.doesNotMatch(app,/\bfetch\s*\(|XMLHttpRequest|WebSocket\s*\(/);
 assert.match(css,/data-theme=dark/);
 assert.match(css,/data-theme=light/);
 assert.match(readFileSync(resolve(root,'index.html'),'utf8'),/KeyGuard XDR v0\.1/);
});
