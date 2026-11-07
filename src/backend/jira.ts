/**
 * Jira adapter — the ONLY file that talks to the Jira REST API.
 * Pure payload mapping lives in jiraMapping.ts (unit-tested offline).
 */

import api, { route } from '@forge/api';
import type { AdfDoc } from '../core/adf';
import type { IncidentRecord, KnowledgeLink } from '../core/types';
import { looksLikeIncident, toIncidentRecord, type JiraIssue } from './jiraMapping';

export { looksLikeIncident, toIncidentRecord } from './jiraMapping';

export async function getIssue(issueKeyOrId: string): Promise<IncidentRecord | undefined> {
  try {
    const response = await api
      .asApp()
      .requestJira(
        route`/rest/api/3/issue/${issueKeyOrId}?fields=summary,description,labels,components,created,resolutiondate,issuetype,assignee`
      );
    if (!response.ok) return undefined;
    const issue = (await response.json()) as JiraIssue;
    return toIncidentRecord(issue);
  } catch {
    return undefined;
  }
}

/** True when the issue exists and looks incident-like (used by the trigger). */
export async function isIncidentIssue(issueKeyOrId: string): Promise<boolean> {
  try {
    const response = await api.asApp().requestJira(route`/rest/api/3/issue/${issueKeyOrId}?fields=issuetype`);
    if (!response.ok) return false;
    const issue = (await response.json()) as JiraIssue;
    return looksLikeIncident(issue.fields?.issuetype?.name);
  } catch {
    return false;
  }
}

/**
 * Search resolved issues from the last ~18 months to build the comparison
 * corpus. Incident-typed issues are preferred when the site has them;
 * the similarity threshold filters non-incident noise otherwise.
 */
export async function searchResolvedIncidents(maxResults = 100): Promise<IncidentRecord[]> {
  const jql = 'statusCategory = Done AND created >= -540d ORDER BY resolutiondate DESC';
  try {
    const response = await api
      .asApp()
      .requestJira(
        route`/rest/api/3/search/jql?jql=${jql}&maxResults=${String(maxResults)}&fields=summary,description,labels,components,created,resolutiondate,issuetype,assignee`
      );
    if (!response.ok) return [];
    const body = (await response.json()) as { issues?: JiraIssue[] };
    const mapped = (body.issues ?? [])
      .map((issue) => ({ record: toIncidentRecord(issue), isIncident: looksLikeIncident(issue.fields?.issuetype?.name) }))
      .filter(
        (x): x is { record: IncidentRecord; isIncident: boolean } =>
          x.record !== undefined && x.record.resolvedAt !== undefined && x.record.summary.trim().length > 0
      );

    const typed = mapped.filter((x) => x.isIncident).map((x) => x.record);
    if (typed.length >= 3) return typed;
    return mapped.map((x) => x.record);
  } catch {
    return [];
  }
}

/** Post the digest as an ADF comment. Returns the comment self link. */
export async function postComment(issueKey: string, adfBody: AdfDoc): Promise<string | undefined> {
  try {
    const response = await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}/comment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: adfBody }),
    });
    if (!response.ok) return undefined;
    const body = (await response.json()) as { self?: string };
    return body.self;
  } catch {
    return undefined;
  }
}

/** Knowledge pages linked to an issue (remote links) — cheap graph fallback. */
export async function getRemoteLinkKnowledge(issueKey: string): Promise<KnowledgeLink[]> {
  try {
    const response = await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}/remotelink`);
    if (!response.ok) return [];
    const links = (await response.json()) as Array<{ object?: { title?: string; url?: string } }>;
    return links
      .filter((l) => l.object?.url && /atlassian\.net\/wiki/i.test(l.object!.url!))
      .map((l) => ({ title: l.object?.title ?? 'Linked page', url: l.object!.url!, source: 'jira-remote-link' as const }));
  } catch {
    return [];
  }
}
