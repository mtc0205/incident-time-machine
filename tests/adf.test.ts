import { describe, expect, it } from 'vitest';
import { adfDoc, adfToPlainText, bulletList, code, em, heading, link, paragraph, strong, text_ } from '../src/core/adf';
import { buildDigest, digestToAdf } from '../src/core/digest';
import type { ScoredIncident } from '../src/core/types';

describe('adfToPlainText', () => {
  it('flattens nested ADF structures', () => {
    const doc = adfDoc([
      paragraph(text_('Checkout '), strong('502'), text_(' after auth')),
      bulletList([
        [text_('gateway pool exhausted')],
        [text_('rolled back '), code('4.19.1')],
      ]),
    ]);
    const text = adfToPlainText(doc);
    expect(text).toContain('Checkout');
    expect(text).toContain('502');
    expect(text).toContain('gateway pool exhausted');
    expect(text).toContain('4.19.1');
  });

  it('returns empty string for empty/missing descriptions', () => {
    expect(adfToPlainText(undefined)).toBe('');
    expect(adfToPlainText({ type: 'doc', version: 1, content: [] })).toBe('');
  });

  it('handles plain-string descriptions defensively', () => {
    // Some Jira endpoints return plain strings; never crash on them.
    expect(adfToPlainText('just a string')).toBe('just a string');
  });

  it('separates blocks with newlines', () => {
    const doc = adfDoc([paragraph(text_('first')), paragraph(text_('second'))]);
    expect(adfToPlainText(doc)).toMatch(/first[\s\S]*second/);
    expect(adfToPlainText(doc)).toContain('\n');
  });
});

describe('adf builders', () => {
  it('produce valid structural nodes', () => {
    const doc = adfDoc([heading(2, 'Title'), paragraph(em('subtle'), text_(' '), link('docs', 'https://example.com'))]);
    expect(doc.version).toBe(1);
    expect(doc.content[0]).toMatchObject({ type: 'heading', attrs: { level: 2 } });
    expect(JSON.stringify(doc)).toContain('https://example.com');
  });
});

describe('digestToAdf', () => {
  const match: ScoredIncident = {
    incident: {
      key: 'IN-1873',
      id: 1,
      summary: 'Checkout returning 502 after card authorization step',
      description: '',
      services: ['payments-gateway'],
      labels: ['payments'],
      createdAt: '2026-10-13T09:00:00.000Z',
      resolvedAt: '2026-10-13T12:34:00.000Z',
      minutesToResolve: 214,
      participants: [],
      resolvedByName: 'Mei Tanaka',
      fixSummary: 'Rolled back payments-gateway 4.19.1',
      postmortemLinks: [{ title: 'Postmortem', url: 'https://example.atlassian.net/wiki/x/1', source: 'demo' }],
    },
    score: 0.91,
    explanation: [
      { factor: 'text-similarity', contribution: 0.5, detail: 'x' },
      { factor: 'service-overlap', contribution: 0.25, detail: 'y' },
      { factor: 'label-overlap', contribution: 0, detail: 'z' },
      { factor: 'recency', contribution: 0.1, detail: 'w' },
    ],
  };

  it('renders a valid ADF doc with matches and postmortem link', () => {
    const digest = buildDigest('IN-2101', [match], [], 'live', new Date('2026-11-08T12:00:00.000Z'));
    const adf = digestToAdf(digest);
    expect(adf.type).toBe('doc');
    const json = JSON.stringify(adf);
    expect(json).toContain('Incident Time Machine');
    expect(json).toContain('IN-1873');
    expect(json).toContain('91%');
    expect(json).toContain('Rolled back payments-gateway 4.19.1');
    expect(json).toContain('https://example.atlassian.net/wiki/x/1');
    expect(json).toContain('bulletList');
    expect(json).not.toContain('|'); // no wiki markup leaking into ADF
  });

  it('handles the empty digest', () => {
    const digest = buildDigest('IN-0001', [], [], 'live', new Date('2026-11-08T12:00:00.000Z'));
    const json = JSON.stringify(digestToAdf(digest));
    expect(json).toContain('No similar resolved incidents');
  });

  it('renders suspect changes with kind labels', () => {
    const digest = buildDigest(
      'IN-2101',
      [match],
      [
        {
          change: {
            id: 'deploy-1',
            kind: 'deployment',
            title: 'Release 4.22.1 → production (payments)',
            services: ['payments-gateway'],
            completedAt: '2026-11-08T09:48:00.000Z',
            authorName: 'Mei Tanaka',
            ref: 'a91f37c',
          },
          score: 0.86,
          explanation: ['landed 2.2h before the incident (time proximity 100%)', 'touches the same service(s): payments-gateway'],
        },
      ],
      'live',
      new Date('2026-11-08T12:00:00.000Z')
    );
    const json = JSON.stringify(digestToAdf(digest));
    expect(json).toContain('Deploy: ');
    expect(json).toContain('a91f37c');
    expect(json).toContain('Most likely responsible change');
  });
});
