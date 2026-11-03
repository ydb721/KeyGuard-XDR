import { createHash } from 'node:crypto';

const rules = {
  'KG-R001': ['Authentication Failure Burst', 'authentication_failure_burst', 60],
  'KG-R002': ['Failure Followed by Success', 'suspicious_authentication_sequence', 120],
  'KG-R003': ['Cross-Source Correlation', 'cross_source_suspicious_activity', 300],
};
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const invalid = () => { throw new TypeError('INVALID_RULE_EVENT'); };

function detection(ruleId, evidence, reason, details = {}) {
  const [ruleName, detectionType, durationSeconds] = rules[ruleId];
  const last = evidence.at(-1);
  const evidenceEventIds = evidence.map(e => e.eventId);
  const detectedAt = last.timestamp;
  const identity = JSON.stringify([ruleId, last.assetId, detectedAt, evidenceEventIds]);
  return {
    detectionId: `KGD-${createHash('sha256').update(identity).digest('hex')}`,
    ruleId, ruleName, detectionType, severity: 'MEDIUM', detectedAt, assetId: last.assetId,
    eventCount: evidence.length, evidenceEventIds,
    analysisWindow: { start: new Date(last.time - durationSeconds * 1000).toISOString(), end: detectedAt, durationSeconds },
    reason, observedSources: [...new Set(evidence.map(e => e.source))].sort(compare),
    synthetic: evidence.some(e => e.synthetic === true), ...details,
  };
}

// Pure snapshot analysis: no I/O, wall clock, random IDs, or mutation of inputs.
// Live JSONL stays unchanged; only separate, explicitly synthetic fixtures use cloud/endpoint.
export function detectThreats(events) {
  if (!Array.isArray(events)) invalid();
  const ids = new Set(), assets = new Map();
  for (const input of events) {
    if (!input || ['eventId', 'timestamp', 'assetId', 'source', 'eventType'].some(k => typeof input[k] !== 'string' || !input[k])) invalid();
    const time = Date.parse(input.timestamp);
    if (!Number.isFinite(time) || new Date(time).toISOString() !== input.timestamp || ids.has(input.eventId)) invalid();
    const live = input.source === 'local-http';
    if (live) {
      const success = input.statusCode === 200;
      if (input.synthetic !== undefined || ![200, 401].includes(input.statusCode) ||
          input.outcome !== (success ? 'success' : 'failure') ||
          input.eventType !== (success ? 'authentication_success' : 'authentication_failure')) invalid();
    } else if (!['cloud', 'endpoint'].includes(input.source) || input.synthetic !== true) invalid();
    ids.add(input.eventId);
    const event = { eventId: input.eventId, timestamp: input.timestamp, time, assetId: input.assetId,
      source: input.source, eventType: input.eventType, synthetic: input.synthetic === true };
    if (!assets.has(event.assetId)) assets.set(event.assetId, []);
    assets.get(event.assetId).push(event);
  }
  const results = [];
  for (const unsorted of assets.values()) {
    const sorted = unsorted.sort((a, b) => a.time - b.time || compare(a.eventId, b.eventId));
    const auth = sorted.filter(e => e.source === 'local-http');

    // R001: consume each first qualifying batch of five; no overlapping evidence.
    let burst = [];
    for (const event of auth) {
      if (event.eventType !== 'authentication_failure') continue;
      burst = burst.filter(e => event.time - e.time <= 60000);
      burst.push(event);
      if (burst.length === 5) {
        results.push(detection('KG-R001', burst,
          '동일 자산에서 60초 이내 인증 실패 5건을 관찰했습니다. 침해 확정이 아닌 의심 신호입니다.', { failureCount: 5 }));
        burst = [];
      }
    }

    // R002: evaluate successes before adding failures at the SAME timestamp.
    // Thus ID ordering cannot make simultaneous failures count as earlier failures.
    let failures = [], head = 0;
    for (let index = 0; index < auth.length;) {
      let end = index + 1;
      while (end < auth.length && auth[end].time === auth[index].time) end++;
      const group = auth.slice(index, end);
      while (head < failures.length && group[0].time - failures[head].time > 120000) head++;
      for (const success of group.filter(e => e.eventType === 'authentication_success')) {
        if (failures.length - head >= 3) {
          const evidence = [...failures.slice(head), success];
          results.push(detection('KG-R002', evidence,
            '동일 자산에서 120초 이내 실패 3건 이상 이후 성공을 관찰했습니다. 사용자·공격자 식별자가 없어 동일 인물의 로그인이나 침해로 단정할 수 없습니다.',
            { failureCount: evidence.length - 1, successEventId: success.eventId }));
          failures = []; head = 0;
        }
      }
      failures.push(...group.filter(e => e.eventType === 'authentication_failure'));
      index = end;
    }

    // R003: pair with the nearest unused opposite-source anomaly, then consume both.
    const pending = { cloud: [], endpoint: [] };
    for (const event of sorted) {
      if (!event.synthetic || event.eventType !== `${event.source}_anomaly`) continue;
      const opposite = event.source === 'cloud' ? 'endpoint' : 'cloud';
      const previous = pending[opposite].at(-1);
      if (previous && event.time - previous.time <= 300000) {
        pending[opposite].pop();
        const evidence = [previous, event];
        results.push(detection('KG-R003', evidence,
          '교육용 합성 Cloud·Endpoint 이상 이벤트가 동일 자산에서 5분 이내 관찰되었습니다. 자산·시간 기반 상관관계이며 실제 수집·인과관계·침해의 증거가 아닙니다.',
          { correlation: { timeDifferenceMs: event.time - previous.time,
            eventSources: evidence.map(e => ({ eventId: e.eventId, source: e.source })),
            basis: 'same_asset_distinct_sources_within_300_seconds' } }));
      } else pending[event.source].push(event);
    }
  }
  return results.sort((a, b) => Date.parse(b.detectedAt) - Date.parse(a.detectedAt) ||
    compare(a.ruleId, b.ruleId) || compare(a.detectionId, b.detectionId));
}
