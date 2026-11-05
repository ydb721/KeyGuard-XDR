'use strict';
// Local read-only API views and a separate browser-only simulation. No production response.
const BASE=[
 {id:'KG-0214',title:'Unusual API key activity',severity:'HIGH',status:'OPEN',asset:'billing-api',source:'API + Cloud',rule:'KG-CRED-01',ruleName:'Anomalous credential usage',mitre:'T1078 · Valid Accounts',detectedAt:'2026-11-01T10:47:00+09:00',evidence:['테스트 키 식별자의 짧은 시간 내 요청 횟수 증가','합성 기준과 다른 출처의 인증 성공 이벤트'],notes:'비정상 사용 정황만으로 키 유출을 확정할 수 없습니다.'},
 {id:'KG-0213',title:'Potential data exfiltration',severity:'HIGH',status:'OPEN',asset:'archive-service',source:'Cloud + Endpoint',rule:'KG-EXFIL-01',ruleName:'Unusual outbound transfer',mitre:'T1048 · Exfiltration Over Alternative Protocol',detectedAt:'2026-11-01T10:31:00+09:00',evidence:['합성 압축 파일 생성 이벤트','테스트 환경의 낯선 목적지로 대량 요청 발생'],notes:'실제 데이터 전송이 아닌 교육용 합성 로그입니다.'},
 {id:'KG-0212',title:'Repeated authentication failures',severity:'MEDIUM',status:'OPEN',asset:'identity-gateway',source:'API',rule:'KG-AUTH-01',ruleName:'Burst of authentication failures',mitre:'T1110 · Brute Force',detectedAt:'2026-11-01T10:06:00+09:00',evidence:['3분 동안 합성 로그인 실패 36건'],notes:'시험용 임계값을 적용했습니다.'},
 {id:'KG-0211',title:'Suspicious query payload',severity:'LOW',status:'CONTAINED',asset:'test-web-api',source:'API',rule:'KG-WEB-01',ruleName:'Input anomaly flag',mitre:'T1190 · Exploit Public-Facing Application',detectedAt:'2026-11-01T09:23:00+09:00',evidence:['합성 SQL 특수 패턴이 테스트 요청에서 관찰됨'],notes:'문자열 패턴만으로 실제 공격 성공을 입증하지 않습니다.'},
 {id:'KG-0210',title:'Unexpected privilege change',severity:'MEDIUM',status:'CONTAINED',asset:'sandbox-user-02',source:'Endpoint + Cloud',rule:'KG-PRIV-01',ruleName:'Unexpected role elevation',mitre:'T1098 · Account Manipulation',detectedAt:'2026-11-01T08:53:00+09:00',evidence:['테스트 계정의 역할 변경 이벤트 합성','같은 시각 관리 API 호출 시나리오 기록'],notes:'가상 계정의 역할 변경 시나리오이며 운영 권한은 변경하지 않습니다.'}
];
const BASE_AUDIT=[{id:'AU-004',time:'2026-11-01T10:47:03+09:00',type:'DETECTION',detail:'KG-CRED-01 · 샘플 인증정보 이상 사용 경고 생성',actor:'demo-engine'},{id:'AU-003',time:'2026-11-01T10:31:04+09:00',type:'DETECTION',detail:'KG-EXFIL-01 · 샘플 데이터 전송 이상 경고 생성',actor:'demo-engine'},{id:'AU-002',time:'2026-11-01T10:06:04+09:00',type:'DETECTION',detail:'KG-AUTH-01 · 샘플 인증 실패 경고 생성',actor:'demo-engine'},{id:'AU-001',time:'2026-11-01T09:23:04+09:00',type:'RESPONSE',detail:'KG-0211 · 시나리오 처리 기록',actor:'analyst-demo'}];
const SCENARIOS=[['credential','Credential Misuse','인증정보 이상 사용','HIGH','demo-payment-api','API + Cloud','KG-CRED-01','T1078 · Valid Accounts'],['brute','Brute Force','인증 실패 급증','MEDIUM','demo-identity-gateway','API','KG-AUTH-01','T1110 · Brute Force'],['exfiltration','Exfiltration','비정상 전송 징후','HIGH','demo-archive-service','Cloud + Endpoint','KG-EXFIL-01','T1048 · Exfiltration Over Alternative Protocol']];
const $=x=>document.getElementById(x),esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),stamp=()=>new Date().toISOString(),fmt=x=>new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(x));
function start(){return{incidents:structuredClone(BASE),audit:structuredClone(BASE_AUDIT),seq:214,auditSeq:4,selected:'KG-0214',scenario:'credential',last:null,status:'ALL',severity:'ALL',search:''}}let state=start(),timer;
const localEligible=typeof LocalApi!=='undefined'&&LocalApi.isLocalPage(location);
let dataMode=localEligible?'local':'demo',activePage=null;
const live={status:localEligible?'Loading':'Unavailable',events:[],detections:[],selected:null,search:'',severity:'ALL',lastSuccess:null,stale:false,message:'',generation:0,controller:null,pending:null};
function cancelLocal(){live.generation++;live.controller?.abort();live.controller=null;if(live.status==='Loading'){live.status=live.lastSuccess?'Connected':'Unavailable';live.stale=Boolean(live.lastSuccess);live.message='조회가 취소되었습니다. 새로고침으로 다시 조회하세요.'}}
function setSource(mode){cancelLocal();dataMode=mode==='local'&&localEligible&&current()!=='lab'?'local':'demo';render();if(dataMode==='local')return refreshLocal()}
async function refreshLocal(){
 if(dataMode!=='local'||!localEligible||current()==='lab')return;
 cancelLocal();const generation=live.generation,page=current(),controller=new AbortController();live.controller=controller;
 live.status='Loading';live.message='로컬 API 조회 중';live.stale=Boolean(live.lastSuccess);render();
 const pending=(async()=>{try{
  const result=await LocalApi.load({signal:controller.signal});
  if(generation!==live.generation||dataMode!=='local'||current()!==page)return;
  live.events=result.events;live.detections=result.detections;live.lastSuccess=stamp();live.stale=false;
  live.status=!result.events.length&&!result.detections.length?'Empty':'Connected';live.message='';
 }catch(error){
  if(generation!==live.generation||dataMode!=='local'||current()!==page)return;
  live.status=error.kind==='invalid'?'Invalid Response':error.kind==='unavailable'?'Unavailable':'Error';
  live.message=typeof error.kind==='string'?error.message:'조회에 실패했습니다. 다시 시도하세요.';live.stale=Boolean(live.lastSuccess);
 }finally{if(generation===live.generation&&current()===page){live.controller=null;render()}}})();
 live.pending=pending;return pending;
}
function renderSource(){
 const local=dataMode==='local',labPage=current()==='lab';
 $('data-source-controls').hidden=labPage||!localEligible;$('data-source').value=dataMode;$('local-source-option').disabled=!localEligible;
 $('refresh-local').hidden=!local;$('refresh-local').textContent=['Error','Unavailable','Invalid Response'].includes(live.status)?'다시 시도':'새로고침';
 $('connection-status').textContent=local?`${({Connected:'연결됨',Empty:'연결됨 · 기록 없음',Loading:'조회 중',Error:'조회 실패',Unavailable:'로컬 조회 불가','Invalid Response':'응답 오류'})[live.status]||'조회 전'}${live.message?' · '+live.message:''}${live.stale?' · 이전 조회 데이터이며 최신 상태가 아닙니다.':''}`:
  `시나리오 분석${localEligible?'':' · 실제 이벤트 조회는 로컬 서버에서 지원합니다.'}`;
 $('connection-status').dataset.status=local?live.status:'Simulation';$('source-diagnostics').hidden=!local;
 $('last-loaded').textContent=live.lastSuccess?`마지막 정상 조회: ${live.lastSuccess} · 이벤트/탐지 각각 최대 100건 · 전체 누적 건수 아님`:'조회 이력 없음';
 $('source-title').textContent=labPage?'로컬 테스트 키 · 시나리오 분석':local?'로컬 데이터':'시나리오 분석';
 $('source-description').textContent=local?'':'샘플 데이터 화면입니다. 실제 이벤트 탐지 및 키 관리는 로컬 서버에서 지원합니다.';$('source-description').hidden=local;
 $('mode-label').textContent=labPage?'테스트 키 · 시나리오 분석':local?'로컬 데이터':'시나리오 분석';$('reset-demo').hidden=local;
 $('incidents-source').textContent=local?'로컬 데이터':'샘플 데이터';$('sidebar-source').textContent=local?'로컬 데이터':'샘플 데이터';$('sidebar-source-note').textContent=local?'수집 기록':'브라우저 샘플 기록';$('sidebar-source-tag').textContent=local?'로컬':'샘플';
 $('status-filters').hidden=local;$('local-event-panel').hidden=!local;$('rule-summary').hidden=!local;
 $('queue-status-heading').textContent=local?'판정':'상태';$('case-status-heading').textContent=local?'판정':'상태';
 $('incident-search').value=local?live.search:state.search;
}
// Detect uses plain-language summaries; full rule names and IDs remain in Investigate.
const detectNames={'KG-R001':'짧은 시간에 인증 실패가 반복되었습니다','KG-R002':'인증 실패가 반복된 뒤 인증이 성공했습니다'};
function localRow(d,short=false){if(short)return `<tr data-detection="${esc(d.detectionId)}" data-rule="${esc(d.ruleId)}" tabindex="0" role="button" aria-label="${esc(detectNames[d.ruleId]||'확인이 필요한 보안 신호')} · 상세 근거 보기"><td><strong class="main-cell">${esc(detectNames[d.ruleId]||'확인이 필요한 보안 신호')}</strong><small class="table-secondary">대상: ${esc(d.assetId)} · 근거 ${d.eventCount}건</small></td><td><span class="sev ${esc(d.severity.toLowerCase())}">${({HIGH:'높음',MEDIUM:'보통',LOW:'낮음'})[d.severity]||'확인 필요'}</span></td><td><span class="source-chip">의심 신호</span></td><td class="date-cell">${fmt(d.detectedAt)}</td></tr>`;return `<tr data-detection="${esc(d.detectionId)}" tabindex="0" role="button"><td><strong class="main-cell">${esc(d.ruleName)}</strong><small class="table-secondary mono">${esc(d.detectionId)} · ${esc(d.ruleId)}</small></td><td>${sev(d.severity)}</td><td><span class="source-chip">의심 신호</span></td><td class="mono">${esc(d.assetId)}</td><td class="date-cell">${fmt(d.detectedAt)}</td></tr>`}
function detectPresentation(){
 const local=dataMode==='local',ready=Boolean(live.lastSuccess),overview=current()==='overview';
 const hasDetections=local?ready&&live.detections.length>0:state.incidents.length>0;
 const hasEvents=local&&ready&&live.events.length>0;
 document.body.dataset.page=current();
 $('detect-intro').hidden=!overview;$('detect-status').hidden=!local;$('source-banner').hidden=current()!=='lab';
 $('detect-source').textContent=local?'로컬 데이터':'샘플 데이터';
 // Labels explain the validated snapshot without changing requests or cancellation state.
 let kind='before',label='조회 전',title='아직 보안 기록을 조회하지 않았습니다.',description='새로고침으로 조회할 수 있습니다.';
 if(!local){kind='simulation';label='샘플 데이터';title='샘플 사고 기록';description=''}
 else if(live.status==='Loading'){kind='loading';label='조회 중';title='보안 기록 조회 중';description=ready?'이전 성공 결과를 표시하고 있습니다. 최신 결과가 아닙니다.':''}
 else if(live.stale&&ready){kind='stale';label='이전 조회 결과';title='마지막 성공 조회 결과만 표시합니다.';description=`${live.message||'최신 조회가 완료되지 않았습니다.'} 최신 상태가 아닙니다. 새로고침으로 다시 조회할 수 있습니다.`}
 else if(live.status==='Invalid Response'){kind='invalid';label='응답 오류';title='서버 응답 형식이 올바르지 않습니다.';description='호환되는 로컬 서버인지 확인한 뒤 새로고침으로 다시 조회할 수 있습니다.'}
 else if(['Error','Unavailable'].includes(live.status)&&live.message){kind='error';label='연결 실패';title='보안 기록을 조회하지 못했습니다.';description=live.message.includes('네트워크')?'로컬 서버가 실행 중인지 확인한 뒤 새로고침해 주세요.':live.message}
 else if(ready){
  kind=hasDetections?'findings':hasEvents?'events':'empty';label=hasDetections?'확인 필요':'정상 연결';
  title=hasDetections?`탐지 결과 ${live.detections.length}건`:hasEvents?'조회된 탐지 결과 없음':'수집된 이벤트 없음';
  description=hasDetections?'규칙에 따른 의심 신호입니다.':'';
 }
 $('detect-status').dataset.state=kind;
 $('detect-status').dataset.severity=local?['HIGH','MEDIUM','LOW'].find(level=>live.detections.some(d=>d.severity===level))||'':'';
 $('detect-status-label').textContent=label;$('detect-status-title').textContent=title;
 $('detect-status-description').textContent=description;$('detect-status-description').hidden=!description;
 $('detect-scope').textContent=local?`이벤트와 탐지 각각 최근 최대 100건 · 전체 누적 건수 아님 · ${ready?`마지막 성공 확인: ${new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'medium',timeStyle:'medium'}).format(new Date(live.lastSuccess))} (한국 시간)`:'마지막 성공 확인: 없음'}`:'데이터 출처: 샘플 데이터 · 실제 이벤트 탐지 및 키 관리는 로컬 서버에서 지원합니다.';
 $('detect-scope').hidden=!overview;
 $('detect-technical').hidden=!overview||(local&&!hasDetections&&!hasEvents);
 $('connection-status').hidden=overview||!local;
 $('last-loaded').hidden=overview||!local||!live.lastSuccess;
 // A zero/zero snapshot is explained once, above. Evidence outside the event range never hides detections.
 $('detect-results-panel').hidden=!hasDetections;$('detect-detail-link').hidden=!hasDetections;
 $('detect-table').hidden=!hasDetections;$('detect-empty').hidden=true;
 $('detect-empty-title').textContent='조회된 탐지 결과 없음';$('detect-empty-description').textContent='';
 $('local-event-panel').hidden=!hasEvents;$('event-empty').hidden=true;
 $('event-technical').hidden=!hasEvents;$('event-table').hidden=!hasEvents;
 $('event-empty-title').textContent='수집된 이벤트 없음';
}
function localOverview(){
 const ready=Boolean(live.lastSuccess),events=live.events,ds=live.detections;
 $('metric-grid').innerHTML=[['최근 조회 이벤트',events.length,'최대 100건 · 전체 누적 아님'],['조회된 탐지 결과',ds.length,'최대 100건 · 의심 신호'],['조회된 인증 실패',events.filter(e=>e.statusCode===401).length,'조회 이벤트 범위의 실패 수']].map(x=>`<article class="metric-card"><div class="metric-head">${x[0]}</div><div class="metric-value">${ready?x[1]:'—'}</div><div class="metric-footer">${x[2]}</div></article>`).join('');
 $('rule-summary').textContent=ready?['KG-R001','KG-R002'].map(rule=>`${rule}: ${ds.filter(d=>d.ruleId===rule).length}건`).join(' · '):'규칙별 결과: 아직 정상 조회하지 않았습니다.';
 $('queue-count').textContent=ready?`조회 ${ds.length}건`:'조회 미완료';
 $('queue-body').innerHTML=ds.map(d=>localRow(d,true)).join('')||`<tr><td colspan="4" class="empty-row">${ready?'조회 범위에 탐지 결과가 없습니다.':'조회가 완료되지 않았습니다. 연결 상태를 확인하세요.'}</td></tr>`;
 $('local-event-body').innerHTML=events.slice(0,10).map(e=>`<tr><td class="mono" data-label="이벤트 / 출처">${esc(e.eventId)}<small class="table-secondary">${esc(e.source)}</small></td><td data-label="결과 / 요청"><strong>${e.statusCode===401?'인증 실패':'인증 성공'}</strong><small class="table-secondary">${esc(e.method)} ${esc(e.path)}</small><small class="table-secondary">${esc(e.eventType)} · ${esc(e.outcome)}</small></td><td data-label="상태 코드">HTTP ${e.statusCode}</td><td data-label="시각 / 자산">${esc(e.timestamp)}<small class="table-secondary">${esc(e.assetId)}</small></td></tr>`).join('')||`<tr><td colspan="4" class="empty-row">${ready?'조회된 보안 이벤트가 없습니다.':'조회 미완료'}</td></tr>`;
 $('local-event-count').textContent=ready?`최근 ${Math.min(events.length,10)}건 표시 / 조회 ${events.length}건`:'조회 미완료';
}
function localIncidents(){
 $('severity-select').value=live.severity;
 const query=live.search.toLowerCase();const list=live.detections.filter(d=>(live.severity==='ALL'||d.severity===live.severity)&&`${d.detectionId} ${d.assetId} ${d.ruleId} ${d.ruleName}`.toLowerCase().includes(query));
 if(!list.some(d=>d.detectionId===live.selected))live.selected=list[0]?.detectionId;
 $('incident-body').innerHTML=list.map(d=>localRow(d)).join('')||`<tr><td colspan="5" class="empty-row">${live.lastSuccess?'조회 범위와 검색 조건에 맞는 탐지 결과가 없습니다.':'조회가 완료되지 않았습니다. 연결 상태를 확인하세요.'}</td></tr>`;
 $('incident-table-foot').textContent=`조회된 탐지 ${list.length}건 표시 · 로컬 데이터`;
 localDetail();
}
function localDetail(){
 const d=live.detections.find(d=>d.detectionId===live.selected);
 if(!d){$('incident-detail').textContent='선택할 로컬 탐지 결과가 없습니다.';return}
 const kv=(label,value,mono='')=>`<div class="kv"><small>${label}</small><strong class="${mono}">${esc(value)}</strong></div>`;
 const conditions={
  'KG-R001':'동일 자산에서 60초 분석 구간 내 인증 실패 5건',
  'KG-R002':'동일 자산에서 120초 분석 구간 내 실패 3건 이상 후 엄격히 나중 시각의 인증 성공',
  'KG-R003':'서로 다른 출처의 이상 징후가 5분 분석 구간 내 상관됨',
 };
 const evidence=d.evidenceEventIds.map(id=>{
  const e=live.events.find(e=>e.eventId===id),success=id===d.successEventId;
  return `<li><span class="evidence-icon">${success?'인증 성공':'이벤트'}</span><div class="evidence-copy"><strong class="mono">${esc(id)}</strong>${e?`<p>${esc(e.eventType)} · HTTP ${e.statusCode} · ${esc(e.timestamp)}</p>`:'<p>근거 이벤트 ID는 확인되었지만 현재 조회 범위에 상세 기록이 없습니다.</p>'}</div></li>`;
 }).join('');
 $('incident-detail').innerHTML=`<div class="detail-header"><div class="detail-overline mono">사고 ID · ${esc(d.detectionId)}</div><h2>${esc(d.ruleName)}</h2><div class="detail-badges">${sev(d.severity)} <span class="source-chip">로컬 데이터</span></div></div><div class="detail-section detail-evidence"><h3>탐지 근거</h3><ul class="evidence-list">${evidence}</ul><p class="detail-note">${esc(d.reason)}</p></div><div class="detail-section"><h3>상세 정보</h3><div class="kv-grid">${kv('자산',d.assetId,'mono')}${kv('규칙',d.ruleId,'mono')}${kv('탐지 시각 (UTC)',d.detectedAt,'mono')}${kv('분석 구간',`${d.analysisWindow.start} ~ ${d.analysisWindow.end}`,'mono')}${kv('규칙 조건',conditions[d.ruleId]||'이 규칙의 조건 정보가 없습니다.')}${kv('관찰 출처',d.observedSources.join(', '))}${kv('근거 이벤트 수',d.eventCount)}${kv('실패 횟수',d.failureCount)}${d.successEventId?kv('뒤따른 성공 이벤트',d.successEventId,'mono'):''}${kv('합성 Fixture 사용',d.synthetic?'예':'아니오 · 실제 로컬 HTTP 요청')}</div></div><div class="detail-section"><h3>한계 및 안내</h3><p class="detail-note">규칙 기반 의심 신호이며 실제 침해 확정이 아닙니다. 이 화면은 읽기 전용 탐지 근거 조회용이며 조사 상태를 저장하거나 시나리오 처리를 실행하지 않습니다. 로컬 테스트 키 변경과 HTTP 인증 검증은 대응 및 검증 화면에서 수행합니다.</p></div>`;
}
const sev=x=>`<span class="sev ${x.toLowerCase()}">${({HIGH:'높음',MEDIUM:'보통',LOW:'낮음'})[x]||esc(x)}</span>`,stat=x=>`<span class="stat ${x.toLowerCase()}">${({OPEN:'조사 대기',INVESTIGATING:'조사 중',CONTAINED:'시나리오 처리 완료'})[x]||esc(x)}</span>`;
function current(){let h=location.hash.slice(1);return ['overview','incidents','lab'].includes(h)?h:({rules:'incidents',assets:'incidents',audit:'lab'}[h]||'overview')}function nav(){let p=current();if(activePage!==p){cancelLocal();activePage=p;if(typeof LabUI!=='undefined')LabUI.onPage(p);if(p==='lab'){if(dataMode==='local')toast('대응 및 검증 화면으로 이동합니다.');dataMode='demo'}if(dataMode==='local')void refreshLocal()}render();document.querySelectorAll('.page').forEach(x=>x.hidden=x.id!==`page-${p}`);document.querySelectorAll('[data-page]').forEach(x=>{let yes=x.dataset.page===p;x.classList.toggle('active',yes);yes?x.setAttribute('aria-current','page'):x.removeAttribute('aria-current')})}function go(p){location.hash=p;nav()}
const demoIncidentNames=Object.freeze({'KG-CRED-01':'인증정보 사용 이상','KG-EXFIL-01':'비정상 데이터 전송 징후','KG-AUTH-01':'반복된 인증 실패','KG-WEB-01':'의심스러운 요청 내용','KG-PRIV-01':'예상하지 못한 권한 변경'});
const incidentName=x=>Object.hasOwn(demoIncidentNames,x.rule)?demoIncidentNames[x.rule]:x.title;
function overviewDemoRow(x){return `<tr data-incident="${esc(x.id)}" tabindex="0" role="button" aria-label="${esc(incidentName(x))} · 상세 근거 보기"><td><strong class="main-cell">${esc(incidentName(x))}</strong><small class="table-secondary">샘플 사고 · ${esc(x.id)}</small></td><td><span class="sev ${esc(x.severity.toLowerCase())}">${({HIGH:'높음',MEDIUM:'보통',LOW:'낮음'})[x.severity]}</span></td><td><span class="stat ${esc(x.status.toLowerCase())}">${({OPEN:'조사 대기',INVESTIGATING:'조사 중',CONTAINED:'시나리오 처리 완료'})[x.status]}</span></td><td class="date-cell">${fmt(x.detectedAt)}</td></tr>`}
function row(x,short=false){if(short)return overviewDemoRow(x);return `<tr data-incident="${esc(x.id)}" tabindex="0" role="button"><td><strong class="main-cell">${esc(incidentName(x))}</strong><small class="table-secondary mono">${esc(x.id)} · ${esc(x.rule)}</small></td><td>${sev(x.severity)}</td><td>${stat(x.status)}</td>${short?'':`<td class="mono">${esc(x.asset)}</td>`}<td class="date-cell">${fmt(x.detectedAt)}</td></tr>`}function metrics(){if(dataMode==='local')return localOverview();let a=state.incidents,w=a.filter(x=>x.status!=='CONTAINED').length,h=a.filter(x=>x.status!=='CONTAINED'&&x.severity==='HIGH').length,c=a.filter(x=>x.status==='CONTAINED').length;$('metric-grid').innerHTML=[['조사 대기 사고',w,'대응이 완료되지 않은 사고'],['고위험 사고',h,'시나리오 처리 전 · 높은 심각도'],['대응 완료',c,'샘플 시나리오 기준']].map(x=>`<article class="metric-card"><div class="metric-head">${x[0]}</div><div class="metric-value">${x[1]}</div><div class="metric-footer">${x[2]}</div></article>`).join('');$('queue-count').textContent=`${a.length}건`;$('queue-body').innerHTML=a.map(x=>row(x,true)).join('')||'<tr><td colspan="4" class="empty-row">현재 표시할 보안 사고가 없습니다.</td></tr>'}
function filtered(){return state.incidents.filter(x=>(state.status==='ALL'||x.status===state.status)&&(state.severity==='ALL'||x.severity===state.severity)&&`${x.id} ${incidentName(x)} ${x.title} ${x.asset} ${x.rule}`.toLowerCase().includes(state.search.toLowerCase()))}function incidents(){if(dataMode==='local')return localIncidents();document.querySelectorAll('[data-status]').forEach(b=>{let on=b.dataset.status===state.status;b.classList.toggle('active',on);b.setAttribute('aria-pressed',on)});$('status-filter-total').textContent=state.incidents.length;$('severity-select').value=state.severity;let a=filtered();if(!a.some(x=>x.id===state.selected))state.selected=a[0]?.id;$('incident-body').innerHTML=a.map(x=>row(x)).join('')||'<tr><td colspan="5" class="empty-row">검색 조건에 맞는 사고가 없습니다. 필터를 조정해 주세요.</td></tr>';$('incident-table-foot').textContent=`${a.length}건 표시 · 행을 선택하면 상세 근거를 확인할 수 있습니다.`;detail()}
function detail(){if(dataMode==='local')return localDetail();let x=state.incidents.find(x=>x.id===state.selected);if(!x){$('incident-detail').textContent='상세를 확인할 사고가 없습니다.';return}$('incident-detail').innerHTML=`<div class="detail-header"><div class="detail-overline mono">사고 ID · ${esc(x.id)}</div><h2>${esc(incidentName(x))}</h2><div class="detail-badges">${sev(x.severity)} ${stat(x.status)} <span class="source-chip">브라우저 샘플 데이터</span></div></div><div class="detail-section detail-evidence"><h3>탐지 근거</h3><p class="detail-note">${esc(x.ruleName)}</p><ul class="evidence-list">${x.evidence.map(e=>`<li><span class="evidence-icon">근거</span><div class="evidence-copy">${esc(e)}</div></li>`).join('')}</ul><p class="detail-note">${esc(x.notes)}</p></div><div class="detail-section"><h3>상세 정보</h3><div class="kv-grid"><div class="kv"><small>자산</small><strong class="mono">${esc(x.asset)}</strong></div><div class="kv"><small>규칙 / MITRE</small><strong class="mono">${esc(x.rule)} · ${esc(x.mitre)}</strong></div><div class="kv"><small>탐지 시각</small><strong>${fmt(x.detectedAt)}</strong></div><div class="kv"><small>데이터 출처</small><strong>${esc(x.source)}</strong></div><div class="kv"><small>원본 사고 이름</small><strong>${esc(x.title)}</strong></div></div></div><div class="detail-section"><h3>한계 및 안내</h3><p class="detail-note">관련 자산: ${esc(x.asset)}. 추가 확인 가능한 계정, 서비스, API 정보는 이 합성 데이터에 없습니다. 조사와 시나리오 처리는 브라우저 내부 상태와 감사 기록만 변경하며 외부 시스템에 영향을 주지 않습니다.</p></div><div class="detail-actions"><button class="btn secondary" data-investigate="${x.id}" ${x.status!=='OPEN'?'disabled':''}>조사 시작</button><button class="btn secondary" data-contain="${x.id}" ${x.status==='CONTAINED'?'disabled':''}>시나리오 처리</button><button class="btn primary" data-go="lab">대응 및 검증으로</button></div>`}
function lab(){let s=SCENARIOS.find(x=>x[0]===state.scenario);$('scenario-list').innerHTML=SCENARIOS.map(x=>`<button class="scenario-card ${x[0]===s[0]?'active':''}" data-scenario="${x[0]}"><strong>${x[2]}</strong></button>`).join('');$('scenario-detail').innerHTML=`<p>${s[2]} · 샘플 이벤트 분석</p>`;let x=state.incidents.find(x=>x.id===state.last),done=x?.status==='CONTAINED';$('lab-output').innerHTML=x?`<div class="lab-step"><span class="step-index">01</span><div><strong>시나리오 탐지 결과</strong><small>${x.id} · ${x.rule}</small></div></div><div class="lab-result ${done?'ok':''}">${done?'시나리오 처리 기록 완료. 실제 API 요청 차단 여부: 미검증':'샘플 사고가 생성되었습니다.'}</div>`:'<div class="lab-empty"><strong>실행 이력이 없습니다</strong><span>시나리오를 선택하고 시나리오를 실행해 주세요.</span></div>';$('perform-response').disabled=!x||done;$('perform-response').textContent=done?'시나리오 처리 완료':'시나리오 결과 확인'}
function add(type,detail){state.audit.unshift({id:`AU-${String(++state.auditSeq).padStart(3,'0')}`,time:stamp(),type,detail,actor:'analyst-demo'})}function audit(){let a=state.audit;$('audit-count').textContent=`${a.length}건`;$('audit-body').innerHTML=a.map(x=>`<tr><td>${fmt(x.time)}<small class="table-secondary mono">${x.id}</small></td><td><span class="event-type ${x.type.toLowerCase()}">${({DETECTION:'탐지',RESPONSE:'대응',TRIAGE:'조사',SIMULATION:'시나리오 분석'})[x.type]||esc(x.type)}</span></td><td>${esc(x.detail)}</td><td>${x.actor}</td></tr>`).join('')||'<tr><td colspan="4" class="empty-row">표시할 기록이 없습니다.</td></tr>'}function run(){if(dataMode!=='demo')return;let s=SCENARIOS.find(x=>x[0]===state.scenario),id=`KG-${String(++state.seq).padStart(4,'0')}`,x={id,title:`${s[1]} / sandbox event`,severity:s[3],status:'OPEN',asset:s[4],source:s[5],rule:s[6],ruleName:s[1],mitre:s[7],detectedAt:stamp(),evidence:['브라우저 내부 합성 이벤트 생성','시나리오 규칙 조건 일치'],notes:'브라우저 내부 합성 로그이며 실제 침해 징후가 아닙니다.'};state.incidents.unshift(x);state.selected=id;state.last=id;add('SIMULATION',`${id} · ${s[1]} 시나리오 실행`);add('DETECTION',`${id} · ${s[6]} 규칙 매칭 시뮬레이션`);render();toast(`${id} 샘플 사고가 생성되었습니다.`)}function change(id,to){if(dataMode!=='demo')return;let x=state.incidents.find(x=>x.id===id);if(!x||x.status==='CONTAINED')return;x.status=to;add(to==='INVESTIGATING'?'TRIAGE':'RESPONSE',`${id} · ${to==='INVESTIGATING'?'조사 시작':'시나리오 처리 및 상태 확인'} (실제 외부 조치 없음)`);render();toast(`${id} 상태를 ${to}로 변경했습니다.`)}function render(){metrics();incidents();lab();audit();renderSource();detectPresentation()}function toast(t){$('toast').textContent=t;$('toast').classList.add('show');clearTimeout(timer);timer=setTimeout(()=>$('toast').classList.remove('show'),2500)}
document.addEventListener('click',e=>{let t=e.target.closest('[data-page],[data-go],[data-detection],[data-incident],[data-status],[data-scenario],[data-investigate],[data-contain]');if(!t)return;if(t.dataset.page)return go(t.dataset.page);if(t.dataset.go)return go(t.dataset.go);if(t.dataset.detection){if(dataMode!=='local')return;live.selected=t.dataset.detection;if(current()==='overview'){live.search='';live.severity='ALL';go('incidents')}return incidents()}if(t.dataset.incident){if(dataMode!=='demo')return;state.selected=t.dataset.incident;if(current()==='overview'){state.search='';state.severity='ALL';state.status='ALL';go('incidents')}return incidents()}if(t.dataset.status){if(dataMode!=='demo')return;state.status=t.dataset.status;return incidents()}if(t.dataset.scenario){if(dataMode!=='demo')return;state.scenario=t.dataset.scenario;return lab()}if(t.dataset.investigate)return change(t.dataset.investigate,'INVESTIGATING');if(t.dataset.contain)return change(t.dataset.contain,'CONTAINED')});$('severity-select').addEventListener('change',e=>{if(dataMode==='local')live.severity=e.target.value;else state.severity=e.target.value;incidents()});$('incident-search').addEventListener('input',e=>{if(dataMode==='local')live.search=e.target.value;else state.search=e.target.value;incidents()});$('run-simulation').addEventListener('click',run);$('perform-response').addEventListener('click',()=>change(state.last,'CONTAINED'));$('reset-demo').addEventListener('click',()=>{if(dataMode!=='demo')return;state=start();render();toast('샌드박스 데이터가 초기화되었습니다.')});$('export-csv').addEventListener('click',()=>{let csv='\uFEFFid,time,type,detail\r\n'+state.audit.map(x=>[x.id,x.time,x.type,x.detail].map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\r\n'),a=document.createElement('a'),u=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.href=u;a.download='keyguard_xdr_audit.csv';a.click();setTimeout(()=>URL.revokeObjectURL(u),0)});function theme(x){document.body.dataset.theme=x;$('theme-toggle').setAttribute('aria-label',x==='light'?'다크 모드로 전환':'라이트 모드로 전환');$('theme-label').textContent=x==='light'?'다크 모드':'라이트 모드';try{localStorage.setItem('keyguard-xdr-theme-v0.1',x)}catch{}}let saved='light';try{saved=localStorage.getItem('keyguard-xdr-theme-v0.1')||saved}catch{}theme(saved);$('theme-toggle').addEventListener('click',()=>theme(document.body.dataset.theme==='light'?'dark':'light'));window.addEventListener('hashchange',nav);$('clock').textContent=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date())+' KST';nav();

$('data-source').addEventListener('change',e=>setSource(e.target.value));
$('refresh-local').addEventListener('click',()=>refreshLocal());
document.addEventListener('keydown',e=>{if(!['Enter',' '].includes(e.key))return;const row=e.target.closest('tr[data-detection],tr[data-incident]');if(row){e.preventDefault();row.click()}});
