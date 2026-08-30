---
id: TASK-829
title: >-
  pnpm test OOMs ai-worker on Steam Deck: LOW_RESOURCE_MODE does not reach turbo
  concurrency
status: To Do
assignee: []
created_date: '2026-08-30 03:01'
updated_date: '2026-08-30 16:01'
labels:
  - 'area:tooling'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 829000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: observed 4 times in one session (2026-08-29). Bare `pnpm test` fails with `Failed: @tzurot/ai-worker#test` while `pnpm --filter ai-worker test` passes 232 files / 5430 tests immediately after. It failed even on changes that CANNOT affect ai-worker: a test-only edit in common-types, and a comment-only edit in constants/ai.ts. Every time, a plain retry went 26/26 green, so it is resource contention, not a real failure.

Mechanism, verified: LOW_RESOURCE_MODE=1 is read ONLY by vitest.config.ts:20 (maxWorkers 1 instead of 3), which throttles workers WITHIN a single package run. It does not touch turbos cross-package concurrency, so `pnpm test` still starts several package vitest instances at once and the Steam Deck OOM-kills one. The proof is that .husky/pre-push:110 already sets TURBO_ARGS --concurrency=1 and the pre-push gate passed on every one of those same four pushes.

CORRECTION (2026-08-30, re-grounded before build): the paragraph above understates the failure. LOW_RESOURCE_MODE lives ONLY in `.env` (`grep -E '^LOW_RESOURCE_MODE=' .env` → present; `echo "[$LOW_RESOURCE_MODE]"` in an interactive shell → empty), and NOTHING in the `pnpm test` path sources `.env`: vitest.config.ts loads no dotenv, and turbo does not inject it into the process env. Only .husky/pre-push:103-104 sources it, which is why the pre-push gate is the one path that works. So bare `pnpm test` runs with BOTH throttles off — unlimited turbo cross-package concurrency AND maxWorkers 3, not 1. A turbo-concurrency-only fix leaves 3 vitest threads per package in place.

Fix shape (revised): turbo 2.10.11 reads `TURBO_CONCURRENCY` from the environment natively — probed by falsification, `TURBO_CONCURRENCY=bogus npx turbo run test --dry=text` fails with "Invalid value for `--concurrency` flag", so no flag plumbing into the root script is needed. The real gap is ENV DELIVERY, not flag wiring: whatever fix lands must get both `LOW_RESOURCE_MODE=1` and a turbo concurrency cap into the environment of a bare `pnpm test`. Candidate shapes, undecided: (a) both vars exported from the shell profile and `.env` demoted to documentation, (b) the root `test` script sources `.env` the way pre-push does, (c) a `packages/tooling` command that owns low-resource detection (overlaps TASK-374, which proposes measuring machine capability at runtime and making LOW_RESOURCE_MODE an override). Note package.json:20 has a `test:low-mem` script that sets --workspace-concurrency=1, but it drives pnpm filters rather than turbo, so it is a different path and does not fix `pnpm test`.

Scope note: with the correction above this is no longer a one-line change, and (c) overlaps TASK-374 enough that the two should be decided together rather than fixed twice. Re-sized S -> M.

Why it matters: a false red on the standing pre-commit gate trains people to retry rather than read, which is exactly how a real failure gets waved through. It also costs a couple of minutes per verification cycle.

Acceptance: `pnpm test` completes green in one pass on this machine with LOW_RESOURCE_MODE=1 set, without a retry, on a change touching a service package; and the mechanism note above lands wherever the low-resource contract is documented so the vitest-vs-turbo distinction is not rediscovered.
<!-- SECTION:DESCRIPTION:END -->
