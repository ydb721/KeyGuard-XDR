'use strict';
// All credentials live only in this page's memory and password fields.
const LabUI = (() => {
  const $=id=>document.getElementById(id);
  const eligible=location.protocol==='http:'&&['127.0.0.1','localhost'].includes(location.hostname);
  const client=LabApi.create();
  let operator='',authenticated=false,busy=false,unknown=false,generation=0,controller=null,confirmation=null,issuedVisible=false;
  let currentKey=null,previousKey=null,status={keys:[],activeKeyId:null},audit=[],message='운영자 인증 필요';
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const keyStatus=value=>({ACTIVE:'활성',REVOKED:'폐기됨'})[value]||value;
  const auditAction=value=>({ISSUE:'키 발급',REISSUE:'키 재발급',REVOKE:'키 폐기',VERIFY:'접근 검증'})[value]||value;
  const auditResult=value=>value==='SUCCESS'?'완료':value==='HTTP_200'?'인증 성공':value==='HTTP_401'?'인증 거부':value;
  const maskedKey=value=>value?`${value.slice(0,7)}••••••••${value.slice(-4)}`:'';
  function renderIssued(){
    const output=$('lab-issued-key'),visible=currentKey&&issuedVisible;
    output.textContent=currentKey?(visible?`${currentKey.token}\n원문 가리기`:`원문 보기 · ${maskedKey(currentKey.token)}`):'';
    output.setAttribute('role','button');output.setAttribute('tabindex','0');output.setAttribute('aria-label',visible?'테스트 키 원문 가리기':'테스트 키 원문 보기');
    $('lab-issued-panel').hidden=!currentKey;
  }
  function render(){
    $('lab-unavailable').hidden=eligible;$('lab-controls').hidden=!eligible;
    $('lab-status').textContent=`${busy?'처리 중 · ':''}${unknown?'확인 불가 · ':''}${message}`;
    $('lab-status').dataset.uncertain=String(unknown);
    $('lab-status').dataset.state=busy?'processing':unknown?'unknown':authenticated?'ready':'idle';
    $('lab-connect').disabled=busy;$('lab-refresh').disabled=busy||!operator;
    for(const id of ['lab-issue','lab-revoke','lab-verify-current','lab-verify-previous','lab-verify-manual'])$(id).disabled=busy||!authenticated||unknown;
    $('lab-issue').disabled||=Boolean(status.activeKeyId);$('lab-revoke').disabled||=!status.activeKeyId;
    $('lab-verify-current').disabled||=!currentKey;$('lab-verify-previous').disabled||=!previousKey;
    $('lab-confirm').hidden=!confirmation;$('lab-confirm-yes').disabled=busy;
    $('lab-confirm-text').textContent=confirmation?.kind==='revoke'?`선택한 테스트 키 ${confirmation.keyId}를 폐기하시겠습니까? 폐기 이후 기존 키로 인증에 성공할 수 없습니다.`:'로컬 교육용 테스트 키를 발급하시겠습니까? 원문은 발급 응답에서 한 번만 제공됩니다.';
    $('lab-key-select').innerHTML=status.keys.map(k=>`<option value="${escape(k.keyId)}" ${k.keyId===status.activeKeyId?'selected':''}>${escape(k.keyId)} · ${keyStatus(k.status)}</option>`).join('');
    $('lab-key-state').textContent=status.keys.length?status.keys.map(k=>`${k.keyId} · ${keyStatus(k.status)} · 생성 ${k.createdAt}${k.revokedAt?' · 폐기 '+k.revokedAt:''}`).join('\n'):'활성 키 없음';
    renderIssued();
    $('lab-audit-body').innerHTML=audit.map(a=>`<tr><td data-label="시각 / 감사 ID">${escape(a.timestamp)}<small class="table-secondary mono">${escape(a.auditId)}</small></td><td data-label="작업">${escape(auditAction(a.action))}<small class="table-secondary mono">${escape(a.action)}</small></td><td data-label="키 ID" class="mono">${escape(a.keyId??'미등록 키')}</td><td data-label="결과 / 상태">${escape(auditResult(a.result))}<small>${escape(keyStatus(a.beforeStatus??'없음'))} → ${escape(keyStatus(a.afterStatus??'없음'))}</small></td><td data-label="역할 / 요청 ID">${escape(a.actor)}<small class="table-secondary mono">${escape(a.requestId)}</small></td></tr>`).join('')||'<tr><td colspan="5" class="empty-row">조회된 로컬 실습 감사 기록이 없습니다.</td></tr>';
  }
  function forgetSecrets(){operator='';authenticated=false;currentKey=null;previousKey=null;issuedVisible=false;$('lab-operator').value='';$('lab-manual-key').value='';$('lab-issued-key').textContent='';$('lab-issued-panel').hidden=true}
  function cancel(){generation++;controller?.abort();controller=null;if(busy){unknown=true;message='요청이 중단되었습니다. 서버에서 처리되었을 수 있으므로 상태·감사를 재조회하세요.'}busy=false;confirmation=null}
  async function execute(kind,token){
    if(!eligible||busy)return;
    if(kind!=='refresh'&&(!authenticated||unknown))return;
    if(kind==='refresh'&&!operator)return;
    busy=true;const requestGeneration=++generation;controller=new AbortController();const signal=controller.signal;render();
    try{
      if(kind==='refresh'){
        const snapshot=await client.refresh({operator,signal});if(requestGeneration!==generation)return;
        status=snapshot.status;audit=snapshot.audit.audit;authenticated=true;unknown=false;
        message='인증됨 · 상태·감사 조회 완료';
        if(status.activeKeyId&&!currentKey)message+=' · 키 원문은 재조회할 수 없습니다. 필요한 경우 해당 키를 명시적으로 폐기하고 새로 발급하세요.';
      }else{
        const result=await client.request(kind,{operator,key:token,keyId:confirmation?.keyId,signal});
        if(requestGeneration!==generation)return;
        if(kind==='issue'){
          currentKey={keyId:result.key.keyId,token:result.token};
          issuedVisible=false;
          message='발급 응답을 수신했습니다. 키 원문은 지금만 확인할 수 있습니다.';
        }else if(kind==='revoke'){
          if(currentKey?.keyId===result.key.keyId){previousKey=currentKey;currentKey=null}
          message='폐기 응답을 수신했습니다. 기존 키 검증 버튼으로 실제 HTTP 결과를 확인하세요.';
        }else{
          const previous=token===previousKey?.token,current=token===currentKey?.token;
          const label=previous?'기존 테스트 키':current?'신규 테스트 키':'입력한 테스트 키';
          const outcome=result.statusCode===200?'인증 성공':previous?'인증 거부 · 폐기된 기존 키 확인':'인증 거부 · 키 상태를 확인하세요';
          $('lab-verification').textContent=`${label}: HTTP ${result.statusCode} ${outcome} · 검증 ID ${result.verificationId} · 로컬 테스트 API 결과`;
          message='로컬 HTTP 검증 · 감사 저장 완료';
        }
        confirmation=null;
        const snapshot=await client.refresh({operator,signal});if(requestGeneration!==generation)return;
        status=snapshot.status;audit=snapshot.audit.audit;unknown=false;
      }
    }catch(error){if(requestGeneration!==generation)return;
      unknown=true;
      if(error.kind==='unauthorized'){operator='';authenticated=false}
      message=error.kind?error.message:'요청에 실패했습니다.';
      if(unknown){message+=' 자동 재시도하지 않습니다. 먼저 상태·감사를 재조회하세요.';$('lab-verification').textContent='확인 불가 · 응답 유실만으로 미실행이나 성공을 판단할 수 없습니다.'}
    }finally{if(requestGeneration===generation){busy=false;controller=null;render()}}
  }
  $('lab-connect').addEventListener('click',()=>{
    if(busy||!eligible)return;
    const value=$('lab-operator').value;$('lab-operator').value='';
    if(!/^[\x21-\x7e]{32,256}$/.test(value)){message='32~256자의 운영자 비밀정보를 직접 입력하세요.';render();return}
    operator=value;return execute('refresh');
  });
  $('lab-refresh').addEventListener('click',()=>execute('refresh'));
  $('lab-issue').addEventListener('click',()=>{if(busy||!authenticated||unknown||status.activeKeyId)return;confirmation={kind:'issue'};render()});
  $('lab-revoke').addEventListener('click',()=>{if(busy||!authenticated||unknown)return;const keyId=$('lab-key-select').value;if(status.keys.some(k=>k.keyId===keyId&&k.status==='ACTIVE')){confirmation={kind:'revoke',keyId};render()}});
  $('lab-confirm-yes').addEventListener('click',()=>confirmation&&execute(confirmation.kind));
  $('lab-confirm-no').addEventListener('click',()=>{if(busy)return;confirmation=null;render()});
  $('lab-issued-key').addEventListener('click',()=>{if(!currentKey)return;issuedVisible=!issuedVisible;renderIssued()});
  $('lab-issued-key').addEventListener('keydown',event=>{if((event.key==='Enter'||event.key===' ')&&currentKey){event.preventDefault();issuedVisible=!issuedVisible;renderIssued()}});
  $('lab-verify-current').addEventListener('click',()=>currentKey&&execute('verify',currentKey.token));
  $('lab-verify-previous').addEventListener('click',()=>previousKey&&execute('verify',previousKey.token));
  $('lab-verify-manual').addEventListener('click',()=>{const value=$('lab-manual-key').value;$('lab-manual-key').value='';if(value)return execute('verify',value)});
  $('lab-forget').addEventListener('click',()=>{cancel();forgetSecrets();message='운영자 정보와 모든 키 원문을 메모리에서 지웠습니다. 상태·감사는 서버에 보존됩니다.';render()});
  function onPage(page){if(page!=='lab'){cancel();forgetSecrets();if(!unknown)message='화면 이동으로 비밀정보를 지웠습니다. 운영자 정보를 다시 입력하세요.'}render()}
  window.addEventListener('pagehide',()=>{cancel();forgetSecrets();render()});
  render();
  return{onPage};
})();
