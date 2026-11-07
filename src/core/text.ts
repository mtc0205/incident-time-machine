/**
 * Deterministic text processing: tokenization, TF-IDF vectors and cosine
 * similarity. No external NLP dependencies, no randomness — identical
 * inputs always produce identical vectors.
 */

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'can', 'cannot',
  'could', 'did', 'do', 'does', 'doing', 'down', 'during', 'each', 'few',
  'for', 'from', 'further', 'had', 'has', 'have', 'having', 'he', 'her',
  'here', 'hers', 'him', 'his', 'how', 'i', 'if', 'in', 'into', 'is', 'it',
  'its', 'just', 'me', 'more', 'most', 'my', 'no', 'nor', 'not', 'now',
  'of', 'off', 'on', 'once', 'only', 'or', 'other', 'our', 'out', 'over',
  'own', 'same', 'she', 'should', 'so', 'some', 'such', 'than', 'that',
  'the', 'their', 'theirs', 'them', 'then', 'there', 'these', 'they', 'this',
  'those', 'through', 'to', 'too', 'under', 'until', 'up', 'very', 'was',
  'we', 'were', 'what', 'when', 'where', 'which', 'while', 'who', 'whom',
  'why', 'will', 'with', 'would', 'you', 'your', 'yours',
  // incident-writing filler (words that describe EVERY ticket, not THIS one;
  // note: error/timeout/latency-style words are kept — they discriminate)
  'issue', 'problem', 'please', 'help', 'team', 'hi', 'hey', 'thanks',
  'incident', 'ticket',
]);

/**
 * Tokenize free text into normalized terms.
 * Splits on non-alphanumerics, lowercases, drops stopwords and 1-char
 * tokens, and stems a tiny set of very common suffixes so "payments",
 * "payment" and "paying" collide.
 */
export function tokenize(text: string): string[] {
  const raw = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
  return raw.map(lightStem);
}

/** Extremely small deterministic stemmer: plural + common verb endings. */
export function lightStem(token: string): string {
  if (token.length > 4 && token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.length > 4 && token.endsWith('es')) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  if (token.length > 5 && token.endsWith('ing')) return token.slice(0, -3);
  if (token.length > 4 && token.endsWith('ed')) return token.slice(0, -2);
  return token;
}

/** A sparse term vector: term -> weight. */
export type TermVector = ReadonlyMap<string, number>;

/**
 * Build a TF (term frequency) vector with sublinear scaling (1 + log tf),
 * which prevents one repeated word from dominating the document.
 */
export function termFrequencies(text: string): Map<string, number> {
  const tokens = tokenize(text);
  const counts = new Map<string, number>();
  for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
  const vec = new Map<string, number>();
  for (const [term, count] of counts) vec.set(term, 1 + Math.log(count));
  return vec;
}

/**
 * Multiply TF vectors by IDF weights computed over the corpus.
 * idf(t) = log((1 + N) / (1 + df(t))) + 1  (smooth, sklearn-style).
 */
export function tfidf(vector: TermVector, documentFrequencies: ReadonlyMap<string, number>, corpusSize: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const [term, tf] of vector) {
    const df = documentFrequencies.get(term) ?? 0;
    const idf = Math.log((1 + corpusSize) / (1 + df)) + 1;
    out.set(term, tf * idf);
  }
  return out;
}

/** Document frequencies for a set of documents (each already tokenized). */
export function documentFrequencies(documents: readonly string[][]): Map<string, number> {
  const df = new Map<string, number>();
  for (const doc of documents) {
    for (const term of new Set(doc)) df.set(term, (df.get(term) ?? 0) + 1);
  }
  return df;
}

/** Cosine similarity between two sparse vectors; 0 when either is empty. */
export function cosineSimilarity(a: TermVector, b: TermVector): number {
  if (a.size === 0 || b.size === 0) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [term, weight] of small) {
    const other = large.get(term);
    if (other !== undefined) dot += weight * other;
  }
  if (dot === 0) return 0;
  const normA = l2Norm(a);
  const normB = l2Norm(b);
  if (normA === 0 || normB === 0) return 0;
  return dot / (normA * normB);
}

function l2Norm(v: TermVector): number {
  let sum = 0;
  for (const w of v.values()) sum += w * w;
  return Math.sqrt(sum);
}

/** Concatenate the text fields of an incident into one document. */
export function incidentDocument(incident: {
  summary: string;
  description: string;
  services: readonly string[];
  labels: readonly string[];
  fixSummary?: string;
}): string {
  return [incident.summary, incident.description, incident.services.join(' '), incident.labels.join(' '), incident.fixSummary ?? '']
    .join(' \n ');
}
