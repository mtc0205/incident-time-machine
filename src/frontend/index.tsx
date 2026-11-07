/**
 * Incident Time Machine — issue panel (Forge UI Kit, @forge/react).
 *
 * Three tabs: similar incidents, suspect change, and the people + knowledge
 * to pull in. Everything renders from one resolver call (`getPanelData`)
 * backed by the same engine the Rovo agent uses.
 */

import React, { useCallback, useEffect, useState } from 'react';
import ForgeReconciler, {
  Badge,
  Box,
  Button,
  DynamicTable,
  EmptyState,
  Heading,
  Inline,
  Label,
  Link,
  LoadingButton,
  Lozenge,
  SectionMessage,
  SectionMessageAction,
  Spinner,
  Stack,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Text,
  Tooltip,
  useProductContext,
} from '@forge/react';
import { invoke } from '@forge/bridge';
import type { IncidentDigest } from '../core/types';
import { formatDuration } from '../core/digest';

interface PanelData {
  digest: IncidentDigest;
  demoMode: boolean;
}

/**
 * invoke() returns either the value or a {body, metadata} wrapper depending
 * on platform version — this helper normalizes it (typed contract in
 * @forge/bridge/out/types.d.ts).
 */
function unwrap<T>(response: T | { body: T; metadata?: unknown }): T {
  if (response && typeof response === 'object' && 'body' in (response as Record<string, unknown>)) {
    return (response as { body: T }).body;
  }
  return response as T;
}

const App = () => {
  const context = useProductContext();
  const issueKey: string | undefined = (context as { extension?: { issue?: { key?: string } } } | undefined)?.extension?.issue?.key;

  const [data, setData] = useState<PanelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [demoBusy, setDemoBusy] = useState(false);

  const load = useCallback(async () => {
    if (!issueKey) return;
    setLoading(true);
    try {
      const result = unwrap<PanelData>(await invoke<PanelData>('getPanelData', { issueKey }));
      setData(result);
      setMessage(null);
    } catch {
      setMessage('Could not reach the Time Machine. Try refreshing.');
    } finally {
      setLoading(false);
    }
  }, [issueKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const postDigest = async () => {
    if (!issueKey) return;
    setPosting(true);
    try {
      const result = unwrap<{ posted: boolean; reason: string | null }>(
        await invoke<{ posted: boolean; reason: string | null }>('postDigest', { issueKey })
      );
      setMessage(result.posted ? 'Digest posted to the issue.' : `Not posted: ${result.reason ?? 'unknown reason'}.`);
    } catch {
      setMessage('Posting failed — try again.');
    } finally {
      setPosting(false);
    }
  };

  const toggleDemo = async () => {
    setDemoBusy(true);
    try {
      await invoke('setDemoMode', { enabled: !(data?.demoMode ?? false) });
      await load();
    } finally {
      setDemoBusy(false);
    }
  };

  if (loading && !data) {
    return (
      <Stack space="space.100" alignInline="start">
        <Inline space="space.100">
          <Spinner size="small" />
          <Text>Rewinding the tape…</Text>
        </Inline>
      </Stack>
    );
  }

  if (!data) {
    return <EmptyState header="Time Machine offline" description={message ?? 'Open this panel from a Jira issue.'} />;
  }

  const { digest, demoMode } = data;

  return (
    <Stack space="space.150">
      <Inline space="space.100" alignBlock="center" grow="fill">
        <Heading as="h3">⏱️ Incident Time Machine</Heading>
        {digest.source === 'demo' ? <Lozenge appearance="new">DEMO CORPUS</Lozenge> : <Lozenge appearance="success">SITE HISTORY</Lozenge>}
        <Box xcss={{ flexGrow: 1 }} />
        <Tooltip content="Re-run the matching engine">
          <Button onClick={() => void load()} appearance="subtle">
            Refresh
          </Button>
        </Tooltip>
      </Inline>

      {digest.source === 'demo' && (
        <SectionMessage title="Demo corpus in use" appearance="information">
          <Text>
            This site has little resolved incident history yet, so the Time Machine is showing a seeded demo corpus
            (Northbeam Commerce). Resolve real incidents to switch to live matching — or use the toggle below.
          </Text>
          <SectionMessageAction onClick={() => void toggleDemo()}>
            {demoBusy ? 'Switching…' : demoMode ? 'Use site history' : 'Keep demo data'}
          </SectionMessageAction>
        </SectionMessage>
      )}

      <Inline space="space.100">
        <Inline space="space.050">
          <Label labelFor="itm-matches">Matches</Label>
          <Badge>{String(digest.stats.matchedCount)}</Badge>
        </Inline>
        <Inline space="space.050">
          <Label labelFor="itm-mttr">Median fix time</Label>
          <Badge>{digest.stats.medianMinutesToResolve !== undefined ? formatDuration(digest.stats.medianMinutesToResolve) : '—'}</Badge>
        </Inline>
        <Inline space="space.050">
          <Label labelFor="itm-services">Services</Label>
          <Badge>{digest.stats.servicesAffected.slice(0, 3).join(', ') || '—'}</Badge>
        </Inline>
      </Inline>

      <Tabs id="itm-tabs">
        <TabList>
          <Tab>Similar incidents</Tab>
          <Tab>Likely cause</Tab>
          <Tab>People & knowledge</Tab>
        </TabList>

        <TabPanel>
          <SimilarIncidentsTab digest={digest} />
        </TabPanel>

        <TabPanel>
          <LikelyCauseTab digest={digest} />
        </TabPanel>

        <TabPanel>
          <PeopleTab digest={digest} />
        </TabPanel>
      </Tabs>

      {message && <SectionMessage appearance="success">{message}</SectionMessage>}

      <Inline space="space.100">
        <LoadingButton appearance="primary" isLoading={posting} onClick={() => void postDigest()}>
          Post triage digest
        </LoadingButton>
        <Text>Posts the digest as a comment on this issue.</Text>
      </Inline>
    </Stack>
  );
};

const SimilarIncidentsTab = ({ digest }: { digest: IncidentDigest }) => {
  if (digest.matches.length === 0) {
    return (
      <EmptyState
        header="No similar incidents found"
        description="This one might be a genuine first. Check back after more incidents are resolved."
      />
    );
  }
  const head = {
    cells: [
      { key: 'score', content: 'Match', isSortable: true },
      { key: 'incident', content: 'Incident' },
      { key: 'fix', content: 'What fixed it' },
      { key: 'mttr', content: 'Fix time' },
      { key: 'resolver', content: 'Resolver' },
    ],
  };
  const rows = digest.matches.map((m) => ({
    key: m.incident.key,
    cells: [
      { key: `${m.incident.key}-score`, content: <Lozenge appearance={m.score > 0.6 ? 'success' : 'new'}>{`${Math.round(m.score * 100)}%`}</Lozenge> },
      {
        key: `${m.incident.key}-incident`,
        content: (
          <Stack space="space.050">
            <Text>
              <strong>{m.incident.key}</strong> — {m.incident.summary}
            </Text>
            <Inline space="space.050">
              {m.explanation
                .filter((f) => f.contribution > 0)
                .slice(0, 3)
                .map((f) => (
                  <Tooltip key={f.factor} content={f.detail}>
                    <Badge>{f.factor}</Badge>
                  </Tooltip>
                ))}
            </Inline>
          </Stack>
        ),
      },
      { key: `${m.incident.key}-fix`, content: m.incident.fixSummary ?? '—' },
      { key: `${m.incident.key}-mttr`, content: m.incident.minutesToResolve !== undefined ? formatDuration(m.incident.minutesToResolve) : '—' },
      { key: `${m.incident.key}-resolver`, content: m.incident.resolvedByName ?? '—' },
    ],
  }));
  return <DynamicTable head={head} rows={rows} rowsPerPage={5} />;
};

const LikelyCauseTab = ({ digest }: { digest: IncidentDigest }) => {
  if (digest.suspects.length === 0) {
    return (
      <EmptyState
        header="No suspect changes"
        description="No deployments or merges found in the ±48h window around this incident. Sites without dev-tool connectors return empty from the Teamwork Graph — the demo corpus includes sample changes."
      />
    );
  }
  return (
    <Stack space="space.100">
      {digest.suspects.map((s, i) => (
        <Stack key={s.change.id} space="space.050">
          <Inline space="space.100">
            {i === 0 && <Lozenge appearance="removed">TOP SUSPECT</Lozenge>}
            <Lozenge>{s.change.kind === 'deployment' ? 'Deploy' : 'PR'}</Lozenge>
            <Text>
              <strong>{`${Math.min(Math.round(s.score * 100), 100)}%`}</strong> — {s.change.title}
            </Text>
          </Inline>
          <Text>
            {`${s.change.authorName} · ${new Date(s.change.completedAt).toISOString().slice(0, 16).replace('T', ' ')}Z`}
            {s.change.ref ? ` · ${s.change.ref}` : ''}
            {s.change.url ? ' · ' : ''}
            {s.change.url ? <Link href={s.change.url}>view</Link> : null}
          </Text>
          {s.explanation.map((line) => (
            <Text key={line}>{`• ${line}`}</Text>
          ))}
        </Stack>
      ))}
    </Stack>
  );
};

const PeopleTab = ({ digest }: { digest: IncidentDigest }) => {
  const knowledge = [...digest.matches.flatMap((m) => m.incident.postmortemLinks), ...(digest.knowledge ?? [])];
  return (
    <Stack space="space.150">
      <Stack space="space.050">
        <Heading as="h4">People who fixed this before</Heading>
        {digest.suggestedResponders.length === 0 ? (
          <Text>No history to suggest from yet.</Text>
        ) : (
          digest.suggestedResponders.map((r) => (
            <Inline key={r.name} space="space.100">
              <Lozenge appearance="success">{`${r.resolvedCount}×`}</Lozenge>
              <Text>
                <strong>{r.name}</strong> — resolved {r.basedOn.join(', ')}
              </Text>
            </Inline>
          ))
        )}
      </Stack>
      <Stack space="space.050">
        <Heading as="h4">Connected knowledge</Heading>
        {knowledge.length === 0 ? (
          <Text>No linked postmortems or runbooks found.</Text>
        ) : (
          knowledge.slice(0, 6).map((link, i) => (
            <Inline key={`${link.url}-${i}`} space="space.050">
              <Lozenge appearance="moved">{link.source === 'teamwork-graph' ? 'GRAPH' : link.source === 'demo' ? 'DEMO' : 'LINK'}</Lozenge>
              <Link href={link.url}>{link.title}</Link>
            </Inline>
          ))
        )}
      </Stack>
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
