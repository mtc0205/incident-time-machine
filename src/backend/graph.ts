/**
 * Teamwork Graph adapter — consumes the graph (EAP) via requestTeamworkGraph.
 *
 * The graph is an ENRICHMENT layer: every call degrades to [] on any error
 * (empty tenant, EAP allowlist, transient 200-empty quirks reported in the
 * community in Oct-Nov 2026) so the product never blocks on it. Cypher and
 * parsing live in core/cypher.ts (pure, unit-tested).
 */

import api from '@forge/api';
import {
  CYPHER_GRAPHQL_ENVELOPE,
  deploymentsNearWindowCypher,
  graphNodeTitle,
  graphNodeUrl,
  parseCypherResponse,
  postmortemsForIssueCypher,
} from '../core/cypher';
import type { GraphColumnValue } from '../core/cypher';
import type { ChangeEvent, KnowledgeLink } from '../core/types';

async function runCypher(cypher: string, params: Record<string, string>): Promise<Array<Record<string, GraphColumnValue>>> {
  const response = await api
    .asUser()
    .requestTeamworkGraph(CYPHER_GRAPHQL_ENVELOPE, { cypherQuery: cypher, params });
  const body = (await response.json()) as unknown;
  return parseCypherResponse(body);
}

function columnNode(col: GraphColumnValue | undefined): Record<string, unknown> | undefined {
  return col && typeof col === 'object' ? (col.data as Record<string, unknown> | undefined) : undefined;
}

function columnList(col: GraphColumnValue | undefined): Array<Record<string, unknown>> {
  if (!col || !Array.isArray(col.nodes)) return [];
  return col.nodes.map((n) => (n.data ?? {}) as Record<string, unknown>);
}

function stringish(data: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  for (const key of keys) {
    const v = data?.[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

/**
 * Deployments + merges in a time window, with the services they touched.
 * Returns [] on any failure — never throws.
 */
export async function getGraphChanges(fromIso: string, toIso: string): Promise<ChangeEvent[]> {
  const { cypher, params } = deploymentsNearWindowCypher();
  try {
    const rows = await runCypher(cypher, { ...params, fromIso, toIso });
    const changes: ChangeEvent[] = [];
    for (const row of rows) {
      const d = columnNode(row['d']);
      if (!d) continue;
      const services = columnList(row['services'])
        .map((s) => stringish(s, ['displayName', 'name', 'title']))
        .filter((s): s is string => s !== undefined)
        .map((s) => s.toLowerCase());
      const pulls = columnList(row['pulls']);
      const finished = stringish(d, ['finishedAt', 'completedAt', 'updatedAt']) ?? toIso;
      const change: ChangeEvent = {
        id: stringish(d, ['id', 'ari']) ?? `graph-deploy-${changes.length}`,
        kind: 'deployment',
        title: graphNodeTitle(d),
        services,
        completedAt: finished,
        authorName: stringish(d, ['author', 'displayName', 'actor']) ?? 'Unknown',
        repository: stringish(d, ['repository', 'repoName']),
        ref: stringish(d, ['commitSha', 'sha', 'ref']),
        url: graphNodeUrl(d),
      };
      changes.push(change);
      for (const pull of pulls) {
        changes.push({
          id: stringish(pull, ['id', 'ari']) ?? `graph-pr-${changes.length}`,
          kind: 'pull-request',
          title: graphNodeTitle(pull),
          services,
          completedAt: stringish(pull, ['mergedAt', 'completedAt', 'updatedAt']) ?? finished,
          authorName: stringish(pull, ['author', 'displayName']) ?? 'Unknown',
          repository: stringish(pull, ['repository', 'repoName']),
          ref: stringish(pull, ['id', 'number']),
          url: graphNodeUrl(pull),
        });
      }
    }
    return changes;
  } catch {
    return [];
  }
}

/**
 * Confluence pages linked to an issue through the graph (postmortems).
 * Returns [] on any failure — never throws.
 */
export async function getGraphKnowledgeLinks(issueKey: string): Promise<KnowledgeLink[]> {
  const { cypher, params } = postmortemsForIssueCypher();
  try {
    const rows = await runCypher(cypher, { ...params, issueKey });
    const links: KnowledgeLink[] = [];
    for (const row of rows) {
      for (const page of columnList(row['pages'])) {
        const url = graphNodeUrl(page);
        if (!url) continue;
        links.push({ title: graphNodeTitle(page), url, source: 'teamwork-graph' });
      }
    }
    return links.slice(0, 5);
  } catch {
    return [];
  }
}
