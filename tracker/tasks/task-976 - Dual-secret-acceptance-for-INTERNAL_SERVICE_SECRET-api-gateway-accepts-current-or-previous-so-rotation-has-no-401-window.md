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

GROUNDING 2026-09-14 (read during the TASK-963 CI window; cites current as of develop bb6c36afa, re-verify before editing since cites drift):

- config.ts confirmed: `INTERNAL_SERVICE_SECRET: optionalNonEmptyString()` at line 68, and `INTERNAL_SERVICE_SECRET: undefined` in the defaults block at line 410. The new field goes beside each.
- `isValidServiceSecret` is 24 lines: a four-way guard (provided undefined or empty, configured undefined or empty) returning false, then an EARLY LENGTH-MISMATCH RETURN, then a hand-rolled XOR-accumulate loop. Two consequences:
  (a) The comparison is already only constant-time GIVEN EQUAL LENGTHS — the early `providedSecret.length !== configuredSecret.length` return leaks the configured secret LENGTH. Pre-existing, and a far weaker leak than the value, so it is not this task to fix; but do not describe the result as constant-time without that qualifier, in a comment or a PR body.
  (b) The natural shape is to EXTRACT the comparator (something like `constantTimeEquals(provided, configured)`) and call it TWICE, then OR the two booleans after both calls have run. Do NOT write `if (matches(current)) return true; if (matches(previous)) return true;` — that short-circuits and leaks by timing which of the two matched, the exact class the existing constant-time loop exists to avoid. One extraction, two call sites, no duplicated loop.
- The existing guard already returns false for an undefined or empty configured secret, so an UNSET `_PREVIOUS` falls out correctly with no extra branch. Still pin it with a test; it is a property, not an accident.
- Existing tests: `describe('isValidServiceSecret')` at AuthMiddleware.test.ts line 710, covering valid, wrong, undefined-provided, unset-configured, empty-string, case sensitivity, and equal-length-different-content. The new cases (previous-matches, previous-unset, neither-matches) EXTEND that block rather than starting a new one.
- BYOK precedent, and where to diverge from it: `getPreviousEncryptionKey` (packages/common-types/src/utils/encryption.ts line 69) reads `API_KEY_ENCRYPTION_KEY_PREVIOUS` from process.env DIRECTLY, returning null when absent, and the decrypt path tries current then previous (line 136). Mirror the STAGING model, not that read: route the new field through the config bag the way `INTERNAL_SERVICE_SECRET` itself is read, so it is validated and typed rather than a raw env lookup.
- Budget headroom (ESLint-counted, skipBlankLines plus skipComments): AuthMiddleware.ts 234/400, config.ts 239/400. Both comfortable; no extraction is forced by size.

STAGING CORRECTION 2026-09-14 — SUPERSEDES the two-stage sketch in Fix shape item 3 above. The sketch assumed one command invocation can order the restarts. It cannot: serviceInstanceRedeploy returns a bare boolean immediately and carries NO completion signal, so "redeploy api-gateway first, presenters after" inside a single run does not guarantee the gateway is live on the new config before a presenter restarts — and until it is, the gateway knows only the old value, so a presenter that restarted first is rejected. That is the window the task exists to remove. rotateByokKey already solves exactly this by making each stage a separate OPERATOR-GATED invocation. Use the same shape, THREE stages:

- Stage 1 (stage): write `_PREVIOUS` = the CURRENT value and the primary name = a fresh value, both with skipDeploys, then redeploy ONLY api-gateway. Presenters are deliberately NOT redeployed here; they keep sending the old value, which the restarted gateway accepts as `_PREVIOUS`. The operator waits for that deploy to land.
- Stage 2 (roll): redeploy the presenters — every inheriting service EXCEPT api-gateway. They pick up the new primary, and the gateway accepts both, so the order they land in does not matter. The operator waits.
- Stage 3 (finalize): clear `_PREVIOUS` and redeploy api-gateway. It then accepts only the new value, which every presenter is already sending.

Each stage ends by printing what to wait for and which stage runs next, the way rotateByokKey does.

DEPLOY ORDERING — the landmine this whole design creates, and it is worse than the window it replaces if got wrong. The staged rotation is safe against an environment ONLY once that environment's api-gateway is RUNNING code that accepts `_PREVIOUS`. Merging TASK-976 to develop is not that for prod: prod runs the previous release until the next cut deploys. Run stage 1 against a prod gateway that does not yet know `_PREVIOUS` and it writes the new primary, redeploys the gateway onto it, and every presenter still on the old value gets a 401 — the FULL window, not zero, and now spanning stage 1 to stage 2 rather than a single restart. So the command must refuse, or at minimum loudly warn, when it cannot confirm the target gateway accepts the previous variable. Cheapest check available to it: read the target environment's variables and require `INTERNAL_SERVICE_SECRET_PREVIOUS`-awareness to be demonstrable — and since a variable read cannot prove what CODE is deployed, prefer a hard gate the operator passes explicitly (a `--gateway-accepts-previous` acknowledgement flag, or a documented preflight in the runbook) over a silent assumption. Decide which in the build; do not let it default to silence.

OPERATIONAL SEQUENCE, end to end, recorded so no step is inferred later:
1. TASK-963 merges — the command exists in its single-shot form.
2. TASK-976 merges to develop — dev auto-deploys on that push, so the DEV gateway accepts both within minutes.
3. Run the staged rotation against DEV. That satisfies TASK-963's outstanding acceptance clause (a dev run with no value in stdout, the ledger, or the transcript) AND this task's own acceptance (zero 401s in the dev gateway request log across the stages).
4. beta.225 is cut and merged to main — prod deploys, and only now does the PROD gateway accept both.
5. Run the staged rotation against PROD. That run IS the `INTERNAL_SERVICE_SECRET` rotation the owner ruled on 2026-09-13, and it is the last step, not the first.

A VALUE READ IS NOW REQUIRED, and it is new for this module. Stage 1 must copy the CURRENT value into `_PREVIOUS`, so it has to READ a secret value — something rotate-env-secret.ts deliberately never does today (listRailwayVariableNames returns key names only). Add a narrowly scoped reader over the same `variables` query that selects one key, hand its result straight to the upsert, and never print it, never put it in an error message, and never return it to a caller that logs. Precedent: getServiceVariable in rotation.ts does exactly this for BYOK. Pin it the way the generated value is already pinned — a test asserting no console output and no thrown error contains it.

CLEARING `_PREVIOUS` in stage 3: prefer `deleteRailwayVariable` at the shared tier. It already exists and its round trip is live-observed; BYOK sets an empty string only because the Railway CLI cannot delete, and this module has the delete. Either outcome is safe at the config layer — `optionalNonEmptyString` is `z.string().min(1).optional().or(z.literal('').transform(() => undefined))` (config.ts lines 12-18, read 2026-09-14), so an empty string becomes `undefined`, and `isValidServiceSecret`'s existing empty/undefined guard rejects it. Try the delete first and record which one worked.
<!-- SECTION:DESCRIPTION:END -->
