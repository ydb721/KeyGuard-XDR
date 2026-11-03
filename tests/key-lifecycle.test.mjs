import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm, mkdir, open, rename, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createKeyStore } from '../key-store.mjs';
import { createEventStore } from '../event-store.mjs';
import { createLocalServer, DEMO_TOKEN } from '../server.mjs';

const operator = randomBytes(32).toString('base64url');
const credentials = {'X-KeyGuard-Operator':operator};
function request(port,path,{method='GET',headers={},value,raw,chunks}={}) {
  return new Promise((resolve,reject)=>{
    const req=http.request({hostname:'127.0.0.1',port,path,method,headers:{...(value!==undefined?{'Content-Type':'application/json'}:{}),...headers}},res=>{
      let text='';res.on('data',b=>text+=b);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text,body:text?JSON.parse(text):null}));
    });req.on('error',reject);
    if(chunks){for(const chunk of chunks)req.write(chunk);req.end()}
    else req.end(raw??(value!==undefined?JSON.stringify(value):undefined));
  });
}
async function fixture(t,{secret=operator,content,io,maxBytes,wrap}={}){
  const dir=await mkdtemp(join(tmpdir(),'keyguard-keys-')),file=join(dir,'lab-state.json'),events=join(dir,'events.jsonl');
  if(content!==undefined)await writeFile(file,content);
  const keyStore=createKeyStore({file,io,maxBytes});
  const server=await createLocalServer({store:createEventStore({file:events}),keyStore:wrap?wrap(keyStore):keyStore,operatorSecret:secret});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true})});
  const port=server.address().port;
  const get=(path,options)=>request(port,path,options);
  const status=()=>get('/api/lab/keys/status',{headers:credentials});
  const audit=()=>get('/api/lab/audit?limit=100',{headers:credentials});
  const issue=()=>get('/api/lab/keys/issue',{method:'POST',headers:credentials,value:{confirm:true}});
  const revoke=keyId=>get('/api/lab/keys/revoke',{method:'POST',headers:credentials,value:{confirm:true,keyId}});
  const verify=token=>get('/api/lab/resource',{headers:token?{Authorization:`Bearer ${token}`}:{}});
  return{dir,file,events,port,get,status,audit,issue,revoke,verify,keyStore,server};
}

test('lab stays disabled without valid operator configuration while legacy demo token remains unchanged',async t=>{
  for(const secret of [null,'short',DEMO_TOKEN]){
    const f=await fixture(t,{secret});
    assert.equal((await f.issue()).body.error.code,'LAB_DISABLED');
    assert.equal((await f.verify()).status,503);
    await assert.rejects(readFile(f.file),{code:'ENOENT'});
    assert.equal((await f.get('/api/test/resource',{headers:{Authorization:`Bearer ${DEMO_TOKEN}`}})).status,200);
  }
});

test('managed lifecycle: issue 200, unknown 401, revoke 401, reissue 200 and old key remains 401 with safe audits',async t=>{
  const f=await fixture(t),a=await f.issue();assert.equal(a.status,201);
  assert.match(a.body.token,/^kg-lab-[A-Za-z0-9_-]{43}$/);
  assert.equal((await f.verify(a.body.token)).status,200);
  assert.equal((await f.verify('kg-lab-'+randomBytes(32).toString('base64url'))).status,401);
  assert.equal((await f.revoke(a.body.key.keyId)).status,200);
  assert.equal((await f.verify(a.body.token)).status,401);
  const b=await f.issue();assert.equal(b.status,201);assert.notEqual(b.body.token,a.body.token);
  assert.equal((await f.verify(b.body.token)).status,200);assert.equal((await f.verify(a.body.token)).status,401);
  const state=(await f.status()).body,log=(await f.audit()).body;
  assert.equal(state.keys.length,2);assert.equal(state.keys[0].status,'REVOKED');assert.equal(state.activeKeyId,b.body.key.keyId);
  assert.equal(log.count,8);assert.equal(log.audit.filter(a=>a.action==='REVOKE').length,1);assert.equal(log.audit.filter(a=>a.action==='REISSUE').length,1);
  assert.equal(new Set(log.audit.map(a=>a.auditId)).size,8);
  assert.ok(log.audit.every(a=>a.requestId===a.actionId&&a.actor===(a.action==='VERIFY'?'local-test-client':'local-operator')));
  const disk=await readFile(f.file,'utf8'),observable=disk+JSON.stringify(state)+JSON.stringify(log);
  for(const secret of [operator,a.body.token,b.body.token,'Authorization'])assert.ok(!observable.includes(secret));
  assert.ok(disk.includes(createHash('sha256').update(a.body.token).digest('hex')));
  assert.ok(!JSON.stringify(state).includes('hash'));assert.equal(await readFile(f.events,'utf8'),'');
  assert.equal((await f.get('/data/lab-state.json')).status,404);assert.equal((await f.get('/key-store.mjs')).status,404);
  assert.equal((await f.audit()).headers['cache-control'],'no-store');
  assert.match(execFileSync('git',['check-ignore','data/lab-state.json','data/.lab-state-check.tmp'],{encoding:'utf8'}),/lab-state.json/);
});

test('operator permissions, exact Origin, JSON/body limits, confirmation and methods block unauthorized changes',async t=>{
  const f=await fixture(t),before=await readFile(f.file);
  for(const headers of [{},{'X-KeyGuard-Operator':DEMO_TOKEN},{'X-KeyGuard-Operator':'wrong'}]){
    for(const path of ['/api/lab/keys/status','/api/lab/audit'])assert.equal((await f.get(path,{headers})).status,401);
    for(const path of ['/api/lab/keys/issue','/api/lab/keys/revoke'])assert.equal((await f.get(path,{method:'POST',headers,value:{confirm:true}})).status,401);
  }
  for(const Origin of ['https://external.invalid','null',`http://localhost:${f.port}`])assert.equal((await f.get('/api/lab/keys/issue',{method:'POST',headers:{...credentials,Origin},value:{confirm:true}})).status,403);
  assert.equal((await f.get('/api/lab/keys/status',{headers:{...credentials,Origin:`http://127.0.0.1:${f.port}`}})).status,200);
  assert.equal((await f.get('/api/lab/keys/issue',{headers:credentials})).status,405);
  assert.equal((await f.get('/api/lab/keys/issue',{method:'POST',headers:credentials,raw:'{}'})).status,415);
  for(const value of [{},{confirm:false},{confirm:true,token:'never-echo'}])assert.equal((await f.get('/api/lab/keys/issue',{method:'POST',headers:credentials,value})).status,400);
  assert.equal((await f.get('/api/lab/keys/issue',{method:'POST',headers:{...credentials,'Content-Type':'application/json'},raw:'{broken'})).status,400);
  assert.equal((await f.get('/api/lab/keys/issue',{method:'POST',headers:{...credentials,'Content-Type':'application/json','Content-Length':'1025'},raw:'x'.repeat(1025)})).status,413);
  assert.equal((await f.get('/api/lab/keys/issue',{method:'POST',headers:{...credentials,'Content-Type':'application/json'},chunks:['x'.repeat(700),'x'.repeat(700)]})).status,413);
  assert.equal((await f.get('/api/lab/keys/status?token=never-echo',{headers:credentials})).status,400);
  assert.equal((await f.get('/api/lab/missing',{headers:credentials})).status,404);
  assert.deepEqual(await readFile(f.file),before);
});

test('concurrent issues and revokes serialize to one active key and one audit per transition',async t=>{
  const f=await fixture(t);const issued=await Promise.all(Array.from({length:12},()=>f.issue()));
  assert.equal(issued.filter(r=>r.status===201).length,1);assert.equal(issued.filter(r=>r.status===409).length,11);
  const key=issued.find(r=>r.status===201).body.key;
  const revoked=await Promise.all(Array.from({length:12},()=>f.revoke(key.keyId)));
  assert.equal(revoked.filter(r=>r.status===200).length,1);assert.equal(revoked.filter(r=>r.status===409).length,11);
  const prior=await readFile(f.file);assert.equal((await f.revoke(key.keyId)).body.error.code,'KEY_ALREADY_REVOKED');assert.deepEqual(await readFile(f.file),prior);
  const next=await f.issue();const races=await Promise.all([f.revoke(next.body.key.keyId),f.issue()]);
  assert.equal(races[0].status,200);assert.ok([201,409].includes(races[1].status));
  const state=(await f.status()).body;assert.ok(state.keys.filter(k=>k.status==='ACTIVE').length<=1);
  assert.equal(state.keys.find(k=>k.keyId===key.keyId).status,'REVOKED');
  assert.equal((await f.audit()).body.audit.filter(a=>a.action==='REVOKE'&&a.keyId===key.keyId).length,1);
});

test('malformed key state and corrupt audit history fail closed, preserve original bytes and leave old APIs usable',async t=>{
  const seed=await fixture(t);await seed.issue();const state=JSON.parse(await readFile(seed.file,'utf8'));
  const keyBad=structuredClone(state);delete keyBad.keys[0].hash;
  const auditBad=structuredClone(state);auditBad.audit.push(auditBad.audit[0]);auditBad.revision++;
  const missingAudit=structuredClone(state);missingAudit.audit=[];missingAudit.revision=0;
  for(const [content,code] of [['{broken','KEY_STATE_CORRUPT'],[JSON.stringify(keyBad),'KEY_STATE_CORRUPT'],[JSON.stringify(auditBad),'LAB_AUDIT_CORRUPT'],[JSON.stringify(missingAudit),'LAB_AUDIT_CORRUPT']]){
    const f=await fixture(t,{content});
    for(const result of [await f.status(),await f.issue(),await f.verify('unknown')]){assert.equal(result.status,503);assert.equal(result.body.error.code,code);assert.ok(!result.text.includes(f.file))}
    assert.equal(await readFile(f.file,'utf8'),content);assert.equal((await f.get('/api/health')).status,200);
  }
});

test('temporary write/sync failures never acknowledge issue or change either state or audit',async t=>{
  for(const phase of ['write','sync']){
    let fault=false;
    const f=await fixture(t,{io:{open:async(path,flags,mode)=>{
      const handle=await open(path,flags,mode);if(!path.endsWith('.tmp')||!fault)return handle;
      return{writeFile:async bytes=>{if(phase==='write'){await handle.writeFile(bytes.subarray(0,9));throw Error('private-secret')}await handle.writeFile(bytes)},sync:async()=>{if(phase==='sync')throw Error('private-secret');await handle.sync()},close:()=>handle.close()};
    }}});
    const before=await readFile(f.file);fault=true;const r=await f.issue();
    assert.equal(r.status,503);assert.equal(r.body.error.code,'LAB_TRANSACTION_FAILED');assert.ok(!r.text.includes('private-secret'));
    assert.deepEqual(await readFile(f.file),before);assert.equal((await readdir(f.dir)).filter(n=>n.endsWith('.tmp')).length,0);
  }
});

test('failed rename or error after atomic replacement reports uncertain commit without split state/audit',async t=>{
  for(const after of [false,true]){
    let fault=false;
    const f=await fixture(t,{io:{rename:async(from,to)=>{if(!fault)return rename(from,to);if(after)await rename(from,to);throw Error('private-rename')}}});
    const before=await readFile(f.file);fault=true;const r=await f.issue();assert.equal(r.status,503);assert.equal(r.body.error.code,'LAB_COMMIT_UNCERTAIN');
    const reopened=createKeyStore({file:f.file});await reopened.initialize();const state=await reopened.status(),log=await reopened.audit(100);
    assert.equal(state.keys.length,after?1:0);assert.equal(log.count,after?1:0);
    if(!after)assert.deepEqual(await readFile(f.file),before);
    if(after)await assert.rejects(reopened.issue(),err=>err.code==='ACTIVE_KEY_EXISTS');
  }
});

test('lab capacity and runtime storage failure prevent successful authentication and preserve history',async t=>{
  const seed=await fixture(t);const issued=await seed.issue(),content=await readFile(seed.file,'utf8');
  const full=await fixture(t,{content,maxBytes:Buffer.byteLength(content)+1});
  const r=await full.verify(issued.body.token);assert.equal(r.status,503);assert.equal(r.body.error.code,'LAB_STORE_FULL');assert.equal(await readFile(full.file,'utf8'),content);
  const backup=join(seed.dir,'backup.json');await rename(seed.file,backup);await mkdir(seed.file);
  assert.equal((await seed.verify(issued.body.token)).status,503);assert.equal(await readFile(backup,'utf8'),content);
});

test('HTTP response loss after issue does not imply rollback or permit a second active key',async t=>{
  let dropped,committed;
  const done=new Promise(resolve=>committed=resolve);
  const f=await fixture(t,{wrap:store=>({...store,issue:async()=>{const result=await store.issue();dropped.destroy();committed();return result}})});
  await new Promise(resolve=>{
    dropped=http.request({hostname:'127.0.0.1',port:f.port,path:'/api/lab/keys/issue',method:'POST',headers:{...credentials,'Content-Type':'application/json'}},()=>assert.fail('response should be lost'));
    dropped.on('error',resolve);dropped.end(JSON.stringify({confirm:true}));
  });await done;
  assert.equal((await f.status()).body.keys.length,1);assert.equal((await f.audit()).body.count,1);
  await assert.rejects(f.keyStore.issue(),err=>err.code==='ACTIVE_KEY_EXISTS');
});

test('separate lab server processes preserve revoked keys and audit history across restart',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'keyguard-lab-restart-')),file=join(dir,'lab-state.json'),events=join(dir,'events.jsonl'),children=[];
  let logs='';t.after(async()=>{await Promise.all(children.map(c=>c.stop()));await rm(dir,{recursive:true,force:true})});
  async function start(){
    const code=`import{createLocalServer}from'./server.mjs';import{createKeyStore}from'./key-store.mjs';import{createEventStore}from'./event-store.mjs';const s=await createLocalServer({store:createEventStore({file:process.env.KG_EVENTS}),keyStore:createKeyStore({file:process.env.KG_KEYS}),operatorSecret:process.env.KEYGUARD_OPERATOR_SECRET});process.on('message',m=>{if(m==='stop')s.close(()=>process.disconnect())});s.listen(0,'127.0.0.1',()=>process.send({port:s.address().port}));`;
    const child=spawn(process.execPath,['--input-type=module','-e',code],{cwd:new URL('..',import.meta.url),env:{...process.env,KG_KEYS:file,KG_EVENTS:events,KEYGUARD_OPERATOR_SECRET:operator},stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});
    child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
    let closed=false,stopping;const completion=new Promise(resolve=>child.once('close',()=>{closed=true;resolve()}));
    const stop=()=>stopping??=(async()=>{if(closed)return;const timer=setTimeout(()=>child.kill(),3000);try{if(child.connected)child.send('stop');else child.kill();await completion}finally{clearTimeout(timer)}})();children.push({stop});
    const port=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('LAB_START_TIMEOUT')),8000);child.once('error',reject);child.once('message',m=>{clearTimeout(timer);Number.isInteger(m.port)&&m.port>0?resolve(m.port):reject(Error('INVALID_PORT'))})});
    return{port,stop};
  }
  const a=await start();const call=(port,path,method='GET',value)=>request(port,path,{method,headers:credentials,value});
  const issued=await call(a.port,'/api/lab/keys/issue','POST',{confirm:true});assert.equal(issued.status,201);
  await call(a.port,'/api/lab/keys/revoke','POST',{confirm:true,keyId:issued.body.key.keyId});await a.stop();
  const b=await start();assert.equal((await request(b.port,'/api/lab/resource',{headers:{Authorization:`Bearer ${issued.body.token}`}})).status,401);
  assert.equal((await call(b.port,'/api/lab/audit')).body.count,3);
  const next=await call(b.port,'/api/lab/keys/issue','POST',{confirm:true});assert.equal(next.status,201);
  assert.equal((await request(b.port,'/api/lab/resource',{headers:{Authorization:`Bearer ${next.body.token}`}})).status,200);
  assert.equal((await request(b.port,'/api/lab/resource',{headers:{Authorization:`Bearer ${issued.body.token}`}})).status,401);
  await b.stop();for(const value of [operator,issued.body.token,next.body.token,'Authorization'])assert.ok(!logs.includes(value));
});
