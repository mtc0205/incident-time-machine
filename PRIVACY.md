# Privacy Policy — Incident Time Machine

_Last updated: 2026-11-09_

Incident Time Machine is an Atlassian Forge app ("the app") for Jira Service
Management. This policy explains what the app does with information.

## What the app reads
When installed, the app can read (within the Atlassian REST scopes it requests):
- Jira issue fields (summary, description, labels, status, dates, participants)
  of issues you open the panel on;
- Confluence page metadata reachable via the Teamwork Graph, if connected;
- Deployment / pull-request / commit / service entities that your organization
  has ingested into the Teamwork Graph.

## What the app stores
- Forge Key-Value Store entries: a demo-mode flag and comment-digest
  de-duplication keys (issue id + timestamp). **No issue content, no personal
  data, no credentials are stored** by the app.
- The app sends no data to any third-party service. All computation
  (similarity scoring, change correlation) runs inside Atlassian Forge
  functions in your app's own tenant.

## Human involvement
The agent ("Chronos") only reads and summarizes. It posts a comment only when
you explicitly invoke the "Post triage digest" action.

## Contact
Questions about this policy: open an issue at
https://github.com/mtc0205/incident-time-machine/issues
