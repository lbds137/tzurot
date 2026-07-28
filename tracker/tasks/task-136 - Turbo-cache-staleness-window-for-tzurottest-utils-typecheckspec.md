---
id: TASK-136
title: 'Turbo cache-staleness window for @tzurot/test-utils typecheck:spec'
status: To Do
assignee: []
created_date: '2026-06-03 00:00'
updated_date: '2026-07-28 10:48'
labels:
  - 'area:common-types'
  - 'area:testing'
  - 'size:S'
dependencies: []
priority: low
ordinal: 136000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Turbo cache-staleness window for `@tzurot/test-utils` `typecheck:spec`

**Why:** `packages/test-utils/tsconfig.spec.json` resolves `@tzurot/common-types` via a tsconfig `paths` alias (mirroring the `vitest.component.config.ts` runtime alias) rather than a package dependency — deliberately, to avoid recreating the `common-types ↔ test-utils` Turbo build cycle. Consequence: the `typecheck:spec` turbo task's inputs (`src/**` + the two tsconfigs + `^build`) don't include `common-types` source, and there's no package-graph edge, so if common-types' types change while test-utils' own source is unchanged, Turbo could replay a stale `typecheck:spec` pass. This is the SAME accepted trade-off that already exists for the `seed.component.test.ts` runtime alias (`test:component`), not new debt. **Fix shape**: add a test-utils-specific `typecheck:spec` input override in `turbo.json` — `"../../packages/common-types/src/**"` — scoped to `@tzurot/test-utils#typecheck:spec` (NOT the global task, which would over-invalidate every package's spec typecheck on any common-types change; packages with a real edge already get invalidation via `^build`). Same fix would apply to `@tzurot/test-factories` if its spec typecheck ever gains a common-types `paths` alias. **Promote when**: a spurious `typecheck:spec` CI pass is observed (a real type error in `seed.component.test.ts` slips through because common-types changed but test-utils didn't), OR opportunistically alongside the next `turbo.json` input change. Surfaced 2026-06-03 by PR #1143 claude-review (non-blocking, explicitly framed as a known trade-off). Deferred 2026-06-03.
<!-- SECTION:DESCRIPTION:END -->
