---
id: TASK-27
title: 'Guard: outbound doc references from source comments'
status: To Do
assignee: []
created_date: '2026-07-03 00:00'
labels:
  - 'area:tooling'
dependencies: []
ordinal: 27000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-03 — Guard: outbound doc references from source comments. `guard:claude-content-refs` covers `.claude/` → `pnpm ops` refs and `guard:proposal-links` covers inbound proposal links, but nothing catches a source-code comment/error-string pointing at a deleted doc (PR #1469 review found 8 such refs to purged files). Candidate: extend claude-content-refs or the weekly orphan scan to verify doc paths cited in `packages/*/src` + `services/*/src` comments resolve.

**Why:** A deleted/moved doc silently 404s every code comment citing it; one was a runtime error-message string.
<!-- SECTION:DESCRIPTION:END -->
