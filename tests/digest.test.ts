import { describe, expect, it } from 'vitest';
import {
  buildDigest,
  buildResponderSuggestions,
  digestToAgentSummary,
  digestToCommentMarkdown,
  escapeWiki,
  formatDuration,
  pct,
} from '../src/core/digest';
import type { ScoredChange, ScoredIncident } from '../src/core/types';

const NOW = new Date('2026-11-08T12:00:00.000Z');

function match(key: string, score: number, overrides: Partial<ScoredIncident['incident']> = {}): ScoredIncident {
  return {
    incident: {
      key,
      id: 1,
      summary: `Incident ${key} summary`,
      description: '',
      services: ['payments-gateway'],
      labels: ['payments'],
      createdAt: '2026-05-01T10:00:00.000Z',
      resolvedAt: '2026-05-01T12:00:00.000Z',
      minutesToResolve: 120,
      participants: [],
      resolvedByName: 'Mei Tanaka',
      fixSummary: 'Rolled back payments release',
      postmortemLinks: [{ title: 'Postmortem', url: 'https://example.atlassian.net/wiki/x/1', source: 'demo' }],
      ...overrides,
    },
    score,
    explanation: [
      { factor: 'text-similarity', contribution: score * 0.55, detail: 'text similarity 80% × weight 0.55' },
      { factor: 'service-overlap', contribution: score * 0.25, detail: 'shared services: payments-gateway' },
      { factor: 'label-overlap', contribution: 0, detail: 'no shared labels' },
      { factor: 'recency', contribution: score * 0.2, detail: 'resolved 190 days ago' },
    ],
  };
}

describe('formatDuration', () => {
  it('renders minutes under an hour', () => {
    expect(formatDuration(12)).toBe('12m');
    expect(formatDuration(59)).toBe('59m');
  });

  it('renders hours with minutes', () => {
    expect(formatDuration(95)).toBe('1h 35m');
  });

  it('renders days with hours', () => {
    expect(formatDuration(4800)).toBe('3d 8h');
  });

  it('handles invalid input', () => {
    expect(formatDuration(Number.NaN)).toBe('—');
    expect(formatDuration(-5)).toBe('—');
  });
});

describe('pct', () => {
  it('renders whole percentages', () => {
    expect(pct(0.8123)).toBe('81%');
    expect(pct(0.28)).toBe('28%');
  });
});

describe('escapeWiki', () => {
  it('escapes Jira wiki markup metacharacters', () => {
    expect(escapeWiki('array[i] | {code} !bang!')).toBe('array\\[i\\] \\| \\{code\\} \\!bang\\!');
  });

  it('leaves plain text untouched', () => {
    expect(escapeWiki('payments gateway latency')).toBe('payments gateway latency');
  });
});

describe('buildDigest', () => {
  const matches = [match('IN-1873', 0.91), match('IN-1801', 0.72), match('IN-1521', 0.55)];
  const suspects: ScoredChange[] = [
    {
      change: {
        id: 'deploy-9012',
        kind: 'deployment',
        title: 'Release 4.22.1 → production (payments)',
        services: ['payments-gateway'],
        completedAt: '2026-11-08T09:48:00.000Z',
        authorName: 'Mei Tanaka',
        repository: 'northbeam/payments-gateway',
        ref: 'a91f37c',
        url: 'https://bitbucket.org/x/y',
      },
      score: 0.86,
      explanation: ['landed 2.2h before the incident (time proximity 100%)', 'touches the same service(s): payments-gateway'],
    },
  ];

  it('computes median MTTR across matches', () => {
    const digest = buildDigest('IN-2101', matches, suspects, 'live', NOW);
    expect(digest.stats.medianMinutesToResolve).toBe(120);
  });

  it('keeps best-match resolution time', () => {
    const digest = buildDigest('IN-2101', matches, suspects, 'live', NOW);
    expect(digest.stats.bestMatchMinutesToResolve).toBe(120);
  });

  it('aggregates affected services sorted and unique', () => {
    const digest = buildDigest('IN-2101', matches, suspects, 'live', NOW);
    expect(digest.stats.servicesAffected).toEqual(['payments-gateway']);
  });

  it('suggests responders ranked by weighted resolutions', () => {
    const digest = buildDigest('IN-2101', matches, suspects, 'live', NOW);
    expect(digest.suggestedResponders[0]?.name).toBe('Mei Tanaka');
    expect(digest.suggestedResponders[0]?.resolvedCount).toBe(3);
  });

  it('handles the empty digest gracefully', () => {
    const digest = buildDigest('IN-0001', [], [], 'live', NOW);
    expect(digest.stats.matchedCount).toBe(0);
    expect(digest.stats.medianMinutesToResolve).toBeUndefined();
    expect(digestToCommentMarkdown(digest)).toMatch(/No similar resolved incidents/i);
  });
});

describe('buildResponderSuggestions', () => {
  it('groups by person and cites incidents', () => {
    const suggestions = buildResponderSuggestions([
      match('IN-1', 0.9, { resolvedByName: 'Mei Tanaka' }),
      match('IN-2', 0.8, { resolvedByName: 'Diego Ramírez' }),
      match('IN-3', 0.7, { resolvedByName: 'Mei Tanaka' }),
    ]);
    expect(suggestions[0]).toMatchObject({ name: 'Mei Tanaka', resolvedCount: 2, basedOn: ['IN-1', 'IN-3'] });
    expect(suggestions[1]).toMatchObject({ name: 'Diego Ramírez', resolvedCount: 1 });
  });
});

describe('digestToCommentMarkdown', () => {
  const matches = [match('IN-1873', 0.91), match('IN-1801', 0.72)];
  const digest = buildDigest('IN-2101', matches, [], 'live', NOW);

  it('leads with the Time Machine header', () => {
    const md = digestToCommentMarkdown(digest);
    expect(md.split('\n')[0]).toContain('Incident Time Machine');
  });

  it('includes scores, keys, fixes and resolvers', () => {
    const md = digestToCommentMarkdown(digest);
    expect(md).toContain('91% — IN-1873');
    expect(md).toContain('Rolled back payments release');
    expect(md).toContain('Mei Tanaka');
    expect(md).toContain('resolved in 2h 0m');
  });

  it('includes postmortem links', () => {
    expect(digestToCommentMarkdown(digest)).toContain('[Postmortem|https://example.atlassian.net/wiki/x/1]');
  });

  it('labels demo digests', () => {
    const demo = buildDigest('IN-2101', matches, [], 'demo', NOW);
    expect(digestToCommentMarkdown(demo)).toContain('demo corpus');
  });

  it('escapes hostile text from incident fields', () => {
    const evil = match('EVIL-1', 0.9, { summary: 'boom [|remote](https://evil.example) {panel}', resolvedByName: 'a|b' });
    const md = digestToCommentMarkdown(buildDigest('X', [evil], [], 'live', NOW));
    expect(md).not.toMatch(/\[\|/);
    expect(md).toContain('boom');
  });

  it('renders suspect changes with kind, author and timing', () => {
    const suspects: ScoredChange[] = [
      {
        change: {
          id: 'deploy-1',
          kind: 'deployment',
          title: 'Release 4.22.1',
          services: ['payments-gateway'],
          completedAt: '2026-11-08T09:48:00.000Z',
          authorName: 'Mei Tanaka',
          ref: 'a91f37c',
          url: 'https://bitbucket.org/x/y',
        },
        score: 0.86,
        explanation: ['landed 2.2h before the incident (time proximity 100%)', 'touches the same service(s): payments-gateway'],
      },
    ];
    const md = digestToCommentMarkdown(buildDigest('IN-2101', matches, suspects, 'live', NOW));
    expect(md).toContain('*Most likely responsible change*');
    expect(md).toContain('Deploy: Release 4.22.1');
    expect(md).toContain('Mei Tanaka');
    expect(md).toContain('landed 2.2h before the incident');
  });
});

describe('digestToAgentSummary', () => {
  it('summarizes matches compactly for the Rovo agent', () => {
    const digest = buildDigest('IN-2101', [match('IN-1873', 0.91)], [], 'live', NOW);
    const summary = digestToAgentSummary(digest);
    expect(summary).toContain('IN-2101');
    expect(summary).toContain('IN-1873 (91%)');
    expect(summary).toContain('resolved by Mei Tanaka');
  });

  it('states clearly when nothing matched', () => {
    const digest = buildDigest('IN-2101', [], [], 'live', NOW);
    expect(digestToAgentSummary(digest)).toContain('No similar resolved incidents');
  });
});
