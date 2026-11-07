import { describe, expect, it } from 'vitest';
import {
  findSuspectChanges,
  PEAK_DELAY_HOURS,
  prRiskScore,
  relatedNamespace,
  serviceMatchLevel,
  SERVICE_MATCH,
  timeProximity,
  WINDOW_HOURS,
} from '../src/core/changeCorrelator';
import type { ChangeEvent } from '../src/core/types';

const ONSET = new Date('2026-11-08T12:00:00.000Z').getTime();

function changeAt(hoursBefore: number, overrides: Partial<ChangeEvent> = {}): ChangeEvent {
  return {
    id: `c-${hoursBefore}-${overrides.kind ?? 'deployment'}`,
    kind: 'deployment',
    title: 'Release 4.22.1 → production (payments)',
    services: ['payments-gateway'],
    completedAt: new Date(ONSET - hoursBefore * 3_600_000).toISOString(),
    authorName: 'Mei Tanaka',
    repository: 'northbeam/payments-gateway',
    ref: 'a91f37c',
    url: 'https://bitbucket.org/northbeam/payments-gateway/deployments/view/1',
    ...overrides,
  };
}

describe('timeProximity', () => {
  it('peaks for changes 0-3 hours before onset', () => {
    for (const h of [0, 1, PEAK_DELAY_HOURS, 3]) {
      expect(timeProximity(h)).toBe(1);
    }
  });

  it('is zero outside the window', () => {
    expect(timeProximity(WINDOW_HOURS)).toBe(0);
    expect(timeProximity(-WINDOW_HOURS)).toBe(0);
    expect(timeProximity(500)).toBe(0);
  });

  it('decays monotonically after the peak plateau', () => {
    expect(timeProximity(4)).toBeGreaterThan(timeProximity(12));
    expect(timeProximity(12)).toBeGreaterThan(timeProximity(24));
    expect(timeProximity(24)).toBeGreaterThan(timeProximity(47));
  });

  it('scores changes after onset lower than the same distance before', () => {
    expect(timeProximity(-2)).toBeLessThan(timeProximity(2));
  });
});

describe('serviceMatchLevel', () => {
  it('exact when services overlap', () => {
    expect(serviceMatchLevel(['payments-gateway'], ['payments-gateway', 'checkout-web'])).toBe(SERVICE_MATCH.exact);
  });

  it('partial for hyphen-namespace relatives', () => {
    expect(serviceMatchLevel(['payments'], ['payments-gateway'])).toBe(SERVICE_MATCH.partial);
  });

  it('none for disjoint services', () => {
    expect(serviceMatchLevel(['search-service'], ['payments-gateway'])).toBe(SERVICE_MATCH.none);
  });

  it('is case-insensitive', () => {
    expect(serviceMatchLevel(['Payments-Gateway'], ['payments-gateway'])).toBe(SERVICE_MATCH.exact);
  });
});

describe('relatedNamespace', () => {
  it('detects parent-child namespaces', () => {
    expect(relatedNamespace('payments', 'payments-gateway')).toBe(true);
    expect(relatedNamespace('payments-gateway', 'payments')).toBe(true);
  });

  it('rejects identical and unrelated names', () => {
    expect(relatedNamespace('payments', 'payments')).toBe(false);
    expect(relatedNamespace('payments', 'search')).toBe(false);
  });
});

describe('prRiskScore', () => {
  it('is zero for deployments', () => {
    expect(prRiskScore(changeAt(2))).toBe(0);
  });

  it('grows with service breadth for pull requests', () => {
    const narrow = { ...changeAt(2), kind: 'pull-request' as const, services: ['payments-gateway'] };
    const broad = { ...changeAt(2), kind: 'pull-request' as const, services: ['a', 'b', 'c', 'd', 'e', 'f'] };
    expect(prRiskScore(broad)).toBeGreaterThan(prRiskScore(narrow));
    expect(prRiskScore(broad)).toBeLessThanOrEqual(1);
  });
});

describe('findSuspectChanges', () => {
  const incident = {
    key: 'IN-2101',
    createdAt: new Date(ONSET).toISOString(),
    services: ['payments-gateway', 'checkout-web'],
  };

  it('ranks the on-service change 2h before onset first and drops out-of-window changes', () => {
    const suspects = findSuspectChanges(incident, [
      changeAt(2),                    // smoking gun
      changeAt(30, { services: ['search-service'], title: 'Search rebalance' }), // weak exploratory signal
      changeAt(70, { services: ['payments-gateway'], title: 'Old payments deploy' }), // out of window
    ]);
    expect(suspects[0]?.change.id).toContain('c-2-');
    // off-service changes stay as weak exploratory signals, ranked far below
    expect(suspects.map((s) => s.change.title)).toContain('Search rebalance');
    expect(suspects[0]!.score).toBeGreaterThan(suspects[1]!.score * 5);
    // changes outside the ±48h window are excluded entirely
    expect(suspects.map((s) => s.change.title)).not.toContain('Old payments deploy');
  });

  it('downweights off-service changes but keeps them as exploratory signals', () => {
    const onService = changeAt(2, { services: ['payments-gateway'] });
    const offService = changeAt(2, { services: ['identity-provider'], title: 'Identity NTP rollout' });
    const suspects = findSuspectChanges(incident, [onService, offService]);
    expect(suspects).toHaveLength(2);
    expect(suspects[0]!.score).toBeGreaterThan(suspects[1]!.score);
  });

  it('boosts broad pull requests over narrow ones at equal time and service', () => {
    const narrowPr = changeAt(2, { kind: 'pull-request', services: ['payments-gateway'], title: 'Narrow PR' });
    const broadPr = changeAt(2, {
      kind: 'pull-request',
      services: ['payments-gateway', 'checkout-web', 'notifications'],
      title: 'Broad PR',
    });
    const suspects = findSuspectChanges(incident, [narrowPr, broadPr]);
    expect(suspects[0]!.change.title).toBe('Broad PR');
  });

  it('explains itself with at least time and service reasons', () => {
    const [top] = findSuspectChanges(incident, [changeAt(2)]);
    expect(top!.explanation.length).toBeGreaterThanOrEqual(2);
    expect(top!.explanation[0]).toMatch(/landed 2\.0h before/);
    expect(top!.explanation[1]).toMatch(/same service/);
  });

  it('returns [] when nothing is in the window', () => {
    expect(findSuspectChanges(incident, [changeAt(200), changeAt(-200)])).toEqual([]);
  });

  it('respects the limit', () => {
    const many = Array.from({ length: 8 }, (_, i) => changeAt(2 + i * 0.1, { id: `many-${i}` }));
    expect(findSuspectChanges(incident, many, 3)).toHaveLength(3);
  });

  it('is deterministic across runs', () => {
    const changes = [changeAt(2), changeAt(3.3), changeAt(1.2)];
    expect(findSuspectChanges(incident, changes)).toEqual(findSuspectChanges(incident, changes));
  });
});
