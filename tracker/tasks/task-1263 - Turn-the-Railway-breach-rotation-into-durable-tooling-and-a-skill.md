---
id: TASK-1263
title: Turn the Railway breach rotation into durable tooling and a skill
status: To Do
assignee: []
created_date: '2026-10-22 17:40'
labels:
  - 'area:tooling'
  - 'size:L'
  - 'state:dependent'
dependencies: []
priority: medium
ordinal: 1251000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: Lila 2026-10-22: whatever the Railway breach rotation lands on as the best procedure should become a skill or similar, so the next rotation (scheduled 180/365-day ones included) is not re-derived under pressure. The dev rehearsal (TASK-1260) built it from one-off scripts in a job temp dir.

What, after the prod pass proves the final procedure:
1. Tzurot tooling (packages/tooling, per 05-tooling.md No Standalone Scripts): a `pnpm ops secrets:rotate-db-password --env <env> [--service pgvector|Redis]` command porting the rehearsal scripts: hold a session on the old password, upsert the variable with skipDeploys, start consumer rebuilds, ALTER only when a consumer reaches DEPLOYING, verify with a second session, auto-revert on failure; Redis via the two-password ACL path if the dev rehearsal proves it. Exercised end to end on dev before the prod path is offered (00-critical.md). Plus a prod project-token re-mint helper (CLI login → projectTokenCreate → .env, value never printed).
2. Tzurot skill: a Secret rotation section in /tzurot-deployment (or its own skill) with the whole-incident order: batch values into one rebuild round, staged INTERNAL_SERVICE_SECRET / BYOK, maintenance-mode option, cross-env literal copies, the BYOK user notice, the misuse checks.
3. Seyag (public, generic per memory feedback_seyag_asks_generic): hand Seyag the project-agnostic parts for its railway-ops skill: the rebuild-round cost, the DEPLOYING-timed ALTER for any Postgres image without a Regenerate button, the Redis dual-password, the names-only variable audit verb, and the token-invalidation recovery. Send via Deck.

Acceptance: the ops command shipped with tests and a dev run, the skill section merged, and the Seyag hand-off sent.

Promote when: the TASK-1260 prod pass is done.
<!-- SECTION:DESCRIPTION:END -->
