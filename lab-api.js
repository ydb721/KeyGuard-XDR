'use strict';
// Separate from LocalApi: only explicit operator actions may call these endpoints.
const LabApi = (() => {
  const endpoints = {
    status:['GET','/api/lab/keys/status'], audit:['GET','/api/lab/audit?limit=100'],
    issue:['POST','/api/lab/keys/issue'], revoke:['POST','/api/lab/keys/revoke'], verify:['GET','/api/lab/resource'],
  };
  const messages = {
    disabled:'운영자 설정이 없어 로컬 키 관리가 비활성화되어 있습니다.',
    unauthorized:'운영자 인증에 실패했습니다. 비밀정보를 다시 입력하세요.',
    conflict:'키 상태가 변경되었거나 이미 처리되었습니다. 상태·감사를 재조회하세요.',
    audit:'감사 기록 무결성 오류입니다. 원본을 보존하고 서버를 확인하세요.',
    state:'키 상태 파일 무결성 오류입니다. 원본을 보존하고 서버를 확인하세요.',
    transaction:'키 상태·감사의 공동 저장에 실패했습니다. 상태를 재확인하세요.',
    uncertain:'저장 적용 여부가 불확실합니다. 작업을 반복하지 말고 상태·감사를 재조회하세요.',
    storage:'로컬 키 저장소를 사용할 수 없습니다. 저장 상태를 확인하세요.',
    full:'로컬 키·감사 저장소 용량 상한에 도달했습니다.',
    invalid:'키 관리 응답 형식이 올바르지 않습니다. 상태·감사를 재조회하세요.',
    snapshot:'상태와 감사의 조회 시점이 다릅니다. 다시 조회하세요.',
    timeout:'응답 시간이 초과되었습니다.', network:'서버 연결에 실패했습니다.', cancelled:'요청을 취소했습니다.',
    request:'요청이 거부되었습니다. 입력과 서버 상태를 확인하세요.',
  };
  class ClientError extends Error { constructor(kind){super(messages[kind]);this.kind=kind} }
  const bad = () => { throw new ClientError('invalid'); };
  const uuid = value => typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
  const time = value => typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
  const key = value => value&&Object.keys(value).length===4&&uuid(value.keyId)&&['ACTIVE','REVOKED'].includes(value.status)&&time(value.createdAt)&&(value.status==='ACTIVE'?value.revokedAt===null:time(value.revokedAt));
  function validate(operation,body,status){
    if(!body||typeof body!=='object')bad();
    if(operation==='status'){
      if(body.scope!=='local-lab'||!Number.isSafeInteger(body.revision)||body.revision<0||!Array.isArray(body.keys)||!body.keys.every(key)||
        new Set(body.keys.map(k=>k.keyId)).size!==body.keys.length||body.keys.filter(k=>k.status==='ACTIVE').length>1||
        body.activeKeyId!==(body.keys.find(k=>k.status==='ACTIVE')?.keyId??null))bad();
    }else if(operation==='audit'){
      if(body.scope!=='local-lab'||!Number.isSafeInteger(body.revision)||body.revision<0||body.limit!==100||!Array.isArray(body.audit)||body.audit.length>100||body.count!==body.audit.length||new Set(body.audit.map(a=>a?.auditId)).size!==body.audit.length)bad();
      for(const a of body.audit){if(!a||!uuid(a.auditId)||!uuid(a.actionId)||a.requestId!==a.actionId||!time(a.timestamp)||
        !['ISSUE','REISSUE','REVOKE','VERIFY'].includes(a.action)||(a.keyId!==null&&!uuid(a.keyId))||
        a.actor!==(a.action==='VERIFY'?'local-test-client':'local-operator')||
        ![null,'ACTIVE','REVOKED'].includes(a.beforeStatus)||![null,'ACTIVE','REVOKED'].includes(a.afterStatus)||
        (a.action==='VERIFY'?![200,401].includes(a.statusCode)||a.result!==`HTTP_${a.statusCode}`||a.beforeStatus!==a.afterStatus||a.statusCode!==(a.afterStatus==='ACTIVE'?200:401):
          a.result!=='SUCCESS'||a.statusCode!==null||!uuid(a.keyId)||a.afterStatus!==(a.action==='REVOKE'?'REVOKED':'ACTIVE')||a.beforeStatus!==(a.action==='REVOKE'?'ACTIVE':null)))bad()}
    }else if(operation==='verify'){
      if(![200,401].includes(status)||body.statusCode!==status||body.outcome!==(status===200?'success':'failure')||
        !uuid(body.verificationId)||!uuid(body.auditId)||(body.keyId!==null&&!uuid(body.keyId)))bad();
    }else{
      if(!key(body.key)||!uuid(body.actionId)||!uuid(body.auditId)||body.key.status!==(operation==='issue'?'ACTIVE':'REVOKED')||
        (operation==='issue'?(status!==201||typeof body.token!=='string'||!/^kg-lab-[A-Za-z0-9_-]{43}$/.test(body.token)):status!==200))bad();
    }
    return body;
  }
  function create({fetcher=fetch,timeoutMs=8000}={}){
    async function request(operation,{operator,key:token,keyId,signal}={}){
      const endpoint=endpoints[operation];if(!endpoint)throw new ClientError('request');
      const controller=new AbortController();let timedOut=false;
      const aborted=new Promise((resolve,reject)=>controller.signal.addEventListener('abort',()=>reject(new ClientError(timedOut?'timeout':'cancelled')),{once:true}));
      const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
      const timer=setTimeout(()=>{timedOut=true;controller.abort()},timeoutMs);
      try{
        const headers=operation==='verify'?{Authorization:`Bearer ${token??''}`}:{'X-KeyGuard-Operator':operator??''};
        const options={method:endpoint[0],headers,credentials:'omit',cache:'no-store',mode:'same-origin',redirect:'error',signal:controller.signal};
        if(options.method==='POST'){headers['Content-Type']='application/json';options.body=JSON.stringify(operation==='revoke'?{confirm:true,keyId}:{confirm:true})}
        const work=(async()=>{
          const response=await fetcher(endpoint[1],options);
          if(!response.headers.get('content-type')?.includes('application/json'))bad();
          let body;try{body=await response.json()}catch{bad()}
          if(!response.ok&&!(operation==='verify'&&response.status===401&&body?.statusCode===401)){
            const kinds={LAB_DISABLED:'disabled',OPERATOR_UNAUTHORIZED:'unauthorized',LAB_AUDIT_CORRUPT:'audit',KEY_STATE_CORRUPT:'state',LAB_TRANSACTION_FAILED:'transaction',LAB_COMMIT_UNCERTAIN:'uncertain',LAB_STORE_FULL:'full'};
            throw new ClientError(kinds[body?.error?.code]??(response.status===409?'conflict':response.status===503?'storage':'request'));
          }
          return validate(operation,body,response.status);
        })();
        return await Promise.race([work,aborted]);
      }catch(error){if(error instanceof ClientError)throw error;throw new ClientError(controller.signal.aborted?(timedOut?'timeout':'cancelled'):'network')}
      finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);controller.abort()}
    }
    async function refresh(options){const [status,audit]=await Promise.all([request('status',options),request('audit',options)]);if(status.revision!==audit.revision)throw new ClientError('snapshot');return{status,audit}}
    return{request,refresh};
  }
  return{create};
})();
