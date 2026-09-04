---
id: TASK-136
title: 'Turbo cache-staleness window for @tzurot/test-utils typecheck:spec'
status: To Do
assignee: []
created_date: '2026-06-03 00:00'
updated_date: '2026-09-04 19:35'
labels:
  - 'area:common-types'
  - 'area:testing'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 136000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Turbo cache-staleness window for `@tzurot/test-utils` `typecheck:spec`

**Why:** `packages/test-utils/tsconfig.spec.json` resolves `@tzurot/common-types` via a tsconfig `paths` alias (mirroring the `vitest.component.config.ts` runtime alias) rather than a package dependency — deliberately, to avoid recreating the `common-types ↔ test-utils` Turbo build cycle. Consequence: the `typecheck:spec` turbo task's inputs (`src/**` + the two tsconfigs + `^build`) don't include `common-types` source, and there's no package-graph edge, so if common-types' types change while test-utils' own source is unchanged, Turbo could replay a stale `typecheck:spec` pass. This is the SAME accepted trade-off that already exists for the `seed.component.test.ts` runtime alias (`test:component`), not new debt. **Fix shape**: add a test-utils-specific `typecheck:spec` input override in `turbo.json` — `"../../packages/common-types/src/**"` — scoped to `@tzurot/test-utils#typecheck:spec` (NOT the global task, which would over-invalidate every package's spec typecheck on any common-types change; packages with a real edge already get invalidation via `^build`). Same fix would apply to `@tzurot/test-factories` if its spec typecheck ever gains a common-types `paths` alias. **Promote when**: a spurious `typecheck:spec` CI pass is observed (a real type error in `seed.component.test.ts` slips through because common-types changed but test-utils didn't), OR opportunistically alongside the next `turbo.json` input change. Surfaced 2026-06-03 by PR #1143 claude-review (non-blocking, explicitly framed as a known trade-off). Deferred 2026-06-03.
## PROMOTE-WHEN HAS EFFECTIVELY FIRED (2026-08-19)

This task's trigger reads "a spurious `typecheck:spec` CI pass is observed, OR
**opportunistically alongside the next `turbo.json` input change**." TASK-675
proposes persisting turbo's cache in CI — which is that input change, and more
than that, it is what would make this staleness window BITE.

Today the window is masked: CI persists no cache, so nothing is ever replayed
and a stale `typecheck:spec` result cannot be served. Persisting the cache
removes the mask. `typecheck:spec` is 34s of exactly what TASK-675 wants to
cache, so this is not adjacent to that work — it is a prerequisite of it.

**TASK-675 is blocked on this.** Do not enable a persistent cache with this
open.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:35
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. This task explicitly blocks another open, active task (TASK-675, "CI discards turbo cache every run; persisting it is blocked on TASK-136") — a named, currently-live dependency, not a stale trigger. CI still doesn't persist the Turbo cache, so the masking condition TASK-136 relies on for safety is unchanged, but the blocker relationship is real and current. Evidence: `pnpm tracker task view TASK-675 --plain` → title itself names the block on TASK-136, still To Do, `state:ready`; `git grep -n "actions/cache\|TURBO_TOKEN" .github/workflows/*.yml` → no match (cache still not persisted in CI).
---
<!-- COMMENTS:END -->
