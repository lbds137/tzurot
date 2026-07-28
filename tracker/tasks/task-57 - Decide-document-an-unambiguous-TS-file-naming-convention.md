---
id: TASK-57
title: Decide + document an unambiguous TS file-naming convention
status: To Do
assignee: []
created_date: '2026-06-18 00:00'
updated_date: '2026-07-28 10:47'
labels:
  - 'area:common-types'
  - 'area:process'
  - 'size:S'
dependencies: []
priority: low
ordinal: 57000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Decide + document an unambiguous TS file-naming convention

**Why:** `packages/common-types/src/types/` mixes kebab-case (`gateway-context.ts`, `discord-types.ts`, `shapes-import.ts`, `api-types.ts`, `audio-provider.ts` — dominant 5:1) with camelCase (`sttProvider.ts`, `jobs.ts`, `incognito.ts`). The ambiguity caused a per-PR debate on #1260 (`summonAnonymity.ts` → `summon-anonymity.ts`). Pick one convention (kebab is dominant), document it in `02-code-standards.md`, and ideally add a `structure.test.ts`-style lint so new files conform automatically. Low priority. **Promote when**: opportunistically, or the next filename-convention review-nit. Surfaced by PR #1260. Surfaced 2026-06-18 (dated from git history).
<!-- SECTION:DESCRIPTION:END -->
