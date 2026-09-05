---
id: TASK-57
title: Decide + document an unambiguous TS file-naming convention
status: Done
assignee: []
created_date: '2026-06-18 00:00'
updated_date: '2026-09-05 07:18'
labels:
  - 'area:common-types'
  - 'area:process'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 57000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Decide + document an unambiguous TS file-naming convention

**Why:** `packages/common-types/src/types/` mixes kebab-case (`gateway-context.ts`, `discord-types.ts`, `shapes-import.ts`, `api-types.ts`, `audio-provider.ts` — dominant 5:1) with camelCase (`sttProvider.ts`, `jobs.ts`, `incognito.ts`). The ambiguity caused a per-PR debate on #1260 (`summonAnonymity.ts` → `summon-anonymity.ts`). Pick one convention (kebab is dominant), document it in `02-code-standards.md`, and ideally add a `structure.test.ts`-style lint so new files conform automatically. Low priority. **Promote when**: opportunistically, or the next filename-convention review-nit. Surfaced by PR #1260. Surfaced 2026-06-18 (dated from git history).

**DECIDED 2026-08-14 (owner, TASK-599 digest): kebab-case + a structure-test lint so new files self-enforce; NO renames of existing camelCase stragglers.**
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:37
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. The owner already DECIDED (kebab-case + a structure-test lint, no renames) per the note on the task itself, but the decision was never executed — `structure.test.ts` has no naming lint, and the standing naming doc still contradicts the decision by showing a kebab-case file as an example under "camelCase or descriptive." Evidence: `git grep -n "kebab" packages/common-types/src/structure.test.ts` → no match; `sed -n '255,310p' docs/reference/standards/FOLDER_STRUCTURE.md` → "Type Definitions / Format: camelCase or descriptive" with example `api-types.ts` (kebab), unreconciled with the DECIDED note.
---

author: digest-pass
created: 2026-09-04 19:40
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): OWNER-DECIDED, UNBUILT (Shape 14). Carries a recorded owner decision; only implementation remains. Promoted to priority medium so it runs in one of the two decided-work drain batches rather than waiting on an opportunistic trigger that has not fired.
---
<!-- COMMENTS:END -->
