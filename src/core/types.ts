/**
 * Incident Time Machine — core domain types.
 *
 * This module is PURE: no Forge imports, no I/O. Everything the engine does
 * is expressed over these types so the whole product brain is unit-testable
 * offline (see tests/).
 */

/** A resolved (or resolving) incident from Jira Service Management. */
export interface IncidentRecord {
  /** Jira issue key, e.g. "IN-1042". Used as the primary identity. */
  key: string;
  /** Numeric Jira issue id (used for REST API calls). */
  id: number;
  /** Issue summary line. */
  summary: string;
  /** Issue description (may be empty). */
  description: string;
  /** Affected service names, normalized lowercase (from components + labels + "affected service" field heuristics). */
  services: string[];
  /** Free-form labels. */
  labels: string[];
  /** Incident severity, e.g. "SEV-1" .. "SEV-4" (optional). */
  severity?: string;
  /** When the incident was created (ISO 8601). */
  createdAt: string;
  /** When it was resolved (ISO 8601), absent if still open. */
  resolvedAt?: string;
  /** Minutes from creation to resolution, when known. */
  minutesToResolve?: number;
  /** AccountIds of people who participated (commenters + assignee). */
  participants: string[];
  /** The person who closed it, when known (accountId). */
  resolvedBy?: string;
  /** Human name (for demo data / display when account lookup is unavailable). */
  resolvedByName?: string;
  /** One-line extract of what actually fixed it. */
  fixSummary?: string;
  /** Links to postmortems / knowledge pages. */
  postmortemLinks: KnowledgeLink[];
}

export interface KnowledgeLink {
  title: string;
  url: string;
  /** Where the link came from — Teamwork Graph, Confluence search, or Jira remote link. */
  source: 'teamwork-graph' | 'confluence' | 'jira-remote-link' | 'demo';
}

/** A deploy or merge event that might have caused an incident. */
export interface ChangeEvent {
  /** Stable id (ARI or synthetic). */
  id: string;
  /** "deployment" (Bitbucket deploy) or "pull-request" (merge). */
  kind: 'deployment' | 'pull-request';
  /** Human title, e.g. "Release 4.12.3 to production". */
  title: string;
  /** Services the change touched (normalized lowercase). */
  services: string[];
  /** When the change finished / merged (ISO 8601). */
  completedAt: string;
  /** Author display name. */
  authorName: string;
  /** Bitbucket repo slug or URL. */
  repository?: string;
  /** Commit sha or PR id, for display. */
  ref?: string;
  /** Direct link. */
  url?: string;
}

/** One scored historical match for the current incident. */
export interface ScoredIncident {
  incident: IncidentRecord;
  /** Composite similarity, 0..1. */
  score: number;
  /** Human-readable factor breakdown, e.g. "text similarity 0.71 (weight 0.55)". */
  explanation: MatchFactor[];
}

export interface MatchFactor {
  factor: 'text-similarity' | 'service-overlap' | 'label-overlap' | 'recency';
  contribution: number;
  detail: string;
}

/** One scored "suspect" change for the current incident. */
export interface ScoredChange {
  change: ChangeEvent;
  /** Suspect score, 0..1+. */
  score: number;
  explanation: string[];
}

export type DataSource = 'live' | 'demo';

/** Everything the panel and the digest comment render. */
export interface IncidentDigest {
  /** The issue this digest belongs to. */
  issueKey: string;
  generatedAt: string;
  source: DataSource;
  matches: ScoredIncident[];
  suspects: ScoredChange[];
  /** Aggregated stats for display. */
  stats: DigestStats;
  /** Suggested responders: people who resolved the most similar incidents. */
  suggestedResponders: ResponderSuggestion[];
  /** Extra knowledge pages linked to this issue via the Teamwork Graph. */
  knowledge?: KnowledgeLink[];
}

export interface DigestStats {
  matchedCount: number;
  /** Median minutes-to-resolve across matched incidents. */
  medianMinutesToResolve?: number;
  /** The single best-matching incident's resolution time. */
  bestMatchMinutesToResolve?: number;
  servicesAffected: string[];
}

export interface ResponderSuggestion {
  name: string;
  accountId?: string;
  resolvedCount: number;
  basedOn: string[];
}

/** Result contract used by the engine's Forge adapters. */
export interface EngineCorpus {
  source: DataSource;
  incidents: IncidentRecord[];
  changes: ChangeEvent[];
}
