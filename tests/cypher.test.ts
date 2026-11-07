import { describe, expect, it } from 'vitest';
import {
  CYPHER_GRAPHQL_ENVELOPE,
  deploymentsNearWindowCypher,
  graphNodeTitle,
  graphNodeUrl,
  parseCypherResponse,
  postmortemsForIssueCypher,
} from '../src/core/cypher';

describe('CYPHER_GRAPHQL_ENVELOPE', () => {
  it('wraps the query in the documented cypherQuery field', () => {
    expect(CYPHER_GRAPHQL_ENVELOPE).toContain('cypherQuery(query: $cypherQuery, params: $params)');
    expect(CYPHER_GRAPHQL_ENVELOPE).toContain('CypherQueryResultListNode');
  });
});

describe('query builders', () => {
  it('use $parameters for all data (no string interpolation)', () => {
    const { cypher } = deploymentsNearWindowCypher();
    expect(cypher).toContain('$fromIso');
    expect(cypher).toContain('$toIso');
    expect(cypher).not.toMatch(/\$\{|\+\s*issueKey/);
  });

  it('parameterize the issue key in the postmortem query', () => {
    const { cypher } = postmortemsForIssueCypher();
    expect(cypher).toContain('$issueKey');
  });

  it('match deployments, pull requests and services', () => {
    const { cypher } = deploymentsNearWindowCypher();
    expect(cypher).toMatch(/MATCH \(d:Deployment\)/);
    expect(cypher).toMatch(/PullRequest/);
    expect(cypher).toMatch(/SoftwareService/);
  });
});

describe('parseCypherResponse', () => {
  const canonical = {
    data: {
      cypherQuery: {
        edges: [
          {
            node: {
              columns: [
                {
                  key: 'd',
                  value: {
                    __typename: 'CypherQueryResultNode',
                    id: 'ari:cloud:eco::deployment/1',
                    data: { __typename: 'Deployment', title: 'Release 4.22.1', finishedAt: '2026-11-08T09:48:00Z' },
                  },
                },
                {
                  key: 'services',
                  value: {
                    __typename: 'CypherQueryResultListNode',
                    nodes: [
                      { id: 'svc-1', data: { __typename: 'SoftwareService', displayName: 'payments-gateway' } },
                      { id: 'svc-2', data: { __typename: 'SoftwareService', displayName: 'checkout-web' } },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
  };

  it('parses canonical node + list columns', () => {
    const rows = parseCypherResponse(canonical);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.['d']?.data?.title).toBe('Release 4.22.1');
    expect(rows[0]?.['services']?.nodes).toHaveLength(2);
  });

  it('returns [] for empty results (known EAP behavior on fresh tenants)', () => {
    expect(parseCypherResponse({ data: { cypherQuery: { edges: [] } } })).toEqual([]);
  });

  it('tolerates null/undefined/malformed bodies', () => {
    expect(parseCypherResponse(undefined)).toEqual([]);
    expect(parseCypherResponse(null)).toEqual([]);
    expect(parseCypherResponse({ data: null })).toEqual([]);
    expect(parseCypherResponse({ data: { cypherQuery: null } })).toEqual([]);
    expect(parseCypherResponse({ errors: [{ message: 'boom' }] })).toEqual([]);
    expect(parseCypherResponse('nonsense')).toEqual([]);
  });

  it('skips columns without keys but keeps the rest of the row', () => {
    const weird = { data: { cypherQuery: { edges: [{ node: { columns: [{ value: { id: 'x' } }, { key: 'ok', value: { id: 'y' } }] } }] } } };
    const rows = parseCypherResponse(weird);
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]!)).toEqual(['ok']);
  });
});

describe('graphNodeTitle / graphNodeUrl', () => {
  it('prefers human titles in priority order', () => {
    expect(graphNodeTitle({ displayName: 'payments-gateway', name: 'x' })).toBe('payments-gateway');
    expect(graphNodeTitle({ title: 'Release 4.22.1' })).toBe('Release 4.22.1');
    expect(graphNodeTitle({ key: 'IN-1' })).toBe('IN-1');
    expect(graphNodeTitle(undefined)).toBe('Untitled');
    expect(graphNodeTitle({})).toBe('Untitled');
  });

  it('extracts only http(s) urls', () => {
    expect(graphNodeUrl({ url: 'https://bitbucket.org/x/y' })).toBe('https://bitbucket.org/x/y');
    expect(graphNodeUrl({ webUrl: 'http://insecure' })).toBe('http://insecure');
    expect(graphNodeUrl({ url: 'javascript:alert(1)' })).toBeUndefined();
    expect(graphNodeUrl({})).toBeUndefined();
  });
});
