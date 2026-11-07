/**
 * Shared service layer used by the resolver, the trigger and the Rovo
 * actions: one digest builder, one poster — no duplicated behavior between
 * the three surfaces.
 */

import { buildDigestForIssue } from '../core/engine';
import { digestToAdf } from '../core/digest';
import type { IncidentDigest } from '../core/types';
import { forgePorts } from './ports';
import * as jira from './jira';
import { getDemoMode, markDigestPosted, setDemoMode, wasDigestPosted } from './store';

export { getDemoMode, setDemoMode };

/** Build (never post) the digest for an issue. */
export async function getDigest(issueKeyOrId: string): Promise<IncidentDigest> {
  return buildDigestForIssue(forgePorts, issueKeyOrId);
}

export interface PostResult {
  posted: boolean;
  reason?: 'already-posted' | 'issue-not-found' | 'comment-failed';
  digest: IncidentDigest;
}

/** Build and post the digest comment, with a dedupe guard. */
export async function postDigest(issueKeyOrId: string, options: { force?: boolean } = {}): Promise<PostResult> {
  const digest = await getDigest(issueKeyOrId);
  const issue = await jira.getIssue(issueKeyOrId);
  if (!issue) return { posted: false, reason: 'issue-not-found', digest };
  if (!options.force && (await wasDigestPosted(issue.key))) {
    return { posted: false, reason: 'already-posted', digest };
  }
  const posted = await jira.postComment(issue.key, digestToAdf(digest));
  if (!posted) return { posted: false, reason: 'comment-failed', digest };
  await markDigestPosted(issue.key);
  return { posted: true, digest };
}
