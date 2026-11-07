/**
 * Teamwork Graph query builders & response parsers (pure).
 *
 * The graph is queried with Cypher wrapped in GraphQL via the `cypherQuery`
 * field (verified shape, see docs/RESEARCH.md §4). All user data is passed
 * as $parameters — never string-interpolated — so incident text can't
 * inject Cypher.
 */

/** GraphQL envelope every query uses. */
export const CYPHER_GRAPHQL_ENVELOPE = `query ForgeTwg($cypherQuery: String!, $params: CypherRequestParams) {
  cypherQuery(query: $cypherQuery, params: $params) {
    edges {
      node {
        columns {
          key
          value {
            __typename
            ... on CypherQueryResultNode { id data { __typename } }
            ... on CypherQueryResultListNode { nodes { id data { __typename } } }
          }
        }
      }
    }
  }
}`;

/**
 * Cypher: deployments + their pull requests around a time window, linked to
 * a service. Deployments are ingested by Atlassian's Bitbucket/DevOps
 * connectors as `Deployment`/`PullRequest` nodes related to `SoftwareService`.
 */
export function deploymentsNearWindowCypher(): { cypher: string; params: Record<string, string> } {
  const cypher = [
    'MATCH (d:Deployment)',
    'WHERE d.finishedAt IS NOT NULL AND d.finishedAt >= $fromIso AND d.finishedAt <= $toIso',
    'OPTIONAL MATCH (d)-[:deployment_includes_change]->(pr:PullRequest)',
    'OPTIONAL MATCH (d)-[:deployment_deploys]->(svc:SoftwareService)',
    'RETURN d, collect(distinct pr) as pulls, collect(distinct svc) as services',
  ].join(' ');
  return { cypher, params: {} };
}

/** Cypher: pages (postmortems) linked to a Jira issue through the graph. */
export function postmortemsForIssueCypher(): { cypher: string; params: Record<string, string> } {
  const cypher = [
    'MATCH (issue:JiraWorkItem {key: $issueKey})',
    'MATCH (issue)-[:relates_to|mentions|linked_to*1..2]-(page:Page)',
    'RETURN issue, collect(distinct page) as pages',
  ].join(' ');
  return { cypher, params: {} };
}

/**
 * Parse a `cypherQuery` GraphQL response into flat rows of column values.
 * Defensive: handles empty data, missing edges, and unexpected shapes by
 * returning what it can rather than throwing.
 */
export interface GraphColumnValue {
  __typename?: string;
  id?: string;
  data?: Record<string, unknown>;
  nodes?: Array<{ id?: string; data?: Record<string, unknown> }>;
}

export function parseCypherResponse(body: unknown): Array<Record<string, GraphColumnValue>> {
  const rows: Array<Record<string, GraphColumnValue>> = [];
  const root = asRecord(body);
  const edges =
    root?.data && typeof root.data === 'object'
      ? asRecord(root.data)?.cypherQuery && typeof asRecord(root.data)?.cypherQuery === 'object'
        ? asArray(asRecord(asRecord(root.data)?.cypherQuery)?.edges)
        : undefined
      : undefined;
  if (!edges) return rows;

  for (const edge of edges) {
    const node = asRecord(asRecord(edge)?.node);
    const columns = asArray(node?.columns);
    const row: Record<string, GraphColumnValue> = {};
    for (const col of columns) {
      const c = asRecord(col);
      if (typeof c?.key === 'string' && c.value !== undefined) {
        row[c.key] = c.value as GraphColumnValue;
      }
    }
    if (Object.keys(row).length > 0) rows.push(row);
  }
  return rows;
}

/** Extract a display-ish title from an arbitrary graph node's data blob. */
export function graphNodeTitle(data: Record<string, unknown> | undefined): string {
  if (!data) return 'Untitled';
  for (const key of ['title', 'displayName', 'name', 'key', 'summary']) {
    const v = data[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return 'Untitled';
}

/** Extract an external URL from a graph node's data blob (best effort). */
export function graphNodeUrl(data: Record<string, unknown> | undefined): string | undefined {
  if (!data) return undefined;
  for (const key of ['url', 'link', 'webUrl', 'htmlUrl']) {
    const v = data[key];
    if (typeof v === 'string' && /^https?:\/\//.test(v)) return v;
  }
  return undefined;
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
