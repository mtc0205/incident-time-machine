/**
 * Rovo agent actions — the agent's tools. Also exposed through the
 * rovo:mcp server, so any Rovo Studio agent (not just ours) can call them.
 *
 * Action contracts (mirrored in manifest.yml):
 *   get-incident-history (GET):   input {issueKey} -> summary JSON string
 *   get-likely-cause (GET):       input {issueKey} -> suspect JSON string
 *   post-triage-digest (CREATE):  input {issueKey} -> posted status
 *
 * Rovo action functions receive (payload, context) and whatever they return
 * is handed back to the agent / MCP client.
 */

import { digestToAgentSummary } from '../core/digest';
import { getDigest, postDigest } from './service';

interface ActionContext {
  // Shape varies; context carries the invocation site. Not needed by these actions.
  [key: string]: unknown;
}

function requireIssueKey(payload: unknown): string {
  const p = (payload ?? {}) as Record<string, unknown>;
  for (const key of ['issueKey', 'issueId', 'key', 'id']) {
    const v = p[key];
    if (typeof v === 'string' && v.length > 0) return v;
    if (typeof v === 'number') return String(v);
  }
  throw new Error('Provide an issueKey (e.g. "IN-1042").');
}

/** GET: similar historical incidents with scores and fixes. */
export const getIncidentHistory = async (payload: unknown, _context: ActionContext): Promise<Record<string, string>> => {
  const issueKey = requireIssueKey(payload);
  const digest = await getDigest(issueKey);
  const matches = digest.matches.map((m) => ({
    key: m.incident.key,
    score: Math.round(m.score * 100) / 100,
    summary: m.incident.summary,
    fix: m.incident.fixSummary ?? null,
    minutesToResolve: m.incident.minutesToResolve ?? null,
    resolvedBy: m.incident.resolvedByName ?? m.incident.resolvedBy ?? null,
    factors: m.explanation.filter((f) => f.contribution > 0).map((f) => f.factor),
    postmortem: m.incident.postmortemLinks[0]?.url ?? null,
  }));
  return {
    issueKey: digest.issueKey,
    source: digest.source,
    summary: digestToAgentSummary(digest),
    matches: JSON.stringify(matches),
  };
};

/** GET: the change most likely responsible for the incident. */
export const getLikelyCause = async (payload: unknown, _context: ActionContext): Promise<Record<string, string>> => {
  const issueKey = requireIssueKey(payload);
  const digest = await getDigest(issueKey);
  const suspects = digest.suspects.map((s) => ({
    kind: s.change.kind,
    title: s.change.title,
    score: Math.round(s.score * 100) / 100,
    author: s.change.authorName,
    completedAt: s.change.completedAt,
    services: s.change.services,
    url: s.change.url ?? null,
    reasoning: s.explanation,
  }));
  return {
    issueKey: digest.issueKey,
    suspects: JSON.stringify(suspects),
    summary:
      suspects.length > 0
        ? `Top suspect for ${digest.issueKey}: ${suspects[0]!.kind} "${suspects[0]!.title}" by ${suspects[0]!.author} — ${suspects[0]!.reasoning[0]}`
        : `No changes found in the ±48h window around ${digest.issueKey}.`,
  };
};

/** CREATE: post the historical triage digest as an issue comment. */
export const postTriageDigest = async (payload: unknown, _context: ActionContext): Promise<Record<string, string>> => {
  const issueKey = requireIssueKey(payload);
  const result = await postDigest(issueKey, { force: true });
  const message = result.posted
    ? `Digest posted to ${result.digest.issueKey}.`
    : `Digest not posted (${result.reason}).`;
  return {
    posted: String(result.posted),
    message,
    summary: digestToAgentSummary(result.digest),
  };
};
