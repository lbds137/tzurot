---
id: TASK-62
title: 'Railway ops tooling'
status: To Do
assignee: []
created_date: '2026-06-17 00:00'
labels:
  - 'area:tooling'
dependencies: []
ordinal: 62000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Railway ops tooling — sanctioned token access + GraphQL ops the CLI lacks

**Why:** Railway CLI v4.11.2's `variables` only supports `--set` (no unset/delete), and reading the auth token from `~/.railway/config.json` is correctly blocked as credential exploration — so deleting a Railway env var has no in-band path (the beta.133 probe cleanup had to be hand-done in the dashboard). Two-part fix: (1) a sanctioned, auditable token path — a dedicated `RAILWAY_API_TOKEN` the user sets once (documented in `RAILWAY_CLI_REFERENCE.md`, never logged, used transiently per-call), legible as intentional tooling vs. credential scraping; project-scoped vs. account token is the open design question. (2) Wrap the CLI-missing GraphQL ops as `pnpm ops` commands (start with `variableDelete`; consider a full variable CRUD surface + redeploy/status queries) in the tooling package with mocked-HTTP tests. Endpoint `https://backboard.railway.app/graphql/v2`; `VariableDeleteInput` = projectId/environmentId/serviceId/name; IDs via `railway status --json`. Security: never log the token, `Authorization: Bearer` only, fail-fast if unset. **Promote when**: the next in-session Railway mutation need, OR a deliberate dev-tooling pass. Surfaced + triaged 2026-06-17.
<!-- SECTION:DESCRIPTION:END -->
