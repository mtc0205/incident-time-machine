/**
 * Demo corpus generator — deterministic and vivid.
 *
 * Judges (and first-run users on empty sites) get a clearly-labeled demo
 * mode built from this data: a year of incident history for a fictional
 * commerce platform ("Northbeam Commerce") with named responders, real
 * fixes, deploy history and postmortems. Dates are anchored relative to
 * `now` so the corpus always looks fresh; identical `now` => identical
 * corpus (unit-tested).
 */

import type { ChangeEvent, IncidentRecord, KnowledgeLink } from './types';

/** Small deterministic PRNG (mulberry32) so the corpus is reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DEMO_SEED = 20260413;

export const DEMO_SERVICES = ['payments-gateway', 'checkout-web', 'search-service', 'identity-provider', 'notifications'] as const;

interface IncidentBlueprint {
  key: string;
  daysAgo: number;
  summary: string;
  description: string;
  services: string[];
  labels: string[];
  severity: string;
  mttrMinutes: number;
  resolvedBy: ResponderKey;
  fixSummary: string;
  postmortem?: { title: string; path: string };
}

/**
 * The demo "current" incident: what demo mode treats as the live incident
 * when the opened issue has no useful text. Written to overlap strongly
 * with several blueprint incidents so the matching engine shines.
 */
export const DEMO_CURRENT_INCIDENT = {
  key: 'CURRENT',
  summary: 'Checkout payments failing with 502s after card authorization',
  description:
    'Customers report cards are authorized but the confirmation step returns 502. ' +
    'Checkout-web error rate jumped to 6%. Stripe dashboard shows successful authorizations on our side. ' +
    'Started shortly after this morning\'s release train.',
  services: ['payments-gateway', 'checkout-web'],
  labels: ['payments', 'checkout', 'latency', 'sev1'],
};

const RESPONDERS = {
  mei: { name: 'Mei Tanaka', accountId: 'demo-account-mei' },
  diego: { name: 'Diego Ramírez', accountId: 'demo-account-diego' },
  priya: { name: 'Priya Nair', accountId: 'demo-account-priya' },
  jonas: { name: 'Jonas Weber', accountId: 'demo-account-jonas' },
  aisha: { name: 'Aisha Okafor', accountId: 'demo-account-aisha' },
} as const;

type ResponderKey = keyof typeof RESPONDERS;

/** Hand-authored history. Realistic ops language, not lorem ipsum. */
const INCIDENT_BLUEPRINTS: IncidentBlueprint[] = [
  {
    key: 'IN-1873', daysAgo: 26, severity: 'SEV-1', mttrMinutes: 214,
    summary: 'Checkout returning 502 after card authorization step',
    description:
      'Card authorization succeeds at the processor but our confirmation callback fails. ' +
      'Checkout-web 502 rate ~7%. Payment gateway connection pool saturated. Rolled back release 4.19.1.',
    services: ['payments-gateway', 'checkout-web'], labels: ['payments', 'checkout', 'latency', 'sev1'],
    resolvedBy: 'mei', fixSummary: 'Rolled back payments-gateway 4.19.1; pool exhaustion traced to new 3DS callback path',
    postmortem: { title: 'IN-1873 postmortem — gateway pool exhaustion', path: '/wiki/spaces/OPS/pages/1873' },
  },
  {
    key: 'IN-1801', daysAgo: 71, severity: 'SEV-1', mttrMinutes: 167,
    summary: 'Payment gateway timeouts during flash sale checkout',
    description:
      'Gateway p99 latency 8s+, checkout confirmations timing out. Connection pool exhausted by slow 3DS ' +
      'verification path. Shed load and raised pool ceiling.',
    services: ['payments-gateway'], labels: ['payments', 'latency', 'capacity'],
    resolvedBy: 'mei', fixSummary: 'Raised gateway connection pool 200→400 and added circuit breaker on 3DS path',
    postmortem: { title: 'Flash sale gateway timeouts — capacity review', path: '/wiki/spaces/OPS/pages/1801' },
  },
  {
    key: 'IN-1755', daysAgo: 118, severity: 'SEV-2', mttrMinutes: 93,
    summary: 'Duplicate card charges when customers double-click Pay',
    description:
      'Idempotency keys not propagated on retry; some customers charged twice. checkout-web submit handler ' +
      'fired twice before disable. Added idempotency envelope.',
    services: ['checkout-web', 'payments-gateway'], labels: ['payments', 'checkout', 'data-integrity'],
    resolvedBy: 'diego', fixSummary: 'Server-side idempotency keys on /charge + client double-submit guard',
  },
  {
    key: 'IN-1690', daysAgo: 152, severity: 'SEV-2', mttrMinutes: 388,
    summary: 'Search results empty for newly listed products',
    description:
      'Indexing worker fell behind after bulk import; search-service returning zero hits for 12% of queries. ' +
      'Replayed indexing queue and fixed consumer lag alarm.',
    services: ['search-service'], labels: ['search', 'indexing', 'data-integrity'],
    resolvedBy: 'priya', fixSummary: 'Reindexed backlog; added consumer-lag alert at 10k messages',
    postmortem: { title: 'Search indexing lag — what we learned', path: '/wiki/spaces/OPS/pages/1690' },
  },
  {
    key: 'IN-1634', daysAgo: 191, severity: 'SEV-1', mttrMinutes: 245,
    summary: 'Login failures spiking — identity provider token validation errors',
    description:
      '5xx from identity-provider on token validation; users stuck at login. Clock skew after NTP outage on ' +
      'two nodes caused JWT validation to reject valid tokens.',
    services: ['identity-provider'], labels: ['login', 'auth', 'sev1'],
    resolvedBy: 'jonas', fixSummary: 'Re-synced NTP; enabled tolerant clock-skew window (±90s) in JWT validator',
    postmortem: { title: 'Identity clock skew incident', path: '/wiki/spaces/OPS/pages/1634' },
  },
  {
    key: 'IN-1588', daysAgo: 233, severity: 'SEV-3', mttrMinutes: 41,
    summary: 'Order confirmation emails delayed by 20 minutes',
    description:
      'notifications queue backed up after a consumer crash-loop on malformed emoji in customer names. ' +
      'Poison messages quarantined.',
    services: ['notifications'], labels: ['email', 'queue'],
    resolvedBy: 'aisha', fixSummary: 'Quarantined poison messages; sanitizer now strips invalid UTF-8 before enqueue',
  },
  {
    key: 'IN-1521', daysAgo: 262, severity: 'SEV-2', mttrMinutes: 176,
    summary: 'Checkout page blank for Safari users',
    description:
      'checkout-web bundle shipped an untranspiled optional-chaining operator; Safari 15 users got a white ' +
      'page. Rolled forward with transpile fix within 3h.',
    services: ['checkout-web'], labels: ['checkout', 'frontend', 'browser'],
    resolvedBy: 'diego', fixSummary: 'Added Safari 15 to browser matrix; bumped browserslist and hotfixed bundle',
  },
  {
    key: 'IN-1477', daysAgo: 301, severity: 'SEV-1', mttrMinutes: 122,
    summary: 'Payments declining for all Amex cards',
    description:
      'Processor certificate rotated; gateway pinning old intermediate CA. All Amex authorizations failed ' +
      'upstream with 401. Hot-loaded new CA bundle.',
    services: ['payments-gateway'], labels: ['payments', 'certificates', 'sev1'],
    resolvedBy: 'mei', fixSummary: 'Replaced pinned intermediate CA; added cert-expiry canary check',
  },
  {
    key: 'IN-1420', daysAgo: 334, severity: 'SEV-2', mttrMinutes: 289,
    summary: 'Search autocomplete returning stale suggestions',
    description:
      'Suggestion cache TTL raised accidentally to 24h in config refactor; users saw discontinued products. ' +
      'Cache flushed, config reverted.',
    services: ['search-service'], labels: ['search', 'cache', 'config'],
    resolvedBy: 'priya', fixSummary: 'Reverted config; suggestion TTLs now validated by config lint in CI',
  },
  {
    key: 'IN-1377', daysAgo: 371, severity: 'SEV-2', mttrMinutes: 154,
    summary: 'Password reset emails never arrive',
    description:
      'notifications worker scaled to zero by a misapplied autoscaling policy during cost cleanup. Queue grew ' +
      'silently for 2h. Restored workers and drained queue.',
    services: ['notifications', 'identity-provider'], labels: ['email', 'login', 'autoscaling'],
    resolvedBy: 'aisha', fixSummary: 'Restored min replica count; queue-depth alert wired to on-call',
    postmortem: { title: 'The silent scale-to-zero', path: '/wiki/spaces/OPS/pages/1377' },
  },
  {
    key: 'IN-1315', daysAgo: 402, severity: 'SEV-3', mttrMinutes: 67,
    summary: 'Cart totals off by one cent for tax-inclusive regions',
    description:
      'Rounding order differed between checkout-web and payments-gateway amount validation; some German ' +
      'orders rejected. Unified rounding to banker\'s rounding at gateway.',
    services: ['checkout-web', 'payments-gateway'], labels: ['payments', 'rounding', 'i18n'],
    resolvedBy: 'diego', fixSummary: 'Single shared rounding module; added cent-precision property tests',
  },
  {
    key: 'IN-1268', daysAgo: 441, severity: 'SEV-2', mttrMinutes: 198,
    summary: 'Elevated checkout latency during EU morning peak',
    description:
      'payments-gateway EU region running near CPU limits after traffic growth; latency degraded non-linearly. ' +
      'Scaled region and rebalanced.',
    services: ['payments-gateway'], labels: ['payments', 'latency', 'capacity', 'eu'],
    resolvedBy: 'jonas', fixSummary: 'EU region +4 pods; capacity headroom policy raised to 40%',
  },
  {
    key: 'IN-1201', daysAgo: 479, severity: 'SEV-1', mttrMinutes: 312,
    summary: 'Full checkout outage after database failover',
    description:
      'Primary DB failover took 11 minutes; checkout-web did not retry on connection resets and failed hard. ' +
      'Added retry-with-jitter and graceful degradation.',
    services: ['checkout-web', 'payments-gateway'], labels: ['checkout', 'database', 'sev1', 'failover'],
    resolvedBy: 'mei', fixSummary: 'Retry policies + read-only degraded mode during failover windows',
    postmortem: { title: 'Failover Friday — full checkout outage', path: '/wiki/spaces/OPS/pages/1201' },
  },
  {
    key: 'IN-1140', daysAgo: 511, severity: 'SEV-3', mttrMinutes: 55,
    summary: 'Order history search returns 500 for orders > 1000 items',
    description:
      'search-service serialization recursion limit hit for power sellers with huge orders. Raised limit and ' +
      'paginated response.',
    services: ['search-service'], labels: ['search', 'pagination'],
    resolvedBy: 'priya', fixSummary: 'Paginated order-history serialization; regression test for 5k-item orders',
  },
];

interface ChangeBlueprint {
  id: string;
  kind: 'deployment' | 'pull-request';
  title: string;
  services: string[];
  hoursBeforeDemoIncident: number; // relative to demo "now"
  author: ResponderKey;
  repository: string;
  ref: string;
}

/** Change history around the demo incident's onset. */
const CHANGE_BLUEPRINTS: ChangeBlueprint[] = [
  {
    id: 'deploy-9012', kind: 'deployment', title: 'Release 4.22.1 → production (payments)', services: ['payments-gateway'],
    hoursBeforeDemoIncident: 2.2, author: 'mei', repository: 'northbeam/payments-gateway', ref: 'a91f37c',
  },
  {
    id: 'deploy-9011', kind: 'deployment', title: 'Release 4.22.0 → production (payments)', services: ['payments-gateway'],
    hoursBeforeDemoIncident: 26, author: 'diego', repository: 'northbeam/payments-gateway', ref: '77bd210',
  },
  {
    id: 'pr-4551', kind: 'pull-request', title: 'Add 3DS2 challenge iframe to checkout confirmation', services: ['checkout-web', 'payments-gateway'],
    hoursBeforeDemoIncident: 5.5, author: 'diego', repository: 'northbeam/checkout-web', ref: '#4551',
  },
  {
    id: 'deploy-9008', kind: 'deployment', title: 'Checkout frontend hotfix bundle v4.8.3', services: ['checkout-web'],
    hoursBeforeDemoIncident: 49, author: 'diego', repository: 'northbeam/checkout-web', ref: 'f02c9e1',
  },
  {
    id: 'deploy-9005', kind: 'deployment', title: 'Search index shard rebalance', services: ['search-service'],
    hoursBeforeDemoIncident: 71, author: 'priya', repository: 'northbeam/search-service', ref: '3ab90d4',
  },
  {
    id: 'pr-4549', kind: 'pull-request', title: 'Refactor connection pool sizing config', services: ['payments-gateway', 'notifications'],
    hoursBeforeDemoIncident: 31, author: 'jonas', repository: 'northbeam/payments-gateway', ref: '#4549',
  },
  {
    id: 'deploy-9001', kind: 'deployment', title: 'Identity NTP hardening rollout', services: ['identity-provider'],
    hoursBeforeDemoIncident: 96, author: 'jonas', repository: 'northbeam/identity-provider', ref: 'c8811bb',
  },
];

export interface DemoCorpus {
  incidents: IncidentRecord[];
  changes: ChangeEvent[];
}

/**
 * Build the demo corpus anchored at `now` (default: real clock).
 * Deterministic for a fixed `now` — the PRNG only picks small jitter
 * values, never identities or texts.
 */
export function buildDemoCorpus(now: Date = new Date()): DemoCorpus {
  const rng = mulberry32(DEMO_SEED);
  const nowMs = now.getTime();

  const incidents: IncidentRecord[] = INCIDENT_BLUEPRINTS.map((bp) => {
    const jitter = Math.floor(rng() * 50); // 0-49 min deterministic jitter
    const createdAt = new Date(nowMs - bp.daysAgo * 86_400_000 - jitter * 60_000);
    const resolvedAt = new Date(createdAt.getTime() + bp.mttrMinutes * 60_000);
    const responder = RESPONDERS[bp.resolvedBy];
    const links: KnowledgeLink[] = bp.postmortem
      ? [{ title: bp.postmortem.title, url: `https://northbeam.atlassian.net${bp.postmortem.path}`, source: 'demo' }]
      : [];
    return {
      key: bp.key,
      id: 10_000 + Number(bp.key.split('-')[1] ?? 0),
      summary: bp.summary,
      description: bp.description,
      services: [...bp.services],
      labels: [...bp.labels],
      severity: bp.severity,
      createdAt: createdAt.toISOString(),
      resolvedAt: resolvedAt.toISOString(),
      minutesToResolve: bp.mttrMinutes,
      participants: [responder.accountId],
      resolvedBy: responder.accountId,
      resolvedByName: responder.name,
      fixSummary: bp.fixSummary,
      postmortemLinks: links,
    };
  });

  const changes: ChangeEvent[] = CHANGE_BLUEPRINTS.map((bp) => ({
    id: bp.id,
    kind: bp.kind,
    title: bp.title,
    services: [...bp.services],
    completedAt: new Date(nowMs - bp.hoursBeforeDemoIncident * 3_600_000).toISOString(),
    authorName: RESPONDERS[bp.author].name,
    repository: bp.repository,
    ref: bp.ref,
    url: bp.kind === 'deployment'
      ? `https://bitbucket.org/northbeam/${bp.repository.split('/')[1]}/deployments/view/${bp.id}`
      : `https://bitbucket.org/northbeam/${bp.repository.split('/')[1]}/pull-requests/${bp.ref.replace('#', '')}`,
  }));

  return { incidents, changes };
}

/** The demo "current incident" anchored at `now`. */
export function buildDemoTargetIncident(now: Date = new Date()): IncidentRecord {
  const onsetMinutesAgo = 23; // incident started 23 minutes ago
  return {
    key: 'DEMO-CURRENT',
    id: 999_001,
    summary: DEMO_CURRENT_INCIDENT.summary,
    description: DEMO_CURRENT_INCIDENT.description,
    services: [...DEMO_CURRENT_INCIDENT.services],
    labels: [...DEMO_CURRENT_INCIDENT.labels],
    severity: 'SEV-1',
    createdAt: new Date(now.getTime() - onsetMinutesAgo * 60_000).toISOString(),
    participants: [],
    postmortemLinks: [],
  };
}
