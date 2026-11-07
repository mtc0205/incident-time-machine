/**
 * Engine — orchestrates the deterministic core over injected ports.
 *
 * This is the ONLY orchestration code in the app. The Forge layer (trigger,
 * resolvers, Rovo actions) calls `buildDigestForIssue`; tests call it with
 * in-memory ports. All ranking/scoring logic stays in the pure modules.
 */

import { findSimilarIncidents } from './scoring';
import { findSuspectChanges } from './changeCorrelator';
import { buildDigest } from './digest';
import { buildDemoCorpus, buildDemoTargetIncident } from './demoData';
import type { ChangeEvent, IncidentDigest, IncidentRecord, KnowledgeLink } from './types';

/** Ports the host platform must provide. All side effects live behind these. */
export interface EnginePorts {
  /** Fetch an issue (target incident) from Jira. */
  getIssue(issueKeyOrId: string): Promise<IncidentRecord | undefined>;
  /** Search the site for resolved incidents to build the comparison corpus. */
  searchResolvedIncidents(): Promise<IncidentRecord[]>;
  /** Query Teamwork Graph for changes around a time window. May return []. */
  getGraphChanges(fromIso: string, toIso: string): Promise<ChangeEvent[]>;
  /** Knowledge pages linked to the issue via the graph (postmortems). May return []. */
  getLinkedKnowledge(issueKey: string): Promise<KnowledgeLink[]>;
  /** Deterministic demo corpus switch (persisted by host). */
  isDemoMode(): Promise<boolean>;
}

export interface EngineOptions {
  /** Max matches to return (default 5). */
  limit?: number;
  now?: Date;
}

interface ResolvedCorpus {
  target: IncidentRecord;
  corpus: IncidentRecord[];
  changes: ChangeEvent[];
  source: 'live' | 'demo';
}

/**
 * Produce a full digest for an issue. Resolution order:
 *  1. demo mode -> seeded corpus + (if the issue has no text) demo target
 *  2. live mode -> Jira corpus + graph changes; the demo corpus is used as
 *     a clearly-labeled fallback when the live corpus has < 3 incidents
 *     (fresh judge site), so the product is never a dead end.
 */
export async function buildDigestForIssue(
  ports: EnginePorts,
  issueKeyOrId: string,
  options: EngineOptions = {}
): Promise<IncidentDigest> {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 5;

  const issue = await ports.getIssue(issueKeyOrId);
  const demoMode = await ports.isDemoMode();

  const resolved: ResolvedCorpus = demoMode
    ? resolveDemoCorpus(issue, now)
    : await resolveLiveCorpus(ports, issue, now);

  const matches = findSimilarIncidents(resolved.target, resolved.corpus, now, limit);
  const suspects = findSuspectChanges(
    { key: resolved.target.key, createdAt: resolved.target.createdAt, services: resolved.target.services },
    resolved.changes,
    3
  );

  // Enrich: graph-linked knowledge pages (postmortems) attach to the digest
  // so the panel can show "connected knowledge" even when the matched
  // incidents themselves carry no links.
  const digestKey = issue?.key ?? resolved.target.key;
  const digest = buildDigest(digestKey, matches, suspects, resolved.source, now);
  if (matches.length > 0) {
    try {
      const linked = await ports.getLinkedKnowledge(digestKey);
      if (linked.length > 0) {
        const attached: KnowledgeLink[] = [];
        for (const link of linked) {
          if (!matches.some((m) => m.incident.postmortemLinks.some((l) => l.url === link.url))) attached.push(link);
        }
        if (attached.length > 0) digest.knowledge = attached;
      }
    } catch {
      // enrichment is best-effort by contract
    }
  }
  return digest;
}

function resolveDemoCorpus(issue: IncidentRecord | undefined, now: Date): ResolvedCorpus {
  const demo = buildDemoCorpus(now);
  const usableIssue = issue && issue.summary.trim().length > 0 ? issue : undefined;
  return {
    target: usableIssue ?? buildDemoTargetIncident(now),
    corpus: demo.incidents,
    changes: demo.changes,
    source: 'demo',
  };
}

async function resolveLiveCorpus(
  ports: EnginePorts,
  issue: IncidentRecord | undefined,
  now: Date
): Promise<ResolvedCorpus> {
  const liveIncidents = await ports.searchResolvedIncidents();
  if (liveIncidents.length >= 3 && issue && issue.summary.trim().length > 0) {
    const from = new Date(new Date(issue.createdAt).getTime() - 48 * 3_600_000).toISOString();
    const to = new Date(new Date(issue.createdAt).getTime() + 6 * 3_600_000).toISOString();
    const graphChanges = await ports.getGraphChanges(from, to);
    return { target: issue, corpus: liveIncidents, changes: graphChanges, source: 'live' };
  }

  // Fresh site or textless issue: labeled demo fallback.
  const demo = buildDemoCorpus(now);
  return {
    target: issue && issue.summary.trim().length > 0 ? issue : buildDemoTargetIncident(now),
    corpus: demo.incidents,
    changes: demo.changes,
    source: 'demo',
  };
}
