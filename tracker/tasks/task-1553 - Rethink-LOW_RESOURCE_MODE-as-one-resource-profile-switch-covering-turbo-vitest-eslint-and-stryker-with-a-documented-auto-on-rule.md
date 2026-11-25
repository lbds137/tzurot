---
id: TASK-1553
title: >-
  Rethink LOW_RESOURCE_MODE as one resource-profile switch covering turbo,
  vitest, eslint and stryker, with a documented auto-on rule
status: In Progress
assignee:
  - tzurot-a
created_date: '2026-11-25T19:18:00Z'
updated_date: '2026-11-25T20:42:00Z'
labels:
  - area:tooling
  - size:L
  - state:ready
dependencies: []
priority: high
ordinal: 1548000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: Lila asked (2026-11-25, via the Deck session) for LOW_RESOURCE_MODE to be rethought and refactored so it is more useful. Two drivers:

1. Fleet reuse: Deck Platform TASK-383 (fleet operating modes) wants a cloud variant of a low-resource mode, because cloud VMs have 4 cores (see TASK-1092, Done). The same modes should work on the Deck. The Tzurot flag is the existing model, so shape it so the fleet can reuse the idea.
2. Evidence: at 11:37 on 2026-11-25 Tzurot B ran 5 eslint processes in parallel at 1.0 to 1.4 GB each (about 6 GB). Free memory fell to 1.26 GB and the memory reaper killed another session job. So on the Deck either the mode was not on, or it does not cover that path. Step one is to find out which.

Current readers (git grep LOW_RESOURCE): .husky/pre-push, package.json, the stryker configs, .env.example, .claude/rules/05-tooling.md, the husky pre-push probe, and the root vitest.config.ts per 05-tooling. TASK-829 (turbo concurrency not reached by the flag, still To Do) is a member of this pass; TASK-1517 (worktrees read the flag only from the checkout-local .env) shipped.

What:
- One switch, one place that derives every knob from it: turbo --concurrency, vitest maxWorkers, eslint concurrency (turbo lint fan-out), and stryker concurrency.
- A documented auto-on rule (nproc, MemAvailable) so it does not depend on a remembered .env line, and an explicit off.
- A cloud profile next to the Deck profile.
- Diagnose the 11:37 path first: which command spawned the 5 eslint processes, and was the flag set?

Acceptance: with the switch on (or auto-on), a bare pnpm lint, pnpm test, pnpm quality and the pre-push hook each stay within the documented process and worker caps on the Deck; 05-tooling.md Resource Constraints names the switch and the auto rule; the derivation is reusable by the fleet (a documented contract, not Tzurot-only prose).

## Diagnosis (2026-11-25, tzurot-a)

The flag was SET; the path is not covered. Observed: B's transcript shows `export LOW_RESOURCE_MODE=1 NODE_OPTIONS=--max-old-space-size=3072` then quality piece 1 (`pnpm lint` = bare `turbo run lint`) launched at 16:35:49Z; the mem-pressure log shows avail 6050 MB (16:35Z) -> 2050 MB (16:37Z). The eslint process count and its tie to that command are inferred from timing. Also: the `tzurot-b` clone has no `.env` and the Deck has 8 cores, so neither the .env fallback nor the pre-push <=4-core auto-detect can fire there.

Second, larger finding (runtime-verified, turbo 2.11.13): turbo runs in STRICT env mode and drops `LOW_RESOURCE_MODE` before the task process. Probe: `LOW_RESOURCE_MODE=1 NODE_OPTIONS=--require <print-env preload>` through the native turbo binary on `@tzurot/identity#test` printed `LRM=[]` in the task's pnpm process (NODE_OPTIONS, the positive control, did arrive). So vitest.config.ts `maxWorkers: 1` has never engaged under any `turbo run test`, the pre-push included; the pre-push and vitest.config.ts comments claiming the export reaches vitest are false. The husky pre-push probe stubs pnpm, so it never crosses this seam. Flipping LOW_RESOURCE_MODE leaves the task hash unchanged (82d647e8d3c1e06f both ways), so pass-through env is cache-neutral. `TURBO_CONCURRENCY=bogus` still fails flag validation on 2.11.13, so turbo reads the env var natively.
<!-- SECTION:DESCRIPTION:END -->
