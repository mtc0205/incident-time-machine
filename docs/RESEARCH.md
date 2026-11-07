# Forge Platform Research — verified 2026-11-08

Ground truth = official npm packages installed locally and read directly
(`@forge/api` 8.4.0, `@forge/bridge` 7.2.1, `@forge/react` 12.4.0,
`@forge/cli` 14.2.0, `@forge/resolver` 2.0.0 — all latest at research time;
CLI 15.0.0 exists but 14.2.0 is what npm resolved). Supplemented with
developer.atlassian.com pages (manifest reference, Rovo agent module,
Teamwork Graph API guide).

## 1. Toolchain facts

- **UI package:** `@forge/react` is the current UI Kit (real React with a
  Forge reconciler). The legacy `@forge/ui` (Stegosite era) is not used by
  current templates. `ForgeReconciler.render(<React.StrictMode><App/></React.StrictMode>)`
  is the entry point contract (`src/frontend/index.tsx`).
- **Components available** (from `@forge/react/out/components`): Text,
  Heading, Stack, Box, Inline, Bleed, Button, ButtonGroup, LoadingButton,
  LinkButton, Link, Lozenge, Badge, Label, SectionMessage (+Action),
  DynamicTable, Spinner, Tabs/TabList/Tab/TabPanel, Tooltip, ProgressBar,
  Image, Icon, List/ListItem, EmptyState, Code/CodeBlock, Form*/Select/
  Textfield/TextArea/Checkbox/Radio*, Modal*, Popup, User/UserGroup,
  Pressable, Tag/TagGroup + charts (BarChart, LineChart, PieChart,
  DonutChart, StackBarChart...). Styling only via `xcss()` tokens — no
  arbitrary CSS.
- **Hooks:** `useProductContext`, `useIssueProperty`, `useTheme`,
  `useContentProperty`, `useForm`, `useObjectStore`, `usePermissions`.
- **Bridge** (`@forge/bridge`): `invoke`, `requestJira`, `requestConfluence`,
  `requestTeamworkGraph`, `router`, `events`, `trigger`'s etc.
- **Resolvers** (backend functions callable from UI via `invoke`):
  `@forge/resolver` package, `resolver.define(key, fn)`,
  `export const handler = resolver.getDefinitions()`.
- **Runtime:** `nodejs24.x` supported (enum in schema + docs recommend it).
- **`forge lint` runs offline**: schema validation happens before the
  login check. Requires env `FORGE_DISABLE_ANALYTICS=1` in non-TTY shells
  (otherwise the analytics consent prompt crashes). Schema errors print
  with line numbers; reaching `Error: Not logged in` == manifest schema
  passed. We also validate programmatically with `ajv` against
  `@forge/manifest/out/schema/manifest-schema.json` (the same schema the
  CLI ships) via `npm run validate:manifest`.

## 2. Manifest shape (current, verified against shipped JSON schema)

Required top level: `app` (with required `id` + `runtime.name` — runtime now
lives **under `app`**), `modules` (non-empty), `permissions`.

```yaml
app:
  id: ari:cloud:ecosystem::app/<uuid>          # filled by forge register
  runtime:
    name: nodejs24.x
modules:
  function:
    - key:resolver
      handler: index.handler
  jira:issuePanel:
    - key: panel
      resource: ui              # -> resources[].key
      resolver: { function: resolver }
      render: native
      icon: "⏱️"                # icon is REQUIRED for issuePanel
      title: Incident Time Machine
resources:
  - key: ui
    path: src/frontend/index.tsx
permissions:
  scopes: [...]
```

## 3. Confirmed module keys relevant to us (from 211-module schema)

- `rovo:agent` — array items: `key`, `name` (max 30 chars), `description`,
  `icon`, **`prompt`** (inline string or resource path — *not* the old
  `instructions`), `conversationStarters` (string[]), `actions` (keys of
  `action` modules), `skills` (rovo:skill keys), `followUpPrompt`.
- `action` — the Rovo action module (plain `action` key, *not*
  `rovo:action`). Modern variant: `key`, `function`, `description` (what the
  agent uses to decide invocation, <=255), `actionVerb`
  (`CREATE|UPDATE|DELETE|TRIGGER|GET`), `name`, `icon`,
  `inputs` (map name -> {title, description, type in
  boolean|integer|number|string}, max 10), `outputs` (map name ->
  {description, nullable, type}), `outputContext`.
- `rovo:mcp` — `key`, `name`, `tools` (list of `action` keys). Cheap to add
  => bonus prize eligibility ("Best app with Atlassian MCP").
- `rovo:skill` — SKILL.md-based, frontmatter-driven, marked "internal only"
  in schema (XLS-inserted); skipping in favor of actions + mcp.
- `rovo:agentConnector` — for remotely hosted agents; not needed.
- `jira:issuePanel` — resource + resolver + render:native + icon + title.
- `trigger` — `events` (e.g. `avi:jira:created:issue`), `function`, `filter`,
  optional `payload.include`. Event names are plain strings in the schema;
  `avi:jira:created:issue` is the long-documented issue-created event.
- `jiraServiceManagement:*` exist (queuePage, portalRequestDetailPanel…) —
  not needed; incidents are issues, `jira:issuePanel` renders on them.
- `graph:connector` / `graph:smartLink` — Teamwork Graph connector modules
  (for ingesting external data); we consume the graph instead.
- `function`, `scheduledTrigger`, `webtrigger`, `migration`, `endpoint`,
  `llm` (claude models config) also exist.

## 4. Teamwork Graph API from Forge (EAP, verified)

- Backend: `import api from '@forge/api'`;
  `await api.asApp().requestTeamworkGraph(gqlQuery, variables?)` ->
  `APIResponse` (typed in `@forge/api/out/index.d.ts` line 47).
- Frontend: `requestTeamworkGraph` also exported from `@forge/bridge`.
- Queries are **Cypher wrapped in GraphQL** via the `cypherQuery` field:

```graphql
query q($cypherQuery: String!, $params: CypherRequestParams) {
  cypherQuery(query: $cypherQuery, params: $params) {
    edges { node { columns { key value { __typename
      ... on CypherQueryResultListNode { nodes { id data { __typename } } }
    } } } } } }
```

- Endpoint behind the scenes: `https://<site>.atlassian.net/gateway/api/graphql/twg`.
- Scopes (exact strings from `@forge/manifest/out/scopes/teamwork-graph-scopes.json`,
  read-scoped): `read:graph:issue:jira`, `read:graph:page:confluence`,
  `read:graph:deployment:external`, `read:graph:pull-request:external`,
  `read:graph:commit:external`, `read:graph:repository:external`,
  `read:graph:service:external`, `read:graph:work-item:external`,
  `read:graph:project:jira`, `read:graph:user:atlassian`, etc.
  (`:external` = entities ingested from third parties; Atlassian-native
  entities use `:jira`/`:confluence` suffixes).
- Community reports (Oct-Nov 2026) note empty results on fresh tenants and
  allowlist requirements during EAP => **our design treats the graph as an
  enrichment layer with graceful fallback**, never a hard dependency.

## 5. Other platform facts

- Classic scopes still valid alongside granular ones: `read:jira-work`,
  `write:jira-work` (needed to post comments), `read:confluence-content.all`?
  — we use granular `read:page:confluence` + `search:confluence` instead.
- `app.runtime.name` enum: nodejs20.x | nodejs22.x | nodejs24.x.
- No `Flex` component in @forge/react 12.4.0 — use `Stack`/`Inline`/`Box`.
- forge CLI writes no project files until `forge register`; local
  validation path documented above works offline.

## 6. Sources

- Local: `node_modules/@forge/manifest/out/schema/manifest-schema.json`
  (211 module keys), `.../scopes/*.json`, `@forge/react/out/**`,
  `@forge/bridge/out/index.d.ts`, `@forge/api/out/index.d.ts`.
- Web: developer.atlassian.com — manifest-reference overview, modules
  reference, rovo-agent module page (example manifest), "Call the Teamwork
  Graph API" guide; community.developer.atlassian.com threads on EAP quirks.
