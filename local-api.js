'use strict';
// Read-only, same-origin client. Never generates test traffic or carries a token.
const LocalApi = (() => {
  const paths = ['/api/health', '/api/events?limit=100', '/api/detections?limit=100'];
  const messages = {
    storage: '저장소 오류(HTTP 503)입니다. 서버의 저장소 상태를 확인한 뒤 재시도하세요.',
    network: '네트워크 연결에 실패했습니다. 로컬 서버 실행 여부를 확인하세요.',
    unavailable: '이 환경에서는 로컬 API를 사용할 수 없습니다. 브라우저 모의 화면으로 전환할 수 있습니다.',
    invalid: 'API 응답 구조가 올바르지 않습니다. 데이터를 적용하지 않았습니다.',
    timeout: '조회 시간이 초과되었습니다. 새로고침으로 재시도하세요.',
    http: 'API 요청이 거부되었습니다. 서버 상태를 확인한 뒤 재시도하세요.',
    cancelled: '조회가 취소되었습니다.',
  };
  class ApiError extends Error {
    constructor(kind) { super(messages[kind]); this.kind = kind; }
  }
  const invalid = () => { throw new ApiError('invalid'); };
  const string = (x, max = 2048) => typeof x === 'string' && x.length > 0 && x.length <= max;
  const time = x => string(x, 32) && Number.isFinite(Date.parse(x)) && new Date(x).toISOString() === x;
  const uuid = x => typeof x === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(x);
  function envelope(body, key) {
    if (!body || !Array.isArray(body[key]) || body[key].length > 100 || body.limit !== 100 || body.count !== body[key].length) invalid();
    return body[key];
  }
  function validate(health, eventsBody, detectionsBody) {
    if (!health || health.status !== 'ok' || !string(health.version, 32) || health.scope !== 'localhost-education-only') invalid();
    const events = envelope(eventsBody, 'events');
    const detections = envelope(detectionsBody, 'detections');
    const eventIds = new Set(), detectionIds = new Set();
    for (const e of events) {
      if (!e || !uuid(e.eventId) || eventIds.has(e.eventId) || !time(e.timestamp) || !string(e.assetId, 128) ||
          e.source !== 'local-http' || e.method !== 'GET' || e.path !== '/api/test/resource' ||
          ![200, 401].includes(e.statusCode) || e.outcome !== (e.statusCode === 200 ? 'success' : 'failure') ||
          e.eventType !== (e.statusCode === 200 ? 'authentication_success' : 'authentication_failure')) invalid();
      eventIds.add(e.eventId);
    }
    for (const d of detections) {
      if (!d || typeof d.detectionId !== 'string' || !/^KGD-[0-9a-f]{64}$/.test(d.detectionId) || detectionIds.has(d.detectionId) ||
          !['KG-R001', 'KG-R002'].includes(d.ruleId) || !string(d.ruleName) || !string(d.reason, 10000) ||
          !string(d.assetId, 128) || !time(d.detectedAt) || d.severity !== 'MEDIUM' || d.synthetic !== false ||
          !Array.isArray(d.observedSources) || d.observedSources.length !== 1 || d.observedSources[0] !== 'local-http' ||
          !Array.isArray(d.evidenceEventIds) || d.eventCount !== d.evidenceEventIds.length ||
          !d.evidenceEventIds.every(uuid) || new Set(d.evidenceEventIds).size !== d.eventCount ||
          !d.analysisWindow || !time(d.analysisWindow.start) || d.analysisWindow.end !== d.detectedAt) invalid();
      const burst = d.ruleId === 'KG-R001';
      const seconds = burst ? 60 : 120;
      if (d.analysisWindow.durationSeconds !== seconds || Date.parse(d.detectedAt) - Date.parse(d.analysisWindow.start) !== seconds * 1000 ||
          d.detectionType !== (burst ? 'authentication_failure_burst' : 'suspicious_authentication_sequence') ||
          !Number.isSafeInteger(d.failureCount) || (burst ? d.failureCount !== 5 || d.eventCount !== 5 :
            d.failureCount < 3 || d.eventCount !== d.failureCount + 1 || !d.evidenceEventIds.includes(d.successEventId))) invalid();
      detectionIds.add(d.detectionId);
    }
    return { events, detections };
  }
  const isLocalPage = page => page.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(page.hostname);
  async function load({ signal, timeoutMs = 8000, fetcher = fetch } = {}) {
    const controller = new AbortController();
    let timedOut = false;
    const cancelled = new Promise((resolve, reject) => controller.signal.addEventListener('abort',
      () => reject(new ApiError(timedOut ? 'timeout' : 'cancelled')), { once: true }));
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try {
      const requests = paths.map(async path => {
        const response = await fetcher(path, { method: 'GET', credentials: 'omit', cache: 'no-store',
          mode: 'same-origin', redirect: 'error', signal: controller.signal });
        if (!response.ok) throw new ApiError(response.status === 503 ? 'storage' : response.status === 404 ? 'unavailable' : 'http');
        if (!response.headers.get('content-type')?.includes('application/json')) invalid();
        try { return await response.json(); } catch { invalid(); }
      });
      const bodies = await Promise.race([Promise.all(requests), cancelled]);
      return validate(...bodies);
    } catch (err) {
      if (err instanceof ApiError) throw err;
      if (controller.signal.aborted) throw new ApiError(timedOut ? 'timeout' : 'cancelled');
      throw new ApiError('network');
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', abort); controller.abort();
    }
  }
  return { isLocalPage, load };
})();
