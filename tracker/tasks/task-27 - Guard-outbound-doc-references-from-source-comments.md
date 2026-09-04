---
id: TASK-27
title: 'Guard: outbound doc references from source comments'
status: To Do
assignee: []
created_date: '2026-07-03 00:00'
updated_date: '2026-09-04 19:36'
labels:
  - 'area:tooling'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 27000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-03 — Guard: outbound doc references from source comments. `guard:claude-content-refs` covers `.claude/` → `pnpm ops` refs and `guard:proposal-links` covers inbound proposal links, but nothing catches a source-code comment/error-string pointing at a deleted doc (PR #1469 review found 8 such refs to purged files). Candidate: extend claude-content-refs or the weekly orphan scan to verify doc paths cited in `packages/*/src` + `services/*/src` comments resolve.

**Why:** A deleted/moved doc silently 404s every code comment citing it; one was a runtime error-message string.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:36
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. No guard exists yet that verifies doc paths cited in `packages/*/src`/`services/*/src` comments resolve; `guard:claude-content-refs` is scoped to `.claude/` only. Real cost: a deleted doc silently 404s a comment or runtime error string. Evidence: `find packages/tooling/src/dev -iname "*content-refs*"` → none exists outside `check-claude-content-refs.ts` (audits/, `.claude`-scoped); no source-comment doc-ref guard found.
---
<!-- COMMENTS:END -->
