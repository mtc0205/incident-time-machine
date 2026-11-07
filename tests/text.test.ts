import { describe, expect, it } from 'vitest';
import {
  cosineSimilarity,
  documentFrequencies,
  incidentDocument,
  lightStem,
  termFrequencies,
  tfidf,
  tokenize,
} from '../src/core/text';

describe('tokenize', () => {
  it('lowercases and splits on non-alphanumerics', () => {
    expect(tokenize('Payments Gateway: 502 errors!')).toEqual(['payment', 'gateway', '502', 'error']);
  });

  it('drops stopwords and single characters but keeps discriminative ops words', () => {
    const tokens = tokenize('the a an error in the payments team i');
    expect(tokens).toEqual(['error', 'payment']);
  });

  it('returns empty array for stopword-only text', () => {
    expect(tokenize('the and of to')).toEqual([]);
  });
});

describe('lightStem', () => {
  it('collapses plural families', () => {
    expect(lightStem('payments')).toBe('payment');
    expect(lightStem('payments')).toBe(lightStem('payment'));
    expect(lightStem('classes')).toBe('class');
  });

  it('does not mangle words ending in double s', () => {
    expect(lightStem('process')).toBe('process');
  });

  it('strips -ing and -ed on long words', () => {
    expect(lightStem('failing')).toBe('fail');
    expect(lightStem('failed')).toBe('fail');
  });
});

describe('termFrequencies', () => {
  it('counts repeated terms once with sublinear growth', () => {
    const vec = termFrequencies('latency latency latency timeout');
    expect(vec.get('latency')).toBeGreaterThan(1);
    expect(vec.get('latency')).toBeLessThan(4); // 1 + ln(3) ≈ 2.10
    expect(vec.get('timeout')).toBe(1);
  });

  it('is deterministic', () => {
    expect(termFrequencies('alpha beta gamma')).toEqual(termFrequencies('alpha beta gamma'));
  });
});

describe('tfidf + documentFrequencies', () => {
  it('downweights terms present in every document', () => {
    const docs = [
      tokenize('payment gateway latency'),
      tokenize('payment gateway timeout'),
      tokenize('payment search indexing'), // note: lightStem('indexing') === 'index'
    ];
    const df = documentFrequencies(docs);
    const common = tfidf(termFrequencies('payment gateway'), df, 3);
    const rare = tfidf(termFrequencies('indexing'), df, 3);
    expect(common.get('payment')!).toBeLessThan(rare.get('index')!);
  });

  it('gives unseen terms the maximum idf', () => {
    const df = documentFrequencies([tokenize('a b'), tokenize('c d')]);
    const v = tfidf(termFrequencies('zzz'), df, 2);
    expect(v.get('zzz')).toBeGreaterThan(0);
  });
});

describe('cosineSimilarity', () => {
  it('is 1 for identical vectors', () => {
    const a = termFrequencies('payment gateway latency spike');
    expect(cosineSimilarity(a, a)).toBeCloseTo(1, 5);
  });

  it('is 0 for disjoint vectors', () => {
    const a = termFrequencies('payment gateway');
    const b = termFrequencies('search indexing');
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  it('is 0 for empty vectors', () => {
    expect(cosineSimilarity(new Map(), termFrequencies('x'))).toBe(0);
    expect(cosineSimilarity(termFrequencies('the of'), termFrequencies('x'))).toBe(0);
  });

  it('stays within [0, 1]', () => {
    const a = termFrequencies('checkout failing customers cards authorized');
    const b = termFrequencies('checkout confirmation cards authorized failing intermittently');
    const sim = cosineSimilarity(a, b);
    expect(sim).toBeGreaterThan(0);
    expect(sim).toBeLessThanOrEqual(1);
  });

  it('is symmetric', () => {
    const a = termFrequencies('identity token validation clock skew');
    const b = termFrequencies('token validation jwt errors login');
    expect(cosineSimilarity(a, b)).toBeCloseTo(cosineSimilarity(b, a), 10);
  });
});

describe('incidentDocument', () => {
  it('blends summary, description, services, labels and fix', () => {
    const doc = incidentDocument({
      summary: 'Checkout 502',
      description: 'gateway pool exhausted',
      services: ['payments-gateway'],
      labels: ['payments'],
      fixSummary: 'rolled back',
    });
    expect(doc).toContain('Checkout 502');
    expect(doc).toContain('gateway pool exhausted');
    expect(doc).toContain('payments-gateway');
    expect(doc).toContain('rolled back');
  });
});
