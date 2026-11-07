import { describe, expect, it } from 'vitest';
import { looksLikeIncident, toIncidentRecord } from '../src/backend/jiraMapping';

describe('looksLikeIncident', () => {
  it('recognizes incident-like issue types', () => {
    expect(looksLikeIncident('Incident')).toBe(true);
    expect(looksLikeIncident('Major Incident')).toBe(true);
    expect(looksLikeIncident('Production Outage')).toBe(true);
    expect(looksLikeIncident('INCIDENT')).toBe(true);
  });

  it('rejects ordinary types and missing names', () => {
    expect(looksLikeIncident('Task')).toBe(false);
    expect(looksLikeIncident('Bug')).toBe(false);
    expect(looksLikeIncident('Story')).toBe(false);
    expect(looksLikeIncident(undefined)).toBe(false);
    expect(looksLikeIncident('')).toBe(false);
  });
});

describe('toIncidentRecord', () => {
  it('maps a full JSM issue payload', () => {
    const record = toIncidentRecord({
      id: '2101',
      key: 'IN-2101',
      fields: {
        summary: 'Checkout 502s',
        description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Gateway pool exhausted' }] }] },
        labels: ['payments', 'service:payments-gateway'],
        components: [{ name: 'Checkout Web' }],
        created: '2026-11-08T11:00:00.000Z',
        resolutiondate: '2026-11-08T14:34:00.000Z',
        assignee: { accountId: 'acc-1', displayName: 'Mei Tanaka' },
        issuetype: { name: 'Incident' },
      },
    });
    expect(record).toBeDefined();
    expect(record!.services).toContain('payments-gateway');
    expect(record!.services).toContain('checkout web');
    expect(record!.labels).toEqual(['payments']);
    expect(record!.description).toContain('Gateway pool exhausted');
    expect(record!.minutesToResolve).toBe(214);
    expect(record!.resolvedByName).toBe('Mei Tanaka');
  });

  it('splits service: labels out of the label set', () => {
    const record = toIncidentRecord({
      key: 'X-1',
      fields: { labels: ['service:search', 'urgent', 'SERVICE:Checkout'] },
    });
    expect(record!.services.sort()).toEqual(['checkout', 'search']);
    expect(record!.labels).toEqual(['urgent']);
  });

  it('treats unresolved issues as open (no resolvedAt, no MTTR)', () => {
    const record = toIncidentRecord({
      key: 'X-2',
      fields: { summary: 'ongoing', created: '2026-11-08T11:00:00.000Z' },
    });
    expect(record!.resolvedAt).toBeUndefined();
    expect(record!.minutesToResolve).toBeUndefined();
  });

  it('returns undefined without a key and survives empty fields', () => {
    expect(toIncidentRecord({ id: '1' })).toBeUndefined();
    expect(toIncidentRecord({ key: 'X-3', fields: {} })!.summary).toBe('');
  });

  it('never yields negative MTTR for clock skew', () => {
    const record = toIncidentRecord({
      key: 'X-4',
      fields: { created: '2026-11-08T11:00:00.000Z', resolutiondate: '2026-11-08T10:00:00.000Z' },
    });
    expect(record!.minutesToResolve).toBeGreaterThanOrEqual(1);
  });
});
