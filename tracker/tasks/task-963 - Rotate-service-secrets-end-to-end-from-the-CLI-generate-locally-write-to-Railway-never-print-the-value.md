---
id: TASK-963
title: >-
  Rotate service secrets end-to-end from the CLI: generate locally, write to
  Railway, never print the value
status: To Do
assignee: []
created_date: '2026-09-13 17:39'
updated_date: '2026-09-13 22:04'
labels:
  - 'area:tooling'
  - 'size:M'
  - 'state:dependent'
dependencies: []
priority: high
ordinal: 960000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner ask 2026-09-13 after TASK-957 (the request log leaks the internal service secret): once the redaction ships, INTERNAL_SERVICE_SECRET on dev and prod must rotate, and today that is a hand job through the Railway dashboard — the value passes through a human clipboard and, if an agent helps, through a session transcript. With the env-scoped Railway tokens now in the local .env (TASK-62 follow-up), the rotation could be one command: generate the new value locally, write it to every service that reads the variable, trigger the redeploys, and never echo the value.
Owner ruling 2026-09-13 evening: NO manual rotation first — this command IS the rotation; its first prod run rotates INTERNAL_SERVICE_SECRET. Not urgent (owner: the value has been in the Railway logs for an unknown stretch already and the transcript copy goes only to Anthropic), but a beta.225 CUT CRITERION for the sake of safety, so it is done once and never needs thinking about again. Sequencing: TASK-62 follow-up then this, early in the beta.225 Opus lane. Priority high on the security dimension, not on urgency.
Open question that gates the design (investigate FIRST, cheapest probe): can the Shared variable tier be read and written through the Railway CLI or the public GraphQL API, or only per-service variables? railway variables --set is per service (docs/reference/RAILWAY_CLI_REFERENCE.md); the GraphQL variableUpsert mutation may take an environment-level scope — probe it with the dev token on a throwaway variable name, do not guess from docs. If shared variables are unreachable, the fallback is writing the same value to each service that references it, which the command can do in one pass.
Fix shape: packages/tooling/src/secrets/rotate-env-secret.ts (colocated test; registered in commands/secrets.ts; read docs/reference/audit-enforcement.md first) — pnpm ops secrets:rotate-env --env dev|prod --name INTERNAL_SERVICE_SECRET [--dry-run]: generates a 32-byte hex value, writes it to the shared tier (or every referencing service), records the rotation in the secret_rotations ledger the same way secrets:rotate-byok does (packages/tooling/src/secrets/rotation.ts), redeploys the affected services in an order that keeps bot-client and api-gateway agreeing (or documents the brief mismatch window), and prints only the variable name, the services touched, and the ledger row — never the value. The prod run stays behind the same pre-image check and owner grant the other prod write commands use.
Dependencies: TASK-62 (the token plumbing and the GraphQL ops); TASK-957 must ship before the first real prod rotation, or the new value is logged too.
Owner note 2026-09-13: if the rotation can be automated it should also become a skill or tooling entry — the command is the tooling half; the other half is the decision-point trigger written into 05-tooling.md § Secret Rotation (and the deployment skill if a redeploy order is involved), so the next rotation reaches for the command instead of the dashboard.
Acceptance: a dry run lists the services and the tier it would write; a dev run rotates the variable with no value in stdout, the ledger, or the transcript; the shared-tier question is answered in the task body with the probe output.

PROBE ANSWER 2026-09-13 (Opus, beta.225 lane, dev token, throwaway variable TZUROT_PROBE_DELETE_ME, created and deleted in one run): the SHARED (environment) tier is fully reachable through the public GraphQL API with serviceId OMITTED. Round trip, all status 200:
- read (query variables, no serviceId) -> 5 keys: BOT_OWNER_ID, INTERNAL_SERVICE_SECRET, LOG_LEVEL, NODE_ENV, ZAI_CODING_API_KEY
- variableUpsert (input without serviceId) -> returned true; read-back showed 6 keys including the probe name
- variableDelete (input without serviceId) -> returned true, typeof boolean; read-back returned to 5 keys, probe name gone
So the per-service fallback is NOT needed. INTERNAL_SERVICE_SECRET lives at the shared tier and is inherited by services (the api-gateway service-scoped read returns 30 keys and includes it), which means the rotation is ONE variableUpsert at the shared tier rather than a write per referencing service. Design the command that way.
GATING CORRECTION, same probe: a PROJECT-scoped Railway token does NOT authenticate with Authorization: Bearer. Both reads returned status 200 with GraphQL errors "Not Authorized" under Bearer and succeeded immediately under the header Project-Access-Token. railway-api.ts ships the Bearer form, so deploy:var-delete has never been able to work with the project-scoped token TASK-62 told the owner to mint. Being fixed in the TASK-62 follow-up PR, which is where that file is already open.
Redeploy behaviour on a shared-variable write was NOT observed in this probe - do not assume it from the docs line in var-delete.ts.
REDEPLOY QUESTION, partially answered by observation - read scope before relying on it. The shared-variable upsert and delete above ran at roughly 02:03:40-02:03:50Z. Querying the dev deployment history afterwards (GraphQL deployments(input: {projectId, environmentId}), 25 newest) shows NO deployment record created between 01:40:33Z and 02:05:04Z, and the 02:05:04Z batch is the develop push 4ffcb7e5c (pushed 02:04:54Z, ten seconds earlier), not the variable change. So no deployment appeared in the ~74-second window between the write and the next push.
That is evidence against automatic redeploy on a shared-variable change, NOT a demonstration of the mechanism: the window is short, the delete followed the upsert within seconds so a debounce could have collapsed the pair, and every deployment in the listing shows status SKIPPED (Railway watch-path filtering), so a variable-triggered deployment might not be distinguishable from a path-skipped one anyway.
Design consequence either way: secrets:rotate-env must trigger its redeploys EXPLICITLY rather than relying on Railway to notice the write. If Railway does also auto-redeploy, the cost is a redundant restart; if it does not, relying on it would leave the rotation silently ineffective until something else redeployed. Do not let the docs-sourced comment in var-delete.ts (hedged as not probed) become the premise.
<!-- SECTION:DESCRIPTION:END -->
