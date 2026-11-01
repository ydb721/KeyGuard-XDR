'use strict';

// KeyGuard XDR v0.1 · Stone + Emerald (Light / Dark)
// 모든 데이터는 합성/교육용입니다. 네트워크 요청, 운영 키 관리, 실제 대응 명령은 없습니다.
const BASE_INCIDENTS = [
  {id:'KG-0214',title:'Unusual API key activity',severity:'HIGH',status:'OPEN',asset:'billing-api',keyRef:'sim-key-7A2C',source:'API + Cloud',rule:'KG-CRED-01',ruleName:'Anomalous credential usage',mitre:'T1078 · Valid Accounts',detectedAt:'2026-11-01T10:47:00+09:00',evidence:[{source:'API',text:'테스트 키 식별자의 짧은 시간 내 요청 횟수 증가'},{source:'Cloud',text:'기존 합성 기준과 다른 출처에서 인증 성공 이벤트 발생'},{source:'API',text:'동일 키로 관리용 테스트 엔드포인트 접근 시도'}],notes:'비정상 사용 정황만으로 키 유출을 확정할 수 없습니다.'},
  {id:'KG-0213',title:'Potential data exfiltration',severity:'HIGH',status:'OPEN',asset:'archive-service',keyRef:'sim-key-91FE',source:'Cloud + Endpoint',rule:'KG-EXFIL-01',ruleName:'Unusual outbound transfer',mitre:'T1048 · Exfiltration Over Alternative Protocol',detectedAt:'2026-11-01T10:31:00+09:00',evidence:[{source:'Endpoint',text:'합성 압축 파일 생성 이벤트'},{source:'Cloud',text:'테스트 환경의 낯선 목적지로 대량 요청 발생'},{source:'Cloud',text:'업무 시간 외 대량 전송 시나리오 근거'}],notes:'실제 데이터 전송이 아닌 교육용 합성 로그입니다.'},
  {id:'KG-0212',title:'Repeated authentication failures',severity:'MEDIUM',status:'OPEN',asset:'identity-gateway',keyRef:'sim-user-04',source:'API',rule:'KG-AUTH-01',ruleName:'Burst of authentication failures',mitre:'T1110 · Brute Force',detectedAt:'2026-11-01T10:06:00+09:00',evidence:[{source:'API',text:'3분 동안 합성 로그인 실패 36건'},{source:'API',text:'동일 테스트 출처·계정에 실패 집중'}],notes:'시험용 임계값을 적용했습니다.'},
  {id:'KG-0211',title:'Suspicious query payload',severity:'LOW',status:'CONTAINED',asset:'test-web-api',keyRef:'sim-client-01',source:'API',rule:'KG-WEB-01',ruleName:'Input anomaly flag',mitre:'T1190 · Exploit Public-Facing Application',detectedAt:'2026-11-01T09:23:00+09:00',evidence:[{source:'API',text:'합성 SQL 특수 패턴이 테스트 요청에서 관찰됨'},{source:'API',text:'방어 로직에서 400 응답 시나리오로 기록'}],notes:'문자열 패턴만으로 실제 SQL Injection 성공을 입증하지 않습니다.'},
  {id:'KG-0210',title:'Unexpected privilege change',severity:'MEDIUM',status:'CONTAINED',asset:'sandbox-user-02',keyRef:'sim-user-02',source:'Endpoint + Cloud',rule:'KG-PRIV-01',ruleName:'Unexpected role elevation',mitre:'T1098 · Account Manipulation',detectedAt:'2026-11-01T08:53:00+09:00',evidence:[{source:'Endpoint',text:'테스트 계정의 역할 변경 이벤트 합성'},{source:'Cloud',text:'같은 시각 관리 API 호출 시나리오 기록'}],notes:'가상 계정의 역할 변경 시나리오이며 운영 권한은 변경하지 않습니다.'}
];
const BASE_AUDIT = [
 {id:'AU-004',time:'2026-11-01T10:47:03+09:00',type:'DETECTION',detail:'KG-CRED-01 · 모의 인증정보 이상 사용 경고 생성',actor:'demo-engine'},
 {id:'AU-003',time:'2026-11-01T10:31:04+09:00',type:'DETECTION',detail:'KG-EXFIL-01 · 모의 데이터 전송 이상 경고 생성',actor:'demo-engine'},
 {id:'AU-002',time:'2026-11-01T09:23:13+09:00',type:'RESPONSE',detail:'KG-0211 · 모의 차단 상태 기록',actor:'analyst-demo'},
 {id:'AU-001',time:'2026-11-01T08:53:30+09:00',type:'RESPONSE',detail:'KG-0210 · 모의 권한 변경 대응 기록',actor:'analyst-demo'}
];
const SCENARIOS = [
 {key:'credential',symbol:'⌁',title:'Credential misuse',caption:'API 키 이상 사용',severity:'HIGH',asset:'demo-payment-api',keyRef:'sim-key-new',source:'API + Cloud',rule:'KG-CRED-01',ruleName:'Anomalous credential usage',mitre:'T1078 · Valid Accounts',detail:'가상 키가 평소와 다른 요청 패턴을 보이는 시나리오입니다.',conditions:['테스트 API의 호출 급증 이벤트 생성','모의 Cloud 감사 로그의 출처 변경 이벤트 생성','동일 가상 키 식별자를 기준으로 두 로그 연관 분석'],evidence:[{source:'API',text:'테스트 API 호출이 2분 이내 45건으로 증가한 합성 이벤트'},{source:'Cloud',text:'동일 가상 키 식별자의 새 테스트 출처 인증 기록'},{source:'API',text:'일반 요청 이후 관리용 테스트 API 접근 기록'}]},
 {key:'brute',symbol:'⦿',title:'Brute force',caption:'인증 실패 집중',severity:'MEDIUM',asset:'demo-identity-api',keyRef:'sim-user-test',source:'API',rule:'KG-AUTH-01',ruleName:'Burst of authentication failures',mitre:'T1110 · Brute Force',detail:'가상 사용자의 반복 인증 실패를 재현하는 시나리오입니다.',conditions:['3분 동안 모의 로그인 실패 36건 생성','동일 테스트 출처 및 계정 정보 연결','실패 횟수 임계값과 기간 조건을 결합해 경보 생성'],evidence:[{source:'API',text:'3분 동안 동일 계정의 합성 로그인 실패 36건'},{source:'API',text:'테스트 출처 식별자에 실패가 집중된 기록'}]},
 {key:'exfil',symbol:'↗',title:'Exfiltration',caption:'의심스러운 대량 전송',severity:'HIGH',asset:'demo-cloud-store',keyRef:'sim-key-archive',source:'Endpoint + Cloud',rule:'KG-EXFIL-01',ruleName:'Unusual outbound transfer',mitre:'T1048 · Exfiltration Over Alternative Protocol',detail:'모의 압축 파일 생성과 대량 전송 이벤트를 연결합니다.',conditions:['엔드포인트의 합성 압축 파일 생성 로그','클라우드의 비정상 전송량·목적지 이벤트','시간 범위 및 자산 식별자를 비교해 관련 사건 생성'],evidence:[{source:'Endpoint',text:'가상 압축 파일 생성 이벤트 기록'},{source:'Cloud',text:'낯선 테스트 목적지로 75MB 전송 시나리오'},{source:'Cloud',text:'같은 자산에서 4분 이내 이벤트 발생'}]}
];

// v0.1: 독립 UI 버전. 모의 SOC 워크플로 · 외부 네트워크 요청 없음.
const RULES = [
 {id:'KG-CRED-01',name:'Anomalous credential usage',source:'API + Cloud',mitre:'T1078',severity:'HIGH'},
 {id:'KG-EXFIL-01',name:'Unusual outbound transfer',source:'Cloud + Endpoint',mitre:'T1048',severity:'HIGH'},
 {id:'KG-AUTH-01',name:'Authentication failure burst',source:'API',mitre:'T1110',severity:'MEDIUM'},
 {id:'KG-WEB-01',name:'Input anomaly flag',source:'API',mitre:'T1190',severity:'LOW'},
 {id:'KG-PRIV-01',name:'Unexpected privilege change',source:'Endpoint + Cloud',mitre:'T1098',severity:'MEDIUM'},
];
const INITIAL_STATE=()=>({
 incidents:structuredClone(BASE_INCIDENTS),audit:structuredClone(BASE_AUDIT),
 selectedIncident:'KG-0214',selectedScenario:'credential',lastRun:null,
 statusFilter:'ALL',severityFilter:'ALL',auditFilter:'ALL',assetFilter:'ALL',assetSearch:'',search:'',seq:214,auditSeq:4,
});
let state=INITIAL_STATE();
let toastTimeout;
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const dt=(v,year=false)=>new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:year?'numeric':undefined,month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(v));
const stamp=()=>new Date().toISOString();
const dateHour=iso=>Number(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Seoul',hour:'2-digit',hourCycle:'h23'}).format(new Date(iso)));
const severityLabel=s=>`<span class="sev ${s.toLowerCase()}">${esc(s)}</span>`;
const statusLabel=s=>`<span class="stat ${s.toLowerCase()}">${s==='OPEN'?'Open':s==='INVESTIGATING'?'Investigating':'Contained'}</span>`;
const badgeType=s=>`<span class="event-type ${s.toLowerCase()}">${esc(s)}</span>`;
function showToast(message){const el=$('toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>el.classList.remove('show'),3200);}
function updateClock(){ $('clock').textContent=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date())+' KST'; }
function page(){const p=location.hash.replace('#','');return ['overview','incidents','rules','assets','lab','audit'].includes(p)?p:'overview';}
function go(p){if(page()===p){renderNavigation();return;}location.hash=p;}
function renderNavigation(){const p=page();document.querySelectorAll('.page').forEach(section=>{const yes=section.id==='page-'+p;section.hidden=!yes;section.classList.toggle('active',yes);});document.querySelectorAll('[data-page]').forEach(b=>{const active=b.dataset.page===p;b.classList.toggle('active',active);if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});const names={overview:'Overview',incidents:'Incident Management',rules:'Detection Rules',assets:'Asset Inventory',lab:'Response Lab',audit:'Audit Trail'};$('top-location').textContent=names[p];window.scrollTo({top:0,behavior:'instant'});}
function sortIncidents(a,b){return Date.parse(b.detectedAt)-Date.parse(a.detectedAt);}
function incidentRow(x,short=false){return `<tr data-incident="${esc(x.id)}" tabindex="0" role="button" aria-label="${esc(x.id)} 사고 상세 열기" class="${state.selectedIncident===x.id?'row-selected':''}"><td><span class="main-cell">${esc(x.title)}</span><small class="table-secondary mono">${esc(x.id)} · ${esc(x.rule)}</small></td><td>${severityLabel(x.severity)}</td><td>${statusLabel(x.status)}</td><td><span class="mono">${esc(x.asset)}</span></td><td class="date-cell">${dt(x.detectedAt)}</td></tr>`;}
function renderMetrics(){const all=state.incidents, open=all.filter(x=>x.status!=='CONTAINED').length,critical=all.filter(x=>x.status!=='CONTAINED'&&x.severity==='HIGH').length,contained=all.filter(x=>x.status==='CONTAINED').length,evidence=all.reduce((a,x)=>a+x.evidence.length,0);
const cards=[
 {title:'조치 대기 사고',value:open,desc:'Open 및 Investigating',icon:'◌'},
 {title:'High 우선순위',value:critical,desc:'미종결된 HIGH 심각도 사고',icon:'△'},
 {title:'대응 완료 상태',value:contained,desc:'시연에서 Contained 처리된 사고',icon:'✓'},
 {title:'연결된 증거',value:evidence,desc:'API · Cloud · Endpoint 합성 항목',icon:'▤'},
];
$('metric-grid').innerHTML=cards.map(x=>`<article class="metric-card"><div class="metric-head"><span>${x.title}</span><span class="metric-glyph" aria-hidden="true">${x.icon}</span></div><div class="metric-value">${x.value.toLocaleString('ko-KR')}</div><div class="metric-footer">${x.desc}</div></article>`).join('');
$('side-open-count').textContent=open;
const queued=all.filter(x=>x.status!=='CONTAINED').sort((a,b)=>{const sa=a.severity==='HIGH'?0:a.severity==='MEDIUM'?1:2,sb=b.severity==='HIGH'?0:b.severity==='MEDIUM'?1:2;return sa-sb||sortIncidents(a,b);});
$('queue-count').textContent=`${queued.length}건`;
$('queue-body').innerHTML=queued.length?queued.slice(0,5).map(x=>incidentRow(x,true)).join(''):'<tr><td colspan="5" class="empty-row">조치 대기 사고가 없습니다.</td></tr>';
const sources=['API','Cloud','Endpoint'];const rows=all.flatMap(x=>x.evidence);const total=rows.length;
$('source-summary').innerHTML=sources.map((source,i)=>{const count=rows.filter(x=>x.source===source).length,pct=total?Math.round(count/total*100):0;return `<div class="src-row"><div class="src-main"><div class="src-icon">${['A','C','E'][i]}</div><div class="src-label"><strong>${source} telemetry</strong><small>합성 이벤트 출처</small></div><strong class="src-value">${count} <span style="color:var(--faint);font-size:10px;font-weight:500">/ ${pct}%</span></strong></div><div class="track"><div class="track-fill ${['','cyan','amber'][i]}" style="width:${pct}%"></div></div></div>`}).join('');
$('top-rules').innerHTML=RULES.slice().sort((a,b)=>state.incidents.filter(x=>x.rule===b.id).length-state.incidents.filter(x=>x.rule===a.id).length).slice(0,4).map(r=>`<div class="rule-short"><div class="rule-short-title"><strong>${esc(r.name)}</strong><small class="mono">${r.id} · ${r.mitre}</small></div><div class="rule-short-count">${all.filter(x=>x.rule===r.id).length}<small>사고</small></div></div>`).join('');
renderChart();$('overview-updated').textContent=dt(stamp());}
function renderChart(){let latest=Math.max(...state.incidents.map(x=>Date.parse(x.detectedAt)));if(!Number.isFinite(latest))latest=Date.now();const maxhour=dateHour(new Date(latest).toISOString());const hours=Array.from({length:7},(_,i)=>(maxhour-6+i+24)%24);const targetDate=new Date(latest).toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'});
const counts=hours.map(hour=>state.incidents.filter(x=>x.status&&new Date(x.detectedAt).toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'})===targetDate&&dateHour(x.detectedAt)===hour).length);const max=Math.max(1,...counts);
$('time-chart').innerHTML=`<div class="bar-chart" role="img" aria-label="해당 날짜의 시간대별 합성 사건 발생 건수: ${counts.join(', ')}"><div class="bar-col" style="display:none"></div>${counts.map(v=>`<div class="bar-col"><span class="bar-value">${v||''}</span><div class="bar-fill ${v===0?'muted':''}" style="height:${Math.max(2,(v/max)*100)}%"></div></div>`).join('')}</div><div class="bar-labels">${hours.map(h=>`<span>${String(h).padStart(2,'0')}:00</span>`).join('')}</div><div class="chart-caption">현재 사건 목록의 시각을 기준으로 계산한 분포이며, 모의 사건 데이터만 포함합니다.</div>`;}
function filteredIncidents(){return state.incidents.filter(x=>(state.statusFilter==='ALL'||x.status===state.statusFilter)&&(state.severityFilter==='ALL'||x.severity===state.severityFilter)&&(`${x.id} ${x.title} ${x.asset} ${x.rule} ${x.source}`.toLowerCase().includes(state.search.toLowerCase()))).sort(sortIncidents);}
function renderIncidents(){document.querySelectorAll('[data-status]').forEach(b=>{const yes=b.dataset.status===state.statusFilter;b.classList.toggle('active',yes);b.setAttribute('aria-pressed',String(yes));});$('status-filter-total').textContent=state.incidents.length;$('severity-select').value=state.severityFilter;
const list=filteredIncidents();$('incident-count-note').textContent=`${list.length}건 / 총 ${state.incidents.length}건`;
if(!list.some(x=>x.id===state.selectedIncident))state.selectedIncident=list[0]?.id??null;
$('incident-body').innerHTML=list.length?list.map(x=>incidentRow(x)).join(''):'<tr><td colspan="5" class="empty-row">검색 조건에 맞는 사건이 없습니다. 필터를 조정해 주세요.</td></tr>';
$('incident-table-foot').textContent='행을 선택하면 오른쪽에서 탐지 규칙과 연관 증거를 확인할 수 있습니다.';
renderIncidentDetail();}
function renderIncidentDetail(){const x=state.incidents.find(x=>x.id===state.selectedIncident);if(!x){$('incident-detail').innerHTML='<div class="detail-empty">상세를 확인할 사고가 없습니다.</div>';return;}
$('incident-detail').innerHTML=`<div class="detail-header"><div class="detail-overline mono">CASE FILE / ${esc(x.id)}</div><h2>${esc(x.title)}</h2><div class="detail-badges">${severityLabel(x.severity)} ${statusLabel(x.status)}</div></div><div class="detail-section"><h3>사고 메타데이터</h3><div class="kv-grid"><div class="kv"><small>영향 자산</small><strong class="mono">${esc(x.asset)}</strong></div><div class="kv"><small>데이터 출처</small><strong>${esc(x.source)}</strong></div><div class="kv"><small>인증정보 참조</small><strong class="mono">${esc(x.keyRef)}</strong></div><div class="kv"><small>발생 시각(KST)</small><strong>${dt(x.detectedAt,true)}</strong></div></div></div><div class="detail-section"><h3>탐지 규칙 / MITRE ATT&CK</h3><div class="kv-grid"><div class="kv"><small>규칙 ID</small><strong class="mono">${esc(x.rule)}</strong></div><div class="kv"><small>기술 분류</small><strong>${esc(x.mitre)}</strong></div></div><p class="detail-note">${esc(x.ruleName)}</p></div><div class="detail-section"><h3>연관 증거 (${x.evidence.length})</h3><ul class="evidence-list">${x.evidence.map(e=>`<li><span class="evidence-icon">${esc(e.source)}</span><span>${esc(e.text)}</span></li>`).join('')}</ul><div class="detail-note">${esc(x.notes)}</div></div><div class="detail-actions"><button class="btn secondary" type="button" data-case-investigate="${x.id}" ${x.status!=='OPEN'?'disabled':''}>조사 시작</button><button class="btn secondary" type="button" data-case-contain="${x.id}" ${x.status==='CONTAINED'?'disabled':''}>모의 격리 처리</button><button class="btn primary" type="button" data-go="audit">감사 기록 확인 →</button></div><p class="detail-note">조사·격리는 UI 상태만 변경합니다. 실제 인증정보나 보안 정책에는 영향을 주지 않습니다.</p>`;}
function renderRules(){$('rules-body').innerHTML=RULES.map(r=>`<tr><td><strong class="main-cell">${esc(r.name)}</strong><small class="table-secondary mono">${r.id}</small></td><td><span class="source-chip">${esc(r.source)}</span></td><td class="mono">${r.mitre}</td><td>${severityLabel(r.severity)}</td><td>${state.incidents.filter(x=>x.rule===r.id).length}</td><td><span class="rule-live">● DEMO</span></td></tr>`).join('');}

function inventory() {
  const map=new Map();
  const rank={LOW:1,MEDIUM:2,HIGH:3};
  for (const incident of state.incidents) {
    const sources=incident.source.split(' + ');
    const prev=map.get(incident.asset);
    if (!prev) map.set(incident.asset,{id:incident.asset,sources:[...sources],cases:1,severity:incident.severity,latest:incident.detectedAt});
    else {
      prev.cases+=1;
      prev.sources=[...new Set([...prev.sources,...sources])];
      if(rank[incident.severity]>rank[prev.severity])prev.severity=incident.severity;
      if(Date.parse(incident.detectedAt)>Date.parse(prev.latest))prev.latest=incident.detectedAt;
    }
  }
  return [...map.values()].sort((a,b)=>Date.parse(b.latest)-Date.parse(a.latest));
}
function renderAssets(){
  const all=inventory();
  const type=state.assetFilter;
  const query=state.assetSearch.trim().toLowerCase();
  const rows=all.filter(a=>(type==='ALL'||a.sources.includes(type))&&a.id.toLowerCase().includes(query));
  document.querySelectorAll('[data-asset]').forEach(b=>{const active=b.dataset.asset===type;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
  $('asset-stats').innerHTML=[
    ['분석 대상 자산',all.length],['연관 사고',state.incidents.length],['다중 출처 자산',all.filter(a=>a.sources.length>1).length],
  ].map(([label,value])=>`<div class="asset-stat"><small>${label}</small><strong>${value}</strong></div>`).join('');
  $('asset-count').textContent=`${rows.length}건 / 총 ${all.length}건`;
  $('asset-body').innerHTML=rows.length?rows.map(a=>`<tr><td><strong class="main-cell mono">${esc(a.id)}</strong><small class="asset-sub">시뮬레이션 식별자</small></td><td>${a.sources.map(s=>`<span class="asset-type">${esc(s)}</span>`).join(' ')}</td><td>합성 보안 이벤트</td><td class="mono">${a.cases}</td><td>${severityLabel(a.severity)}</td><td class="date-cell">${dt(a.latest,true)}</td></tr>`).join(''):'<tr><td colspan="6" class="empty-row">검색 조건에 맞는 자산이 없습니다.</td></tr>';
}

function renderScenarios(){const x=SCENARIOS.find(item=>item.key===state.selectedScenario);
$('scenario-list').innerHTML=SCENARIOS.map(item=>`<button type="button" class="scenario-card ${item.key===state.selectedScenario?'active':''}" data-scenario="${item.key}" aria-pressed="${item.key===state.selectedScenario}"><span class="sc-icon mono">${esc(item.rule)}</span><strong>${esc(item.title)}</strong><small>${esc(item.caption)}</small></button>`).join('');
$('scenario-detail').innerHTML=`<p>${esc(x.detail)}</p><ul class="condition-list">${x.conditions.map(s=>`<li>${esc(s)}</li>`).join('')}</ul>`;renderLabOutput();}
function renderLabOutput(){const run=state.lastRun,output=$('lab-output'),button=$('perform-response');if(!run){output.innerHTML='<div class="lab-empty"><strong>실행 이력이 없습니다</strong><span>시나리오를 선택하고 모의 이벤트 생성 버튼을 눌러 주세요.</span></div>';button.disabled=true;button.textContent='모의 조치 및 결과 확인';return;}
const x=state.incidents.find(item=>item.id===run.incidentId);if(!x){button.disabled=true;return;}
const contained=x.status==='CONTAINED';output.innerHTML=`<div class="lab-step"><span class="step-index">01</span><div><strong>합성 이벤트 생성</strong><small>${esc(x.source)} / 증거 ${x.evidence.length}건 / ${x.id}</small></div></div><div class="lab-step"><span class="step-index">02</span><div><strong>모의 규칙 매칭</strong><small>${esc(x.rule)} · ${esc(x.mitre)} (실제 XDR 엔진 연결 전)</small></div></div><div class="lab-step"><span class="step-index">03</span><div><strong>사고 목록 생성</strong><small>${esc(x.title)} · ${esc(x.severity)} · ${esc(x.status)}</small></div></div>${contained?`<div class="lab-step"><span class="step-index">04</span><div><strong>모의 격리 상태 기록</strong><small>UI 상태 변경 및 감사 이벤트 생성</small></div></div><div class="lab-result ok">브라우저 내부 상태 변경 확인 완료. 실제 키 폐기나 외부 API 차단 효과는 검증되지 않았습니다.</div>`:`<div class="lab-result">모의 탐지 결과가 생성되었습니다. 다음 단계에서 모의 대응 상태를 변경할 수 있습니다.</div>`}`;button.disabled=contained;button.textContent=contained?'모의 대응 완료':'모의 조치 및 결과 확인';}
function auditAdd(type,detail,actor){state.audit.unshift({id:'AU-'+String(++state.auditSeq).padStart(3,'0'),time:stamp(),type,detail,actor});}
function runScenario(){const x=SCENARIOS.find(x=>x.key===state.selectedScenario);const id='KG-'+String(++state.seq).padStart(4,'0');const incident={id,title:x.title+' / sandbox event',severity:x.severity,status:'OPEN',asset:x.asset,keyRef:x.keyRef+'-'+state.seq,source:x.source,rule:x.rule,ruleName:x.ruleName,mitre:x.mitre,detectedAt:stamp(),evidence:structuredClone(x.evidence),notes:'브라우저 내부 합성 로그이며 실제 침해 징후가 아닙니다.'};state.incidents.unshift(incident);state.selectedIncident=id;state.lastRun={incidentId:id};state.statusFilter='ALL';state.severityFilter='ALL';state.search='';$('incident-search').value='';auditAdd('SIMULATION',id+' · '+x.title+' 모의 이벤트 생성','analyst-demo');auditAdd('DETECTION',id+' · '+x.rule+' 규칙 매칭 시뮬레이션','demo-engine');renderAll();showToast(id+' 시나리오가 생성되었습니다. 사고 조사와 감사 기록에서 확인할 수 있습니다.');}
function changeIncident(id,to){const x=state.incidents.find(x=>x.id===id);if(!x||x.status==='CONTAINED'||x.status===to)return;x.status=to;if(to==='INVESTIGATING')auditAdd('TRIAGE',id+' · 분석가가 조사 시작 (모의 상태 변경)','analyst-demo');else auditAdd('RESPONSE',id+' · 모의 격리 및 상태 확인 (실제 키 변경 없음)','analyst-demo');renderAll();showToast(`${id} 상태를 ${to}로 변경했습니다. 실제 외부 조치는 발생하지 않습니다.`);}
function respondScenario(){if(!state.lastRun)return;changeIncident(state.lastRun.incidentId,'CONTAINED');}
function renderAudit(){document.querySelectorAll('[data-audit]').forEach(b=>{const on=b.dataset.audit===state.auditFilter;b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on));});const rows=state.audit.filter(x=>state.auditFilter==='ALL'||x.type===state.auditFilter).sort((a,b)=>Date.parse(b.time)-Date.parse(a.time));$('audit-count').textContent=`${rows.length} entries`;$('audit-body').innerHTML=rows.length?rows.map(x=>`<tr><td class="date-cell">${dt(x.time,true)}<small class="table-secondary mono">${esc(x.id)}</small></td><td>${badgeType(x.type)}</td><td>${esc(x.detail)}</td><td class="mono">${esc(x.actor)}</td></tr>`).join(''):'<tr><td colspan="4" class="empty-row">표시할 기록이 없습니다.</td></tr>';}
function csvCell(value){let str=String(value??'');if(/^[\s]*[=+@\-\t\r]/.test(str))str="'"+str;return '"'+str.replace(/"/g,'""')+'"';}
function exportAudit(){const rows=[['audit_id','timestamp_utc','type','detail','actor'],...state.audit.map(x=>[x.id,x.time,x.type,x.detail,x.actor])];const csv='\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='keyguard_xdr_demo_audit.csv';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);showToast('모의 감사 기록 CSV를 저장했습니다.');}
function renderAll(){renderMetrics();renderIncidents();renderRules();renderAssets();renderScenarios();renderAudit();}
document.addEventListener('click',e=>{
 const target=e.target;
 const nav=target.closest('[data-page]');if(nav){go(nav.dataset.page);return;}
 const link=target.closest('[data-go]');if(link){go(link.dataset.go);return;}
 const row=target.closest('[data-incident]');if(row){state.selectedIncident=row.dataset.incident;state.statusFilter='ALL';state.severityFilter='ALL';state.search='';$('incident-search').value='';renderIncidents();go('incidents');return;}
 const st=target.closest('[data-status]');if(st){state.statusFilter=st.dataset.status;renderIncidents();return;}
 const asset=target.closest('[data-asset]');if(asset){state.assetFilter=asset.dataset.asset;renderAssets();return;}
 const au=target.closest('[data-audit]');if(au){state.auditFilter=au.dataset.audit;renderAudit();return;}
 const scenario=target.closest('[data-scenario]');if(scenario){state.selectedScenario=scenario.dataset.scenario;renderScenarios();return;}
 const investigate=target.closest('[data-case-investigate]');if(investigate){changeIncident(investigate.dataset.caseInvestigate,'INVESTIGATING');return;}
 const contain=target.closest('[data-case-contain]');if(contain){changeIncident(contain.dataset.caseContain,'CONTAINED');return;}
});
document.addEventListener('keydown',e=>{const tr=e.target.closest('tr[data-incident]');if(tr&&(e.key==='Enter'||e.key===' ')){e.preventDefault();tr.click();}});
$('severity-select').addEventListener('change',e=>{state.severityFilter=e.target.value;renderIncidents();});
$('incident-search').addEventListener('input',e=>{state.search=e.target.value;renderIncidents();});
$('asset-search').addEventListener('input',e=>{state.assetSearch=e.target.value;renderAssets();});
$('run-simulation').addEventListener('click',runScenario);
$('perform-response').addEventListener('click',respondScenario);
$('export-csv').addEventListener('click',exportAudit);
$('reset-demo').addEventListener('click',()=>{state=INITIAL_STATE();$('incident-search').value='';$('asset-search').value='';renderAll();showToast('샌드박스 데이터가 초기화되었습니다.');});
function applyTheme(next,notify=false){
  document.body.dataset.theme=next;
  $('theme-toggle').setAttribute('aria-label',next==='light'?'다크 모드로 전환':'라이트 모드로 전환');
  $('theme-label').textContent=next==='light'?'다크 모드':'라이트 모드';
  try{localStorage.setItem('keyguard-xdr-theme-v0.1',next);}catch{}
  if(notify)showToast(next==='light'?'라이트 테마가 적용되었습니다.':'다크 테마가 적용되었습니다.');
}
let savedTheme='light';
try{const saved=localStorage.getItem('keyguard-xdr-theme-v0.1');if(['light','dark'].includes(saved))savedTheme=saved;}catch{}
applyTheme(savedTheme);
$('theme-toggle').addEventListener('click',()=>applyTheme(document.body.dataset.theme==='light'?'dark':'light',true));
window.addEventListener('hashchange',renderNavigation);
renderAll();renderNavigation();updateClock();setInterval(updateClock,30000);
