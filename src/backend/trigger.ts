/**
 * Trigger: fires on issue creation (avi:jira:created:issue).
 *
 * Policy: auto-post the digest ONLY when
 *   - the new issue has an incident-like issue type, OR
 *   - demo mode is explicitly enabled,
 * and never twice for the same issue (kvs dedupe inside postDigest).
 */

import { getDemoMode, postDigest } from './service';
import { isIncidentIssue } from './jira';

interface IssuePayload {
  issue?: { key?: string; id?: string; fields?: { issuetype?: { name?: string } } };
  issueId?: string | number;
}

function extractIssueRef(payload: IssuePayload): { keyOrId?: string; typeName?: string } {
  if (payload.issue?.key) {
    return {
      keyOrId: payload.issue.key,
      typeName: payload.issue.fields?.issuetype?.name,
    };
  }
  if (payload.issueId !== undefined) return { keyOrId: String(payload.issueId) };
  return {};
}

const INCIDENT_WORDS = ['incident', 'outage'];

function typeNameIsIncidentLike(typeName: string | undefined): boolean {
  if (!typeName) return false;
  const lower = typeName.toLowerCase();
  return INCIDENT_WORDS.some((word) => lower.includes(word));
}

export const onIssueCreated = async (payload: IssuePayload): Promise<void> => {
  try {
    const { keyOrId, typeName } = extractIssueRef(payload);
    if (!keyOrId) return;

    const demoMode = await getDemoMode();
    if (!demoMode) {
      // Type name present in payload -> decide from it; else ask the API.
      const incidentLike = typeName !== undefined ? typeNameIsIncidentLike(typeName) : await isIncidentIssue(keyOrId);
      if (!incidentLike) return;
    }

    await postDigest(keyOrId);
  } catch (error) {
    // Triggers must never throw; log for forge tunnel visibility.
    console.error('Incident Time Machine trigger failed:', error);
  }
};
