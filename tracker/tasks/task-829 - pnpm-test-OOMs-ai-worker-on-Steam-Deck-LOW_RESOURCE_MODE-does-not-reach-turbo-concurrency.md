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

## Merged from TASK-1168 (2026-10-12)

TASK-1168 (priority medium): `pnpm quality` fans out turbo lint unthrottled under LOW_RESOURCE_MODE. On 2026-10-04 a main-loop `pnpm quality` run (LOW_RESOURCE_MODE=1, heap capped) ran turbo lint at default concurrency: 5 eslint processes, ~4.3 GB, machine load 34-38 with 9 sessions open (relayed by Deck management). The quality script starts with `pnpm lint` = `turbo run lint` with no concurrency cap; 05-tooling.md asks for a `--concurrency=1` warm-up first, but that depends on memory and it was skipped. This is the same env-delivery gap as above for the lint leg: make the quality chain (and `pnpm lint`) honour LOW_RESOURCE_MODE, e.g. a lint:low-mem script used by quality when LOW_RESOURCE_MODE is set, or a turbo concurrency cap (TURBO_CONCURRENCY) read from the env; keep the 05-tooling warm-up advice consistent with whatever ships. Acceptance addition: `LOW_RESOURCE_MODE=1 pnpm quality` runs at most one eslint process at a time (observed with ps during the run); `guard:gate-parity` still passes.

## Merged from TASK-374 (2026-10-12)

TASK-374 (priority low, owner-requested side project; do not let it preempt product work) is candidate shape (c) above and is the long-form version: "instead of hard coding in the repo instructions to manage low resource mode for my Steam Deck, we should have tooling that determines system load and inherent capabilities." Why: the constraint lives as prose in 05-tooling.md plus a manual LOW_RESOURCE_MODE=1 flag; prose is advisory, wrong on any machine that is not the Deck (portability tax), and cannot react to actual state (fine on an idle box, an OOM kill with a browser and the IDE open). What: a small ops helper that reads inherent capability (core count, total RAM) and current load (available RAM, load average) and derives the knobs heavy commands need (vitest maxWorkers/pool, whether a chained run must serialize, whether to refuse a known-OOM command), consumed by the test/quality scripts. Acceptance: heavy commands pick their own concurrency from measured capability; LOW_RESOURCE_MODE becomes an override rather than the mechanism; the Steam-Deck-specific prose in 05-tooling.md shrinks to a pointer at the tool. Digest pass 2026-09-04 confirmed LOW_RESOURCE_MODE is still the sole hand-set mechanism and that 829 and 374 are the same seam, decide together. SEYAG CANDIDATE: capability/load detection for heavy commands is not Tzurot-specific (Deck-wide); consider building it as a Seyag tool (configurable, no Deck names or paths in the public plugin) with Tzurot only consuming it.

## Merged from TASK-1066 (2026-10-12)

TASK-1066 (priority medium): only the heap-cap mismatch remains; its protocol half is already in 05-tooling.md § Resource Constraints. Verified 2026-10-12 with git grep: `.husky/pre-push:152` and `:162` and `package.json:20` (`test:low-mem`) use `--max-old-space-size=2048`, while `.claude/rules/05-tooling.md:38` documents `NODE_OPTIONS=--max-old-space-size=3072` as mandatory for `pnpm quality` (knip is the OOM site). Fix: pick one heap cap and use it in pre-push, `test:low-mem` and the documented quality command, and say plainly which knobs LOW_RESOURCE_MODE turns (read by `.husky/pre-push` and root vitest.config.ts: maxWorkers 1 vs 3). Acceptance: one heap-cap value across pre-push, test:low-mem and the documented quality command. Found by a sibling env-cleanup session 2026-09-23.

Caveat (independent verifier, 2026-10-12): the two values apply to different commands (3072 is the documented `pnpm quality` cap; 2048 is the pre-push and test cap), so the split may be deliberate rather than a mismatch. MERGED 2026-10-12 from TASK-1103 (owner-approved Batch C): a Deck-only PreToolUse hook that blocks an unthrottled `pnpm quality` (no LOW_RESOURCE_MODE=1 and NODE_OPTIONS=--max-old-space-size=3072 in assignment position) and prints the warm-lint recipe. Harm seen 2026-09-25: unthrottled quality forked four eslint processes at 1.6-2.1 GB each and got shells reaped. Making `pnpm quality` honour LOW_RESOURCE_MODE itself (this task) would make that hook redundant, so build the hook only if this task stalls.

First step: decide whether one value should govern both or document why they differ; "one value" is the acceptance only if the split turns out accidental.
<!-- SECTION:DESCRIPTION:END -->
