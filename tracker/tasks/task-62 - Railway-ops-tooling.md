---
id: TASK-62
title: 'Railway ops tooling: sanctioned token + GraphQL ops the CLI lacks'
status: To Do
assignee: []
created_date: '2026-06-17 00:00'
updated_date: '2026-09-04 19:40'
labels:
  - 'area:tooling'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 62000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Railway ops tooling — sanctioned token access + GraphQL ops the CLI lacks

**Why:** Railway CLI v4.11.2's `variables` only supports `--set` (no unset/delete), and reading the auth token from `~/.railway/config.json` is correctly blocked as credential exploration — so deleting a Railway env var has no in-band path (the beta.133 probe cleanup had to be hand-done in the dashboard). Two-part fix: (1) a sanctioned, auditable token path — a dedicated `RAILWAY_API_TOKEN` the user sets once (documented in `RAILWAY_CLI_REFERENCE.md`, never logged, used transiently per-call), legible as intentional tooling vs. credential scraping; project-scoped vs. account token is the open design question. (2) Wrap the CLI-missing GraphQL ops as `pnpm ops` commands (start with `variableDelete`; consider a full variable CRUD surface + redeploy/status queries) in the tooling package with mocked-HTTP tests. Endpoint `https://backboard.railway.app/graphql/v2`; `VariableDeleteInput` = projectId/environmentId/serviceId/name; IDs via `railway status --json`. Security: never log the token, `Authorization: Bearer` only, fail-fast if unset. **Promote when**: the next in-session Railway mutation need, OR a deliberate dev-tooling pass. Surfaced + triaged 2026-06-17.

**DECIDED 2026-08-14 (owner, TASK-599 digest): PROJECT-SCOPED token - owner provisions RAILWAY_API_TOKEN once (narrowest blast radius); wrap variableDelete first, then other CLI-missing ops.**
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:37
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. Owner already decided the design (2026-08-14, project-scoped token, wrap `variableDelete` first) but it isn't built — deleting a Railway env var still has no in-band path. Evidence: `git grep -n "variableDelete\|RAILWAY_API_TOKEN" packages/tooling/src docs/reference/RAILWAY_CLI_REFERENCE.md` → no results.
---

author: digest-pass
created: 2026-09-04 19:40
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): OWNER-DECIDED, UNBUILT (Shape 14). Carries a recorded owner decision; only implementation remains. Promoted to priority medium so it runs in one of the two decided-work drain batches rather than waiting on an opportunistic trigger that has not fired.
---
author: close-out
created: 2026-09-05 17:45
---
Merged as #2345 (2026-09-05, six review rounds, the last at the cap with both findings declined for reasons in the PR body). The command is `pnpm ops deploy:var-delete`; the variable is `TZUROT_RAILWAY_API_TOKEN` because the Railway CLI reads `RAILWAY_API_TOKEN` as its own login (probed). STAYS OPEN until the owner mints the project-scoped token into the local `.env` and runs the first real delete (`AUTO_DEPLOY_COMMANDS` on both bot-client services, dev then prod) — that run is the first live test of the endpoint and mutation shape. Carried from round 6: after that run, tighten `!data.variableDelete` to a strict `!== true` and pin the observed response shape with a Zod schema mirroring `railway-status.ts`; writing it against an unobserved shape is a guess.
---
<!-- COMMENTS:END -->
