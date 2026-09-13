---
id: TASK-963
title: >-
  Rotate service secrets end-to-end from the CLI: generate locally, write to
  Railway, never print the value
status: To Do
assignee: []
created_date: '2026-09-13 17:39'
labels:
  - 'area:tooling'
  - 'size:M'
  - 'state:dependent'
dependencies: []
priority: medium
ordinal: 960000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner ask 2026-09-13 after TASK-957 (the request log leaks the internal service secret): once the redaction ships, INTERNAL_SERVICE_SECRET on dev and prod must rotate, and today that is a hand job through the Railway dashboard — the value passes through a human clipboard and, if an agent helps, through a session transcript. With the env-scoped Railway tokens now in the local .env (TASK-62 follow-up), the rotation could be one command: generate the new value locally, write it to every service that reads the variable, trigger the redeploys, and never echo the value.
Open question that gates the design (investigate FIRST, cheapest probe): can the Shared variable tier be read and written through the Railway CLI or the public GraphQL API, or only per-service variables? railway variables --set is per service (docs/reference/RAILWAY_CLI_REFERENCE.md); the GraphQL variableUpsert mutation may take an environment-level scope — probe it with the dev token on a throwaway variable name, do not guess from docs. If shared variables are unreachable, the fallback is writing the same value to each service that references it, which the command can do in one pass.
Fix shape: packages/tooling/src/secrets/rotate-env-secret.ts (colocated test; registered in commands/secrets.ts; read docs/reference/audit-enforcement.md first) — pnpm ops secrets:rotate-env --env dev|prod --name INTERNAL_SERVICE_SECRET [--dry-run]: generates a 32-byte hex value, writes it to the shared tier (or every referencing service), records the rotation in the secret_rotations ledger the same way secrets:rotate-byok does (packages/tooling/src/secrets/rotation.ts), redeploys the affected services in an order that keeps bot-client and api-gateway agreeing (or documents the brief mismatch window), and prints only the variable name, the services touched, and the ledger row — never the value. The prod run stays behind the same pre-image check and owner grant the other prod write commands use.
Dependencies: TASK-62 (the token plumbing and the GraphQL ops); TASK-957 must ship before the first real prod rotation, or the new value is logged too.
Owner note 2026-09-13: if the rotation can be automated it should also become a skill or tooling entry — the command is the tooling half; the other half is the decision-point trigger written into 05-tooling.md § Secret Rotation (and the deployment skill if a redeploy order is involved), so the next rotation reaches for the command instead of the dashboard.
Acceptance: a dry run lists the services and the tier it would write; a dev run rotates the variable with no value in stdout, the ledger, or the transcript; the shared-tier question is answered in the task body with the probe output.
<!-- SECTION:DESCRIPTION:END -->
