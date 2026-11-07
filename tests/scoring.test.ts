import { describe, expect, it } from 'vitest';
import { findSimilarIncidents, jaccard, MATCH_THRESHOLD, recencyBoost, RECENCY_FLOOR, RECENCY_HALF_LIFE_DAYS } from '../src/core/scoring';
import type { IncidentRecord } from '../src/core/types';

const NOW = new Date('2026-11-08T12:00:00.000Z');

function incident(overrides: Partial<IncidentRecord> & Pick<IncidentRecord, 'key'>): IncidentRecord {
  return {
    id: 1,
    summary: '',
    description: '',
    services: [],
    labels: [],
    createdAt: '2026-11-08T11:00:00.000Z',
    resolvedAt: '2026-11-08T11:30:00.000Z',
    minutesToResolve: 30,
    participants: [],
    postmortemLinks: [],
    ...overrides,
  };
}

describe('jaccard', () => {
  it('is 1 for identical sets', () => {
    expect(jaccard(['payments-gateway'], ['payments-gateway'])).toBe(1);
  });

  it('is 0 for disjoint sets', () => {
    expect(jaccard(['search'], ['payments'])).toBe(0);
  });

  it('handles partial overlap', () => {
    expect(jaccard(['a', 'b'], ['b', 'c'])).toBeCloseTo(1 / 3, 3);
  });

  it('is case-insensitive', () => {
    expect(jaccard(['Payments-Gateway'], ['payments-gateway'])).toBe(1);
  });

  it('returns 0 for two empty sets', () => {
    expect(jaccard([], [])).toBe(0);
  });
});

describe('recencyBoost', () => {
  it('is maximal for a just-resolved incident', () => {
    expect(recencyBoost('2026-11-08T11:59:00.000Z', NOW)).toBeCloseTo(1, 3);
  });

  it('halves after one half-life', () => {
    const resolved = new Date(NOW.getTime() - RECENCY_HALF_LIFE_DAYS * 86_400_000).toISOString();
    expect(recencyBoost(resolved, NOW)).toBeCloseTo(0.5, 3);
  });

  it('never drops below the floor', () => {
    const ancient = '2020-01-01T00:00:00.000Z';
    expect(recencyBoost(ancient, NOW)).toBe(RECENCY_FLOOR);
  });

  it('returns the floor for unresolved incidents', () => {
    expect(recencyBoost(undefined, NOW)).toBe(RECENCY_FLOOR);
  });
});

describe('findSimilarIncidents', () => {
  const target = incident({
    key: 'IN-2101',
    summary: 'Checkout returning 502 after card authorization step',
    description: 'Card authorized but confirmation callback fails with 502. Gateway connection pool saturated.',
    services: ['payments-gateway', 'checkout-web'],
    labels: ['payments', 'checkout', 'latency'],
  });

  const twin = incident({
    key: 'IN-1873',
    summary: 'Checkout returning 502 after card authorization step',
    description: 'Card authorization succeeds at the processor but our confirmation callback fails. Gateway connection pool saturated.',
    services: ['payments-gateway', 'checkout-web'],
    labels: ['payments', 'checkout', 'latency'],
    minutesToResolve: 214,
    resolvedByName: 'Mei Tanaka',
    fixSummary: 'Rolled back payments-gateway 4.19.1; pool exhaustion traced to new 3DS callback path',
  });

  const cousin = incident({
    key: 'IN-1801',
    summary: 'Payment gateway timeouts during flash sale checkout',
    description: 'Gateway p99 latency 8s+, checkout confirmations timing out. Connection pool exhausted.',
    services: ['payments-gateway'],
    labels: ['payments', 'latency', 'capacity'],
    minutesToResolve: 167,
  });

  const unrelated = incident({
    key: 'IN-1588',
    summary: 'Order confirmation emails delayed by 20 minutes',
    description: 'Notifications queue backed up after consumer crash-loop on malformed emoji.',
    services: ['notifications'],
    labels: ['email', 'queue'],
    minutesToResolve: 41,
  });

  const corpus = [twin, cousin, unrelated];

  it('ranks the near-identical incident first with a high score', () => {
    const [top] = findSimilarIncidents(target, corpus, NOW);
    expect(top?.incident.key).toBe('IN-1873');
    expect(top!.score).toBeGreaterThan(0.75);
  });

  it('ranks the service-matching cousin above the unrelated incident', () => {
    const result = findSimilarIncidents(target, corpus, NOW);
    const keys = result.map((r) => r.incident.key);
    expect(keys.indexOf('IN-1801')).toBeGreaterThan(-1);
    if (keys.includes('IN-1588')) {
      expect(keys.indexOf('IN-1801')).toBeLessThan(keys.indexOf('IN-1588'));
    }
  });

  it('excludes matches below the threshold', () => {
    const result = findSimilarIncidents(target, corpus, NOW);
    for (const r of result) expect(r.score).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
  });

  it('drops the target itself and unresolved candidates', () => {
    const open = incident({ key: 'IN-OPEN', summary: 'Checkout returning 502 after card authorization', resolvedAt: undefined });
    const result = findSimilarIncidents(target, [target, twin, open], NOW);
    expect(result.map((r) => r.incident.key)).not.toContain('IN-2101');
    expect(result.map((r) => r.incident.key)).not.toContain('IN-OPEN');
  });

  it('explains every score with all four factors', () => {
    const [top] = findSimilarIncidents(target, corpus, NOW);
    const factors = top!.explanation.map((e) => e.factor);
    expect(factors).toEqual(['text-similarity', 'service-overlap', 'label-overlap', 'recency']);
    const total = top!.explanation.reduce((s, f) => s + f.contribution, 0);
    expect(total).toBeCloseTo(top!.score, 3);
  });

  it('breaks score ties deterministically by key', () => {
    const a = incident({ key: 'IN-B', summary: 'identical gateway pool exhaustion text' });
    const b = incident({ key: 'IN-A', summary: 'identical gateway pool exhaustion text' });
    const result = findSimilarIncidents(target, [a, b, twin], NOW);
    const keys = result.map((r) => r.incident.key);
    if (keys.includes('IN-A') && keys.includes('IN-B')) {
      expect(keys.indexOf('IN-A')).toBeLessThan(keys.indexOf('IN-B'));
    }
  });

  it('respects the limit', () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      incident({ key: `IN-${i}`, summary: 'Checkout returning 502 after card authorization step', services: ['payments-gateway'] })
    );
    expect(findSimilarIncidents(target, many, NOW, 3)).toHaveLength(3);
  });

  it('returns [] for an empty corpus', () => {
    expect(findSimilarIncidents(target, [], NOW)).toEqual([]);
  });

  it('produces identical output for identical inputs (determinism)', () => {
    const r1 = findSimilarIncidents(target, corpus, NOW);
    const r2 = findSimilarIncidents(target, corpus, NOW);
    expect(r1).toEqual(r2);
  });
});
