---
id: TASK-951
title: >-
  Guard: .env.example key set must match .env (values blank), with a one-time
  drift sweep
status: To Do
assignee: []
created_date: '2026-09-13 15:38'
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
<!-- SECTION:DESCRIPTION:END -->
