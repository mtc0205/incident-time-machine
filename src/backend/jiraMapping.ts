/**
 * Pure mapping from Jira REST issue payloads to core IncidentRecords.
 * Separated from jira.ts (the API adapter) so it is unit-testable offline.
 */

import { adfToPlainText } from '../core/adf';
import type { IncidentRecord } from '../core/types';

export interface JiraIssueFields {
  summary?: string;
  description?: unknown;
  labels?: string[];
  created?: string;
  resolutiondate?: string;
  components?: Array<{ name?: string }>;
  issuetype?: { name?: string };
  assignee?: { accountId?: string; displayName?: string };
}

export interface JiraIssue {
  id?: string;
  key?: string;
  fields?: JiraIssueFields;
}

/** Words in an issue type name that mark it as incident-like for auto-post. */
const INCIDENT_TYPE_HINTS = ['incident', 'outage'];

export function looksLikeIncident(typeName: string | undefined): boolean {
  if (!typeName) return false;
  const lower = typeName.toLowerCase();
  return INCIDENT_TYPE_HINTS.some((hint) => lower.includes(hint));
}

/**
 * Map a Jira REST issue to an IncidentRecord. Services come from components
 * plus any "service:" prefixed labels (a common JSM convention).
 */
export function toIncidentRecord(issue: JiraIssue): IncidentRecord | undefined {
  const key = issue.key;
  if (!key) return undefined;
  const f = issue.fields ?? {};
  const components = (f.components ?? []).map((c) => (c.name ?? '').toLowerCase()).filter(Boolean);
  const serviceLabels = (f.labels ?? [])
    .filter((l) => l.toLowerCase().startsWith('service:'))
    .map((l) => l.slice('service:'.length).toLowerCase());
  const otherLabels = (f.labels ?? []).filter((l) => !l.toLowerCase().startsWith('service:'));

  const createdAt = f.created ?? new Date().toISOString();
  const resolvedAt = f.resolutiondate;
  const minutesToResolve =
    resolvedAt !== undefined
      ? Math.max(1, Math.round((new Date(resolvedAt).getTime() - new Date(createdAt).getTime()) / 60_000))
      : undefined;

  return {
    key,
    id: Number(issue.id ?? 0),
    summary: f.summary ?? '',
    description: adfToPlainText(f.description),
    services: [...new Set([...components, ...serviceLabels])],
    labels: otherLabels,
    createdAt,
    resolvedAt,
    minutesToResolve,
    participants: f.assignee?.accountId ? [f.assignee.accountId] : [],
    resolvedBy: f.assignee?.accountId,
    resolvedByName: f.assignee?.displayName,
    postmortemLinks: [],
  };
}
