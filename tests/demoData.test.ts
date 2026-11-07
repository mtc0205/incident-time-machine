import { describe, expect, it } from 'vitest';
import { buildDemoCorpus, buildDemoTargetIncident, DEMO_CURRENT_INCIDENT, mulberry32 } from '../src/core/demoData';
import type { EnginePorts } from '../src/core/engine';
import { buildDigestForIssue } from '../src/core/engine';
import type { ChangeEvent, IncidentRecord } from '../src/core/types';

const NOW = new Date('2026-11-08T12:00:00.000Z');

describe('mulberry32', () => {
  it('produces identical sequences for identical seeds', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 10; i++) expect(a()).toBe(b());
  });

  it('stays in [0, 1)', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('buildDemoCorpus', () => {
  const corpus = buildDemoCorpus(NOW);

  it('is deterministic for a fixed now', () => {
    expect(buildDemoCorpus(NOW)).toEqual(corpus);
  });

  it('anchors history before now and resolves after creation', () => {
    for (const inc of corpus.incidents) {
      expect(new Date(inc.createdAt).getTime()).toBeLessThan(NOW.getTime());
      expect(new Date(inc.resolvedAt!).getTime()).toBeGreaterThan(new Date(inc.createdAt).getTime());
      expect(inc.minutesToResolve).toBeGreaterThan(0);
    }
  });

  it('has full referential integrity', () => {
    for (const inc of corpus.incidents) {
      expect(inc.key).toMatch(/^IN-\d+$/);
      expect(inc.services.length).toBeGreaterThan(0);
      expect(inc.fixSummary!.length).toBeGreaterThan(10);
      expect(inc.resolvedByName).toBeTruthy();
      for (const link of inc.postmortemLinks) {
        expect(link.url).toMatch(/^https:\/\//);
        expect(link.title.length).toBeGreaterThan(5);
      }
    }
    for (const ch of corpus.changes) {
      expect(['deployment', 'pull-request']).toContain(ch.kind);
      expect(ch.services.length).toBeGreaterThan(0);
      expect(ch.authorName).toBeTruthy();
      if (ch.url) expect(ch.url).toMatch(/^https:\/\//);
    }
  });

  it('contains a smoking-gun deploy inside the correlation window of the demo incident', () => {
    const target = buildDemoTargetIncident(NOW);
    const onset = new Date(target.createdAt).getTime();
    const near = corpus.changes.filter(
      (c) => new Date(c.completedAt).getTime() < onset && onset - new Date(c.completedAt).getTime() < 6 * 3_600_000
    );
    expect(near.length).toBeGreaterThan(0);
    expect(near.some((c) => c.services.includes('payments-gateway'))).toBe(true);
  });

  it('keeps incident history spread across the last ~18 months', () => {
    const ages = corpus.incidents.map((i) => (NOW.getTime() - new Date(i.createdAt).getTime()) / 86_400_000);
    const newest = Math.min(...ages);
    const oldest = Math.max(...ages);
    expect(newest).toBeGreaterThan(20);
    expect(oldest).toBeGreaterThan(400);
  });
});

describe('buildDemoTargetIncident', () => {
  it('mirrors DEMO_CURRENT_INCIDENT copy', () => {
    const target = buildDemoTargetIncident(NOW);
    expect(target.summary).toBe(DEMO_CURRENT_INCIDENT.summary);
    expect(target.services).toEqual([...DEMO_CURRENT_INCIDENT.services]);
  });

  it('started recently relative to now', () => {
    const target = buildDemoTargetIncident(NOW);
    const minutesAgo = (NOW.getTime() - new Date(target.createdAt).getTime()) / 60_000;
    expect(minutesAgo).toBeGreaterThan(0);
    expect(minutesAgo).toBeLessThan(60);
  });
});

/** In-memory ports for engine tests. */
function makePorts(overrides: Partial<EnginePorts> = {}): EnginePorts {
  return {
    getIssue: async () => undefined,
    searchResolvedIncidents: async () => [],
    getGraphChanges: async () => [],
    getLinkedKnowledge: async () => [],
    isDemoMode: async () => false,
    ...overrides,
  } as EnginePorts;
}

describe('buildDigestForIssue (engine)', () => {
  const liveIssue: IncidentRecord = {
    key: 'IN-2101',
    id: 2101,
    summary: 'Checkout returning 502 after card authorization step',
    description: 'Cards authorized but confirmation fails. Gateway pool saturated.',
    services: ['payments-gateway', 'checkout-web'],
    labels: ['payments', 'checkout'],
    createdAt: '2026-11-08T11:37:00.000Z',
    participants: [],
    postmortemLinks: [],
  };

  it('produces a demo digest on a fresh site (live corpus < 3), clearly labeled', async () => {
    const digest = await buildDigestForIssue(makePorts(), 'IN-2101', { now: NOW });
    expect(digest.source).toBe('demo');
    expect(digest.matches.length).toBeGreaterThan(0);
  });

  it('uses live corpus when the site has history', async () => {
    const liveCorpus = buildDemoCorpus(NOW).incidents.map((i) => ({ ...i }));
    const digest = await buildDigestForIssue(
      makePorts({
        getIssue: async () => liveIssue,
        searchResolvedIncidents: async () => liveCorpus,
        getGraphChanges: async () => buildDemoCorpus(NOW).changes,
      }),
      'IN-2101',
      { now: NOW }
    );
    expect(digest.source).toBe('live');
    expect(digest.matches[0]?.incident.key).toBe('IN-1873');
    expect(digest.suspects.length).toBeGreaterThan(0);
  });

  it('returns an empty-but-valid digest when nothing matches', async () => {
    const singleOdd = [
      {
        ...liveIssue,
        key: 'IN-OLD',
        id: 1,
        summary: 'Printer on fire in the Oslo office',
        description: 'Physical printer, actual fire. Extinguished.',
        services: ['facilities'],
        labels: ['physical'],
      },
      { ...liveIssue, key: 'IN-OLD2', id: 2, summary: 'Coffee machine descaling overdue', services: ['facilities'], labels: ['beverages'] },
    ];
    const digest = await buildDigestForIssue(
      makePorts({
        getIssue: async () => liveIssue,
        searchResolvedIncidents: async () => singleOdd,
      }),
      'IN-2101',
      { now: NOW }
    );
    // live corpus only has 2 (<3) -> demo fallback kicks in, labeled
    expect(digest.source).toBe('demo');
  });

  it('demo mode always wins when enabled', async () => {
    const digest = await buildDigestForIssue(
      makePorts({
        isDemoMode: async () => true,
        getIssue: async () => liveIssue,
        searchResolvedIncidents: async () => buildDemoCorpus(NOW).incidents,
      }),
      'IN-2101',
      { now: NOW }
    );
    expect(digest.source).toBe('demo');
  });

  it('demo mode uses the real issue as target when it has text', async () => {
    const digest = await buildDigestForIssue(
      makePorts({
        isDemoMode: async () => true,
        getIssue: async () => liveIssue,
      }),
      'IN-2101',
      { now: NOW }
    );
    expect(digest.issueKey).toBe('IN-2101');
    expect(digest.matches[0]?.incident.services).toContain('payments-gateway');
  });

  it('end-to-end: the demo digest names the smoking-gun deploy as top suspect', async () => {
    const digest = await buildDigestForIssue(
      makePorts({ isDemoMode: async () => true }),
      'ANY',
      { now: NOW }
    );
    expect(digest.suspects[0]?.change.services).toContain('payments-gateway');
    expect(digest.suspects[0]?.explanation[0]).toMatch(/landed \d+(\.\d+)?h before the incident/);
    expect(digest.suggestedResponders[0]?.name).toBe('Mei Tanaka');
  });
});

describe('demo corpus realism (judging quality gate)', () => {
  it('covers multiple services with plausible incident language', () => {
    const corpus = buildDemoCorpus(NOW);
    const services = new Set(corpus.incidents.flatMap((i) => i.services));
    expect(services.size).toBeGreaterThanOrEqual(5);
    const texts = corpus.incidents.map((i) => `${i.summary} ${i.description}`.toLowerCase()).join(' ');
    for (const word of ['latency', 'timeout', 'pool', 'queue', 'checkout', 'payment', 'rolled back']) {
      expect(texts).toContain(word);
    }
  });

  it('includes both deployments and pull requests', () => {
    const kinds = new Set(buildDemoCorpus(NOW).changes.map((c: ChangeEvent) => c.kind));
    expect(kinds).toEqual(new Set(['deployment', 'pull-request']));
  });
});
