// Educational fixtures ONLY: never appended to the live nine-field JSONL store.
export const crossSourceFixture = Object.freeze([
  Object.freeze({ eventId: 'fixture-cloud-001', timestamp: '2026-11-03T00:00:00.000Z',
    source: 'cloud', eventType: 'cloud_anomaly', assetId: 'demo-correlation-asset', synthetic: true }),
  Object.freeze({ eventId: 'fixture-endpoint-001', timestamp: '2026-11-03T00:05:00.000Z',
    source: 'endpoint', eventType: 'endpoint_anomaly', assetId: 'demo-correlation-asset', synthetic: true }),
]);
