---
id: TASK-951
title: >-
  Guard: .env.example key set must match .env (values blank), with a one-time
  drift sweep
status: Done
assignee: []
created_date: '2026-09-13 15:38'
updated_date: '2026-09-15 22:50'
labels:
  - 'area:tooling'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 948000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner request 2026-09-13 — the two files should be identical except that .env carries the values. Measured drift that day: 6 keys only in .env (DEFAULT_AI_MODEL, LOW_RESOURCE_MODE, OPENAI_API_KEY, REDIS_URL, TZUROT_RAILWAY_API_TOKEN_DEV, TZUROT_RAILWAY_API_TOKEN_PROD) and 16 only in .env.example (AI_WORKER_URL, API_KEY_ENCRYPTION_KEY, AUTO_TRANSCRIBE_VOICE, five CONTEXT_* flags, ENABLE_FREE_WILL, ENABLE_HEALTH_SERVER, INTERNAL_SERVICE_SECRET, QUEUE_NAME, REDIS_HOST, REDIS_PORT, WORKER_CONCURRENCY); 18 vs 28 keys total. Nothing checks this today (grep of packages/tooling/src, .husky, .claude/hooks for env.example: no hits).
Fix shape, two halves: (1) one-time sweep — for each key on either side, grep the services and packages for a reader (process.env.KEY or the config-resolver schema); drop keys nothing reads from .env.example, add readers-without-example rows with a comment and a blank value, and add the two Railway token rows; the sweep result (kept / dropped / added, with the reader cite) goes in the PR body. (2) the guard — a tooling command (packages/tooling/src/dev/, registered in commands/dev.ts, with a colocated test; read docs/reference/audit-enforcement.md first) that parses both files as KEY= lines and fails on any key-set difference, ignoring values and comments; wired into .husky/pre-push (the only hook that runs where .env exists — .env is gitignored so pre-commit never sees it change) and skipping cleanly with a notice when .env is absent (CI, fresh clones) so it never blocks there. Optional CI half: every key in .env.example has a reader in code, which IS checkable without .env.
Acceptance: pnpm ops guard:env-example exits 1 on a key present in exactly one file and 0 when the sets match; the pre-push hook runs it; .env.example and .env match on the owner machine after the sweep; the guard is registered per the audit-enforcement checklist.

RE-MEASURED 2026-09-14 (Opus, beta.225 lane, key NAMES only — no value was read or printed): the drift is UNCHANGED from the 2026-09-13 filing. 18 keys in .env, 28 in .env.example; the same 6 .env-only and 16 .env.example-only keys. So nothing has shifted under the task and its numbers still hold.

READER SWEEP, same run — `grep -rl --include=*.ts --include=*.py <KEY> services packages`, excluding `*.test.*`, paired with whether the key appears in the config.ts envSchema. This is the half the fix shape calls for, done once so the build does not repeat it.

.env.example-only keys WITH a reader (keep the row, add the key to .env): API_KEY_ENCRYPTION_KEY (10 files, in schema), AUTO_TRANSCRIBE_VOICE (6, in schema), CONTEXT_MODE (2, NOT in schema), CONTEXT_RAW_ENVELOPE (10, NOT in schema), ENABLE_HEALTH_SERVER (5, in schema), INTERNAL_SERVICE_SECRET (20, in schema), QUEUE_NAME (24, in schema), REDIS_HOST (4, in schema), REDIS_PORT (6, in schema), WORKER_CONCURRENCY (6, in schema).

.env.example-only keys with ZERO readers — DROP CANDIDATES, none of them safe to drop without a check: AI_WORKER_URL, CONTEXT_ASSEMBLY_PROMOTE, CONTEXT_DUAL_WRITE, CONTEXT_SHADOW_HYDRATION, CONTEXT_THIN_PAYLOAD, ENABLE_FREE_WILL. Four of the six are doc-97 context-envelope flags, and a zero-reader result there is ambiguous between "the flag was removed" and "the flag was renamed" — check the epic before dropping, and treat ENABLE_FREE_WILL as an owner call rather than an agent one, since dropping a feature-flag row is a product-visible signal.

.env-only keys (add a blank row to .env.example unless noted): REDIS_URL (22 readers, in schema), TZUROT_RAILWAY_API_TOKEN_DEV (2) and TZUROT_RAILWAY_API_TOKEN_PROD (1) — the rows the fix shape already calls for; DEFAULT_AI_MODEL (1 reader, NOT in schema); OPENAI_API_KEY (ZERO readers — likely dead, check before adding a row for it rather than enshrining it); LOW_RESOURCE_MODE (ZERO readers in src, and correctly so — it is a shell/turbo variable consumed by scripts, not by application code, so the guard should either exempt it or the row should be added with a comment saying it is not read by code).

NOTE the guard's own boundary, found while grounding TASK-976: `INTERNAL_SERVICE_SECRET_PREVIOUS` (and the BYOK precedent `API_KEY_ENCRYPTION_KEY_PREVIOUS`) are config-schema keys that are set only transiently by a staged rotation and are deliberately absent from .env.example — verified 2026-09-14, `grep -n API_KEY_ENCRYPTION_KEY .env.example` returns only the non-_PREVIOUS row. The guard compares .env to .env.example, not the schema to either, so these do not interact; but the optional CI half proposed in the fix shape ("every key in .env.example has a reader in code") must NOT be inverted into "every schema key has an .env.example row", which would wrongly demand rows for both rotation twins.

CORRECTED SWEEP 2026-09-15 (Opus grounding, key NAMES only). The 09-14 reader counts over-counted: a file-level grep counts comments as readers.
- CONTEXT_MODE and CONTEXT_RAW_ENVELOPE have NO reader. Every hit is a comment naming a flag deleted 2026-06-19 (5566e7e5c, 00c192e3a). All six CONTEXT_* rows drop, and the seven comment sites that still name those flags get rewritten.
- AUTO_TRANSCRIBE_VOICE is read only to log that it is deprecated and ignored (bot-client index.ts, grep `is deprecated and ignored`), yet packages/tooling/src/deployment/setup-railway-variables.ts still pushes it to Railway with default 'false'. The row drops and so does that tooling entry.
- DEFAULT_AI_MODEL is dead: it survives only as `seedSource` provenance, and systemSettingsRegistryTypes.ts says "The env vars themselves are deleted". OPENAI_API_KEY is dead since 61b0178fe. Both are in the owner .env, so removing them is an owner action.
- ENABLE_FREE_WILL and AI_WORKER_URL: no reader in any commit touching services/ or packages/. This REVERSES the 09-14 note calling ENABLE_FREE_WILL an owner call: a row nothing has ever read changes no behavior, and the idea is recorded in doc-86, not in this row.
- Every surviving key is optional or defaulted in config.ts, so no row is schema-required.

GUARD SEMANTICS (engineering call): compare UNCOMMENTED `KEY=` lines only. A commented `# KEY=` row documents an optional key. The example's active set then equals the .env key set, and optional keys stay documented without pushing empty-string values into a fresh .env (empty differs from unset for any schema field lacking a literal('') escape).

Resulting sweep: drop 9 active rows (AI_WORKER_URL, the six CONTEXT_*, AUTO_TRANSCRIBE_VOICE, ENABLE_FREE_WILL). Comment out 7 optional or defaulted rows absent from .env (API_KEY_ENCRYPTION_KEY, INTERNAL_SERVICE_SECRET, ENABLE_HEALTH_SERVER, QUEUE_NAME, REDIS_HOST, REDIS_PORT, WORKER_CONCURRENCY). Uncomment 4 rows present in .env with blank values (REDIS_URL, LOW_RESOURCE_MODE, TZUROT_RAILWAY_API_TOKEN_DEV, TZUROT_RAILWAY_API_TOKEN_PROD). Each of their readers treats empty as unset: config.ts `literal('')`, railway-api.ts `length === 0`, vitest.config.ts `=== '1'`, pre-push `[ -n ]`. The owner removes OPENAI_API_KEY and DEFAULT_AI_MODEL. Both sides then hold the same 16 keys.

The optional CI half (every example key has a code reader) is DECLINED on merit: this sweep is the counter-example. A grep-based reader check would have passed CONTEXT_MODE on the strength of a comment, the exact false signal it exists to catch, and real readers span TS schema, shell hooks and tooling literal maps.

PREMISE CORRECTION 2026-09-15 (PR #2435 review round 1, claude-review finding 1). The CORRECTED SWEEP above says "Every surviving key is optional or defaulted in config.ts". That is FALSE for INTERNAL_SERVICE_SECRET, and the error was reading the config schema alone. The schema declares it optionalNonEmptyString, but all three services throw at boot when it is missing or blank: services/ai-worker/src/startup.ts (validateRequiredEnvVars), services/api-gateway/src/bootstrap/startup.ts (validateServiceAuthConfig), services/bot-client/src/startup.ts (validateInternalServiceSecret). It shipped as an ACTIVE blank row, and the owner added a blank row to the local .env, so both files carry 17 keys rather than 16. A key's optionality is the BOOT VALIDATORS' answer, not the schema's.

The same round also removed REDIS_HOST, REDIS_PORT and REDIS_PASSWORD as dead config (no runtime reader; initCoreRedisServices connects only through REDIS_URL), so the row counts in the sweep above read: 11 active rows dropped, 4 commented out, 5 activated blank.
<!-- SECTION:DESCRIPTION:END -->
