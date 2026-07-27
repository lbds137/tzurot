---
id: TASK-258
title: 'Take the TypeScript 7 major deliberately + remove the dependabot ignore'
status: To Do
assignee: []
created_date: '2026-07-13 00:00'
labels:
  - 'area:ci'
dependencies: []
ordinal: 258000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Take the TypeScript 7 major deliberately + remove the dependabot ignore — Dependabot's dev-deps group bundled TypeScript 6.0.3→7.0.2, and `@typescript-eslint/typescript-estree` (8.63.0) crashes at parse time under TS 7 (`Cannot read properties of undefined (reading 'Cjs')`) — every group PR carrying the major goes permanently red (#1622). #1625 parks TS majors in `dependabot.yml` `ignore` (same shape as the jscpd-major entry). **Fix shape**: when typescript-eslint ships TS 7 support, bump `typescript` deliberately across the workspace, verify `pnpm quality` (parser + rules), and delete the ignore entry. **Promote when**: typescript-eslint's supported-range includes TS 7 (check their releases page). Surfaced 2026-07-13 (#1622 diagnosis).

**Why:** Majors get taken on purpose, not by a weekly group PR.
<!-- SECTION:DESCRIPTION:END -->
