---
id: TASK-976
title: >-
  Dual-secret acceptance for INTERNAL_SERVICE_SECRET: api-gateway accepts
  current or previous so rotation has no 401 window
status: To Do
assignee: []
created_date: '2026-09-14 12:15'
labels:
  - 'area:api-gateway'
  - 'size:M'
  - 'state:dependent'
dependencies: []
priority: high
ordinal: 972000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: OWNER RULING 2026-09-14 — dual-secret acceptance is the way, and it ships in beta.225 alongside TASK-963. Today `isValidServiceSecret` does ONE constant-time compare against `config.INTERNAL_SERVICE_SECRET`, loaded at startup (services/api-gateway/src/services/AuthMiddleware.ts, the function under the "Verify service secret matches configured secret" doc comment). bot-client and ai-worker PRESENT the secret; api-gateway VERIFIES it. With a single shared value no redeploy ordering removes the mismatch window: whichever side restarts first, the other holds the stale value and gets a 401. TASK-963 ships the rotation command with that window DOCUMENTED; this task removes the window instead.

This is not novel design. It mirrors the BYOK dual-key window already shipped in packages/common-types/src/utils/encryption.ts and driven by the staged `secrets:rotate-byok` command, so the pattern, the staging vocabulary and the operator model all already exist in this codebase.

Fix shape, four parts:

1. packages/common-types/src/config/config.ts — add `INTERNAL_SERVICE_SECRET_PREVIOUS: optionalNonEmptyString()` beside `INTERNAL_SERVICE_SECRET` (line 68 at filing) and the matching `undefined` default (line 410 at filing). Verify both line numbers before editing; cites drift.

2. services/api-gateway/src/services/AuthMiddleware.ts — `isValidServiceSecret` accepts EITHER value. Compare against both in constant time and OR the results. Do NOT short-circuit on the first match: an early return distinguishes by timing which of the two values matched, which is the exact class the existing constant-time compare was written to avoid. An unset or empty `_PREVIOUS` must never match anything, including an empty presented secret.

3. packages/tooling/src/secrets/rotate-env-secret.ts — stage the rotation, now that the gateway accepts both. Stage 1 writes `_PREVIOUS` = the current value and the primary name = a fresh value, then redeploys api-gateway FIRST (it then accepts old and new) and the presenters after. Stage 2 clears `_PREVIOUS` and redeploys api-gateway. Between the stages there is no window at all: a presenter still on the old value is accepted, a presenter on the new value is accepted. This replaces the single-shot path TASK-963 ships, and the `--stage` vocabulary should match `secrets:rotate-byok` (1|stage, 2|finalize) rather than inventing a second spelling.

4. The VERIFIER is the only service that needs `_PREVIOUS`. bot-client and ai-worker only present the secret, so whether `_PREVIOUS` lives at the shared tier or scoped to api-gateway is an implementer call; shared is simpler and matches where the primary already lives (probed 2026-09-14: the primary is shared, inherited by exactly api-gateway, bot-client and ai-worker).

Acceptance: a dev rotation across both stages produces ZERO 401s in the gateway request log for its duration; `isValidServiceSecret` has tests for current-matches, previous-matches, neither-matches, and previous-unset; the staged flow is documented in the Secret Rotation section of .claude/rules/05-tooling.md, REPLACING the mismatch-window sentence TASK-963 puts there, and the same sweep updates the matching line in docs/reference/tooling/OPS_CLI_REFERENCE.md and the module doc comment in rotate-env-secret.ts, all three of which assert the window as a standing property.

Sequencing: TASK-963 FIRST — it is the substrate, since the upsert, redeploy, service-derivation and ledger plumbing are needed either way — then this. The first prod INTERNAL_SERVICE_SECRET rotation waits for BOTH, so it runs windowless. That supersedes the beta.225 plan line saying the rotation runs as soon as TASK-963 ships.
<!-- SECTION:DESCRIPTION:END -->
