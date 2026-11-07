# Incident Time Machine — Design (LOCKED 2026-11-08)

## Pitch

**Every incident has happened before. Incident Time Machine remembers.**

When a Jira Service Management incident fires, responders lose 20-40 minutes
to the same ritual every time: search old tickets, ping the person who
"fixed this last time", hunt the deploy that "probably caused this".
Incident Time Machine compresses that ritual into zero seconds. The moment
an incident is created, it:

1. **Finds the past** — ranks the most similar resolved incidents with a
   composite score (TF-IDF text similarity + affected-service overlap +
   label/component signals + recency), and shows who resolved them, how
   long they took (MTTR), and the exact fix.
2. **Names the suspect** — correlates Bitbucket deployments and pull
   requests around the incident window (via Teamwork Graph edges) with the
   affected service, and surfaces the change most likely responsible.
3. **Links the knowledge** — pulls Confluence postmortems connected to
   those incidents through the Teamwork Graph.
4. **Writes it down** — posts an "Incident Time Machine digest" comment on
   the issue (auto on creation) and renders a live panel in the issue view.
5. **Answers in chat** — the bundled Rovo agent "Chronos" answers
   "what broke like this before and who fixed it?" with the same engine,
   and can post digests on demand. The same tools are exposed through a
   `rovo:mcp` server for any agent to use.

## Why this concept won the selection

- Strongest demo arc (chaos -> instant historical context) and a crisp
  one-liner; jargon-free for non-engineering judges.
- Naturally spans 4 Atlassian surfaces: JSM/Jira (incidents), Confluence
  (postmortems), Bitbucket (deploys/PRs), Teamwork Graph (the connective
  tissue) + Rovo (agent + MCP).
- The deterministic core (retrieval + scoring + correlation) is exactly the
  kind of logic that is impressive when unit-tested and honest about NOT
  needing a paid LLM. Rovo provides the AI polish on top.
- Concept B (review routing) overlaps existing Codecov/CodeOwners tooling;
  incident memory is a less crowded niche with a sharper pain point.

## User flow

```
JSM incident created (issue type = Incident / "IN" project)
        │
        ▼  trigger: avi:jira:created:issue
┌─────────────────────────────────────────────────────────────┐
│ ENGINE (pure TS core + thin Forge adapters)                 │
│  1. fetch incident issue (summary, desc, labels, components)│
│  2. build corpus: resolved incidents (JQL) + cached + demo  │
│  3. score similarity (text+service+labels+recency)          │
│  4. correlate changes: graph deployments/PRs in ±window     │
│     (fallback: Bitbucket webhooks/Jira dev panels data)     │
│  5. link postmortems (graph pages / Confluence CQL search)  │
│  6. build digest (panel view model + Jira comment markdown) │
└─────────────────────────────────────────────────────────────┘
   │                          │                        │
   ▼                          ▼                        ▼
 comment on issue      jira:issuePanel          rovo:agent "Chronos"
 (auto-posted)         "Time Machine" tab       (chat: same actions)
                                                      │
                                              rovo:mcp server
                                              (same tools for any agent)
```

Responder flow: open incident -> panel already shows similar incidents
with scores, resolvers, MTTR, the fix that worked, the suspect deploy, and
postmortem links. Click "Post triage digest" if the auto-comment hasn't
landed. Ask Chronos in chat: "Who fixed incidents like IN-42 before?".

## Architecture — deterministic core vs Forge adapter

**Core (pure TypeScript, zero Forge imports, 100% unit-tested):**

| File | Responsibility |
|---|---|
| `src/core/types.ts` | IncidentRecord, ChangeEvent, Digest, ScoredIncident... |
| `src/core/text.ts` | tokenize, stopwords, TF-IDF vectors, cosine similarity |
| `src/core/scoring.ts` | composite similarity score + explanations |
| `src/core/changeCorrelator.ts` | deploy/PR-to-incident causality scoring |
| `src/core/digest.ts` | digest view model + Jira comment markdown rendering |
| `src/core/cypher.ts` | Teamwork Graph query builders + response parsers |
| `src/core/demoData.ts` | seeded, vivid demo corpus (incidents, deploys, postmortems) |

**Forge layer (thin adapters, no logic):**

| File | Responsibility |
|---|---|
| `src/backend/jira.ts` | requestJira wrapper: get issue, JQL search resolved incidents, post comment |
| `src/backend/graph.ts` | requestTeamworkGraph wrapper using core/cypher, graceful empty-fallback |
| `src/backend/store.ts` | Forge storage KVS: corpus cache, demo-mode flag, digest cache |
| `src/backend/engine.ts` | orchestrates core + adapters; used by all entry points |
| `src/backend/resolver.ts` | UI resolvers (getPanelData, postDigest, toggleDemoMode, seedDemoData) |
| `src/backend/trigger.ts` | issue-created handler -> auto digest comment |
| `src/backend/actions.ts` | Rovo actions: get-incident-history, get-likely-cause, post-triage-digest |
| `src/frontend/index.tsx` | panel UI (Forge UI Kit) |

**Manifest module map:**

| Module | Key | Purpose |
|---|---|---|
| `function` | resolver / engine-fn / trigger-fn / action-* | backend handlers |
| `jira:issuePanel` | incident-time-machine | the panel (resource ui, render native, resolver) |
| `trigger` | incident-created | avi:jira:created:issue -> auto digest |
| `action` | get-incident-history (GET) | agent tool: similar incidents |
| `action` | get-likely-cause (GET) | agent tool: suspect deploy/PR |
| `action` | post-triage-digest (CREATE) | agent tool: post digest comment |
| `rovo:agent` | chronos | the Rovo agent |
| `rovo:mcp` | incident-time-machine-mcp | MCP server exposing the GET tools |
| `resources` | ui | src/frontend/index.tsx |

Scopes: `read:jira-work`, `write:jira-work` (comment), `read:page:confluence`,
`search:confluence`, `read:graph:issue:jira`, `read:graph:page:confluence`,
`read:graph:deployment:external`, `read:graph:pull-request:external`,
`read:graph:commit:external`, `read:graph:repository:external`,
`read:graph:service:external`, `read:graph:user:atlassian`,
`storage:app`.

## Scoring model (deterministic, explainable)

```
similarity(a, b) =
    0.55 * cosine(tfidf(a.text), tfidf(b.text))
  + 0.25 * serviceOverlap(a, b)            # Jaccard of services/components
  + 0.10 * labelOverlap(a, b)
  + 0.10 * recencyBoost(b.resolvedAt)      # half-life 180d, floor 0.2
```
Every scored match carries an `explanation` array (which factors
contributed, with weights) — the panel and the agent BOTH show reasoning.
Matches below 0.28 are excluded.

## Change causality model

```
suspectScore(deploy, incident) =
    timeProximity(deploy.finishedAt, incident.createdAt)   # ±48h window, triangular kernel peaking 2h before onset
  * serviceMatch(deploy.services, incident.services)       # 1.0 exact, 0.5 ancestor, 0.15 none
  * (1 + 0.3 * prRisk(pr))                                 # PR size/touch-count proxy
```

## Demo mode (judge experience)

Real-tenant mode builds the corpus from actual resolved JSM issues. On a
fresh judge site with no history, the engine auto-enables **Demo Mode**
(one-click toggle in panel; clearly labeled banner) using the seeded
corpus: 22 vivid incidents across "Payments Gateway / Checkout / Search /
Identity" services, 30 deploys by named engineers, 6 postmortems, wired
with graph-shaped edges. Deterministic seed => reproducible screenshots.
Demo data lives in `src/core/demoData.ts`, unit-tested for referential
integrity.

## Test plan (vitest, all offline)

- text: tokenization, stopwords, TF-IDF weighting, cosine bounds,
  identical/dissimilar docs, term dedup.
- scoring: factor isolation (bump each factor, assert ranking), recency
  half-life math, service Jaccard, threshold exclusion, explanation
  contents, deterministic tie-breaks.
- changeCorrelator: window edges, kernel peak, service match levels,
  PR risk proxy, ranking, empty-window.
- digest: markdown structure, score formatting, empty corpus, escaping of
  hostile strings (XSS in comment markdown), panel view model parity.
- cypher: query builders produce parameterized Cypher (no string
  interpolation of user data), parsers handle canonical + empty + malformed
  responses.
- demoData: deterministic (same seed -> same corpus), referential integrity
  (every referenced deploy/postmortem exists), realistic dates.
- engine (with mocked adapters): end-to-end digest generation, demo-mode
  auto-enable, trigger dedup guard.

~8 suites, 70+ assertions. `npm run validate:manifest` additionally checks
manifest.yml against the CLI's own shipped JSON schema with ajv.

## Out of scope (explicitly)

- Writing INTO Teamwork Graph (EAP, allowlist-gated) — we consume it; the
  graph:connector module is documented as the write path and noted in
  README as future work.
- rovo:skill packaging (schema marked internal-only), Bitbucket UI panels,
- Slack/Teams notification fan-out, multi-language digests.
