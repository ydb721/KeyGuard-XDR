import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectThreats } from '../rule-engine.mjs';
import { crossSourceFixture } from './fixtures/cross-source.mjs';

const base = Date.parse('2026-11-03T00:00:00.000Z');
const event = (id, milliseconds, success = false, assetId = 'demo-asset-a') => ({
  eventId: `test-${String(id).padStart(4, '0')}`, timestamp: new Date(base + milliseconds).toISOString(),
  source: 'local-http', eventType: success ? 'authentication_success' : 'authentication_failure',
  method: 'GET', path: '/api/test/resource', statusCode: success ? 200 : 401,
  outcome: success ? 'success' : 'failure', assetId,
});
const failures = (times, asset) => times.map((time, index) => event(index, time, false, asset));
const rule = (events, id) => detectThreats(events).filter(d => d.ruleId === id);

test('normal scenario: successes and four failures do not trigger R001', () => {
  assert.deepEqual(detectThreats([]), []);
  assert.deepEqual(detectThreats([event(9, 0, true), event(10, 1, true)]), []);
  assert.deepEqual(detectThreats(failures([0, 1000, 2000, 3000])), []);
});

test('suspicious scenario: five failures at the inclusive 60-second boundary trigger R001', () => {
  const events = failures([0, 1000, 2000, 3000, 60000]);
  const [d] = rule(events, 'KG-R001');
  assert.equal(d.detectionType, 'authentication_failure_burst');
  assert.equal(d.severity, 'MEDIUM'); assert.equal(d.failureCount, 5); assert.equal(d.eventCount, 5);
  assert.deepEqual(d.evidenceEventIds, events.map(e => e.eventId));
  assert.deepEqual(d.analysisWindow, { start: events[0].timestamp, end: events[4].timestamp, durationSeconds: 60 });
  assert.equal(d.detectedAt, events[4].timestamp);
  assert.deepEqual(d.observedSources, ['local-http']); assert.equal(d.synthetic, false);
});

test('R001 excludes failures older than 60 seconds and crosses UTC minute buckets', () => {
  assert.equal(rule(failures([0, 1000, 2000, 3000, 60001]), 'KG-R001').length, 0);
  assert.equal(rule(failures([59000, 60000, 61000, 62000, 63000]), 'KG-R001').length, 1);
});

test('R001 never sums failures across assets', () => {
  const a = failures([0, 1000, 2000, 3000], 'demo-asset-a');
  const b = failures([0, 1000, 2000, 3000], 'demo-asset-b').map(e => ({ ...e, eventId: 'b-' + e.eventId }));
  assert.deepEqual(detectThreats([...a, ...b]), []);
});

test('R001 consumes disjoint batches: ten failures produce two warnings; later input preserves earlier IDs', () => {
  const events = failures(Array.from({ length: 10 }, (_, i) => i * 1000));
  const first = rule(events.slice(0, 5), 'KG-R001');
  const both = rule(events, 'KG-R001');
  assert.equal(both.length, 2);
  assert.ok(both.some(d => d.detectionId === first[0].detectionId));
  assert.equal(new Set(both.flatMap(d => d.evidenceEventIds)).size, 10);
});

test('suspicious sequence: three failures followed by success at 120 seconds trigger R002', () => {
  const events = [...failures([0, 1000, 2000]), event(9, 120000, true)];
  const [d] = rule(events, 'KG-R002');
  assert.equal(d.detectionType, 'suspicious_authentication_sequence');
  assert.equal(d.severity, 'MEDIUM'); assert.equal(d.failureCount, 3); assert.equal(d.eventCount, 4);
  assert.equal(d.successEventId, events[3].eventId);
  assert.deepEqual(d.evidenceEventIds, events.map(e => e.eventId));
  assert.equal(d.analysisWindow.durationSeconds, 120);
  assert.match(d.reason, /동일 인물.*단정할 수 없습니다/);
});

test('normal/insufficient sequence: fewer failures, expiry, success first or asset mismatch do not trigger R002', () => {
  for (const events of [
    [...failures([0, 1000]), event(9, 2000, true)],
    [...failures([0, 1000, 2000]), event(9, 120001, true)],
    [event(9, 0, true), ...failures([1000, 2000, 3000])],
    [...failures([0, 1000, 2000]), event(9, 3000, true, 'demo-asset-b')],
  ]) assert.equal(rule(events, 'KG-R002').length, 0);
});

test('R002 excludes simultaneous failures regardless of event-ID ordering', () => {
  for (const id of ['000-first', 'zzz-last']) {
    const same = [...failures([1000, 1000, 1000]), { ...event(9, 1000, true), eventId: id }];
    assert.equal(rule(same, 'KG-R002').length, 0);
  }
  const events = [...failures([0, 0, 0]), event(9, 0, true), event(10, 1, true)];
  const [d] = rule(events, 'KG-R002'); assert.equal(d.successEventId, events[4].eventId);
});

test('R002 consumes qualifying failures and does not warn again for repeated successes', () => {
  const events = [...failures([0, 1000, 2000]), event(9, 3000, true), event(10, 4000, true)];
  assert.equal(rule(events, 'KG-R002').length, 1);
  const tied = [...failures([0, 1000, 2000]), event(10, 3000, true), event(9, 3000, true)];
  const [d] = rule(tied, 'KG-R002');
  assert.equal(d.successEventId, event(9, 3000, true).eventId);
  assert.deepEqual(detectThreats(tied), detectThreats([...tied].reverse()));
});

test('UTC sorting, equal-time ID ties, repeated snapshots and immutable inputs are deterministic', () => {
  const events = [...failures([0, 0, 0, 0, 0]), event(9, 1, true), ...crossSourceFixture];
  const frozen = Object.freeze(events.map(e => Object.freeze({ ...e })));
  const before = JSON.stringify(frozen);
  const expected = detectThreats(frozen);
  assert.equal(expected.length, 3);
  assert.deepEqual(detectThreats([...frozen].reverse()), expected);
  assert.deepEqual(detectThreats(frozen), expected);
  assert.equal(JSON.stringify(frozen), before);
  assert.equal(new Set(expected.map(d => d.detectionId)).size, 3);
  assert.ok(expected.every(d => /^KGD-[0-9a-f]{64}$/.test(d.detectionId)));
  assert.deepEqual(expected.map(d => d.ruleId), ['KG-R003', 'KG-R002', 'KG-R001']);
  assert.deepEqual(expected.find(d => d.ruleId === 'KG-R001').evidenceEventIds, frozen.slice(0, 5).map(e => e.eventId));
});

test('synthetic Cloud/Endpoint fixture triggers R003 at inclusive five-minute boundary', () => {
  const [d] = detectThreats(crossSourceFixture);
  assert.equal(d.ruleId, 'KG-R003'); assert.equal(d.severity, 'MEDIUM');
  assert.equal(d.detectionType, 'cross_source_suspicious_activity');
  assert.equal(d.synthetic, true); assert.equal(d.eventCount, 2);
  assert.deepEqual(d.observedSources, ['cloud', 'endpoint']);
  assert.deepEqual(d.evidenceEventIds, crossSourceFixture.map(e => e.eventId));
  assert.equal(d.correlation.timeDifferenceMs, 300000);
  assert.deepEqual(d.correlation.eventSources, crossSourceFixture.map(e => ({ eventId: e.eventId, source: e.source })));
  assert.match(d.reason, /합성/); assert.match(d.reason, /실제 수집.*아닙니다/);
});

test('normal correlation controls: asset mismatch, timeout, same source or benign event do not trigger R003', () => {
  for (const change of [
    { assetId: 'different-asset' },
    { timestamp: new Date(base + 300001).toISOString() },
    { source: 'cloud', eventType: 'cloud_anomaly' },
    { eventType: 'normal_activity' },
  ]) assert.deepEqual(detectThreats([crossSourceFixture[0], { ...crossSourceFixture[1], ...change }]), []);
});

test('R003 simultaneous anomalies correlate deterministically and evidence is not reused', () => {
  const events = [crossSourceFixture[0], ...[1, 2].map(i => ({ ...crossSourceFixture[1],
    eventId: `fixture-endpoint-${i}`, timestamp: crossSourceFixture[0].timestamp }))];
  assert.equal(detectThreats(events).length, 1);
  assert.deepEqual(detectThreats(events), detectThreats([...events].reverse()));
  const nearest = [crossSourceFixture[0],
    { ...crossSourceFixture[0], eventId: 'fixture-cloud-nearer', timestamp: new Date(base + 1000).toISOString() },
    { ...crossSourceFixture[1], timestamp: new Date(base + 2000).toISOString() }];
  assert.deepEqual(detectThreats(nearest)[0].evidenceEventIds, [nearest[1].eventId, nearest[2].eventId]);
  assert.equal(detectThreats(nearest)[0].correlation.timeDifferenceMs, 1000);
});

test('unmarked synthetic sources, duplicate IDs and invalid timestamps are rejected without reflecting input', () => {
  for (const events of [
    [{ ...crossSourceFixture[0], synthetic: false }],
    [event(0, 0), event(0, 1000)],
    [{ ...event(0, 0), timestamp: 'Authorization-private-marker' }],
  ]) assert.throws(() => detectThreats(events), { message: 'INVALID_RULE_EVENT' });
});

test('rule outputs project evidence identifiers and never copy raw token/header payloads', () => {
  const events = failures([0, 1000, 2000, 3000, 4000]).map(e => ({ ...e,
    authorization: 'Bearer private-marker', headers: { Authorization: 'private-marker' }, token: 'private-marker' }));
  const result = JSON.stringify(detectThreats(events));
  assert.ok(!result.includes('private-marker')); assert.ok(!result.includes('Authorization'));
  assert.ok(!result.includes('headers'));
});
