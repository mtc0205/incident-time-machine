# ⏱️ Incident Time Machine

**Every incident has happened before. Incident Time Machine remembers.**

A [Codegeist 2026](https://codegeist2026.devpost.com/) entry — an Atlassian Forge
app for Jira Service Management that compresses incident triage from 30 minutes
of archaeology to 0 seconds of memory.

When a JSM incident fires, the app instantly surfaces:

1. **The past** — the most similar resolved incidents (TF-IDF text similarity +
   service overlap + labels + recency), with *who resolved them*, *how long
   they took*, and *the exact fix that worked*.
2. **The suspect** — Bitbucket deployments / PRs in the incident's time window,
   correlated through the **Teamwork Graph** and ranked by a causal-timing
   model (the "shipped at 14:00, broke at 15:20" pattern).
3. **The knowledge** — Confluence postmortems connected to those incidents.
4. **The people** — responders ranked by weighted resolution history.

All of it lands as a digest comment **automatically when the incident is
created**, renders live in an issue panel, and is queryable in chat through the
bundled **Rovo agent "Chronos"** — whose tools are also exposed through a
**`rovo:mcp` server** so any agent in Rovo Studio can use them.

---

## Why this is not another "AI summary" app

- **Deterministic core.** The retrieval, scoring, causality and digest logic
  are pure TypeScript functions with **116 passing unit tests** and zero LLM
  calls. Every match carries a factor-by-factor explanation — responders can
  see *why* IN-1873 matched at 91%. No hallucination surface, no paid AI
  dependency. Rovo provides the conversational layer on top.
- **The graph is the product.** Incidents don't live in Jira alone: the fix
  might be a Bitbucket rollback, the knowledge in a Confluence postmortem.
  The Teamwork Graph is what stitches them — this app consumes it as the
  connective tissue and degrades gracefully when a site's graph is empty.
- **Explainable causality.** The suspect-ranking model scores each deploy by
  time-proximity kernel × service match × PR breadth, and *shows its reasoning
  in the UI and in chat*.

## Surfaces used

| Surface | How |
|---|---|
| **Jira Service Management / Jira** | Incident issues (read + comment), issue panel, issue-created trigger |
| **Teamwork Graph** | Deployments, pull requests, services, linked pages via `requestTeamworkGraph` (Cypher-in-GraphQL) |
| **Confluence** | Postmortems/knowledge surfaced through graph links |
| **Rovo** | `rovo:agent` (Chronos) with 3 `action` tools; same tools on `rovo:mcp` |
| **Forge platform** | UI Kit (`@forge/react`), functions, trigger, KVS (`@forge/kvs`) |

## Architecture

```
┌─────────────────────────── Atlassian surfaces ───────────────────────────┐
│  JSM incident issue        Teamwork Graph           Rovo chat / MCP      │
│  (panel + trigger +        (deploys, PRs,           (Chronos agent,      │
│   digest comments)          services, pages)         3 shared tools)     │
└──────────┬──────────────────────┬────────────────────────┬──────────────┘
           │ src/backend/jira.ts  │ src/backend/graph.ts   │ src/backend/actions.ts
           │ (requestJira)        │ (requestTeamworkGraph) │ + trigger.ts + resolver.ts
┌──────────┴──────────────────────┴────────────────────────┴──────────────┐
│ src/backend/ports.ts — EnginePorts (adapter interface)                  │
├─────────────────────────────────────────────────────────────────────────┤
│ src/core/ — PURE TypeScript, 0 forge imports, 116 unit tests            │
│  text.ts            tokenize / TF-IDF / cosine similarity               │
│  scoring.ts         composite similarity + explanations                 │
│  changeCorrelator.ts causal deploy/PR ranking (time kernel × service)   │
│  digest.ts          digest model → ADF comment / agent summary          │
│  adf.ts             Atlassian Document Format builders + flattening     │
│  cypher.ts          Teamwork Graph query builders + parsers             │
│  engine.ts          orchestration over injected ports                   │
│  demoData.ts        seeded demo corpus (Northbeam Commerce)             │
└─────────────────────────────────────────────────────────────────────────┘
```

The **same engine** serves the panel, the trigger, the agent and the MCP
server — one brain, four mouths.

## The deterministic models

**Incident similarity** (threshold 0.28):

```
similarity(a,b) = 0.55·cosine(tfidf(a),tfidf(b)) + 0.25·jaccard(services)
                + 0.10·jaccard(labels) + 0.10·recency(180d half-life, 0.2 floor)
```

**Change causality**:

```
suspectScore = timeProximity(deploy→onset; ±48h triangular kernel, peak 0–3h before)
             × serviceMatch (1.0 exact / 0.5 namespace-relative / 0.15 none)
             × (1 + 0.3·prRisk(breadth))
```

Both are pure, explainable and unit-tested (including tie-breaking and
injection-escaping behavior).

## Install & run (judges — 10 minutes)

Prereqs: a free Atlassian developer site ([get one](https://developer.atlassian.com/cloud/))
and Node.js 20+.

```bash
npm install -g @forge/cli
forge login                      # browser flow, no card, no paid tier
cd app
npm install

# Register the app on your site (writes the real app id into manifest.yml):
forge register

forge deploy
forge install --site <yoursite>.atlassian.net --product jira    # consent prompts appear here
```

Then on your site:

1. Open any Jira issue (a JSM incident type works best) → the **Incident Time
   Machine** panel appears in the issue view.
2. On a fresh site the panel starts in **Demo mode** (clearly labeled): a
   seeded corpus of 14 vivid incidents, 7 deploys/PRs and 5 postmortems for
   the fictional "Northbeam Commerce" platform. Open an issue with text like
   *"Checkout payments failing with 502s after card authorization"* and the
   engine matches IN-1873 at ~90%, names the 4.22.1 payments deploy as top
   suspect, and suggests Mei Tanaka (resolved 3 similar incidents).
3. Click **Post triage digest** — a formatted ADF comment lands on the issue.
4. In Jira, chat with **Chronos** (Rovo): try the conversation starter
   *"What incidents are similar to IN-1042?"* (use your real issue key).
   The agent calls the same tools exposed on the MCP server.
5. Create a new incident-type issue — the trigger posts the digest
   automatically within seconds.

### Going live on real data

Demo mode is a fallback, not the product. Once your site has ≥3 resolved
incidents (any project; incident-type issues are preferred), the engine
switches to **SITE HISTORY** and matches against your real issues, with
Teamwork Graph enrichment when Bitbucket/dev-tool connectors are installed.
The panel toggle flips modes explicitly.

## Development

```bash
npm run check              # typecheck + eslint + 116 tests + manifest schema validation
npm run validate:manifest  # ajv validation against @forge/manifest's shipped schema (offline)
node scripts/sync-agent-prompt.mjs   # after editing src/backend/agentPrompt.ts
forge tunnel               # live logs while you exercise the panel
```

Notes verified against the current platform (Nov 2026):

- `app.runtime.name: nodejs24.x` (runtime now lives under `app`).
- Rovo actions are the plain `action` module with `actionVerb`
  (GET/CREATE) + `inputs`/`outputs` (outputs require `outputContext`).
- `rovo:mcp` exposes `action` keys as MCP tools.
- KVS is the `@forge/kvs` package (`storage:app` scope) — the legacy
  `@forge/api` storage module is gone.
- `requestTeamworkGraph` is called as the user (EAP); see `docs/RESEARCH.md`
  for the full citation trail.

## Repo layout

```
app/
├── manifest.yml              # 6 module types incl. rovo:agent + rovo:mcp
├── src/core/                 # pure logic — the product brain
├── src/backend/              # thin Forge adapters + entry points
├── src/frontend/index.tsx    # UI Kit panel
├── tests/                    # 8 suites, 116 tests
├── scripts/                  # offline manifest validation, prompt sync
└── docs/                     # RESEARCH.md (platform ground truth), DESIGN.md
```

## Scope & future work

- **Teamwork Graph write path** (`graph:connector`) — ingest non-Atlassian
  monitoring alerts as graph entities so causality can score them too.
- Bitbucket PR panels (surface suspect changes at review time).
- Multi-language digests; Slack/Teams fan-out of the digest.

MIT licensed. Built for Codegeist 2026.
