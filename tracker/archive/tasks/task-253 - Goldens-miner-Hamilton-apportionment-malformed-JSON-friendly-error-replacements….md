---
id: TASK-253
title: 'Goldens miner: Hamilton apportionment + malformed-JSON friendly error'
status: To Do
assignee: []
created_date: '2026-07-12 00:00'
updated_date: '2026-09-04 19:36'
labels:
  - 'origin:review'
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 253000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Goldens miner: Hamilton apportionment + malformed-JSON friendly error + `replacements` naming — Three #1608 final-round non-blocking items, one surface: (a) `stratifySample`'s global `slice(0, sampleSize)` trims from the LAST-processed personality — for an extreme imbalance (reviewer's valid 899:2 hand-trace) the small personality's intended 1-row quota is silently zeroed. UNREACHABLE with the current corpus (Lila 6,210:3,543 mined exactly 510+290=800, zero truncation — verified). Fix shape: largest-remainder (Hamilton) apportionment so quotas sum to sampleSize with no truncation step. (b) a hand-edited `swap-map.json` with broken JSON throws a raw SyntaxError — give it the same friendly-error treatment as the missing-file cases. (c) `replacements` counts rows-affected-per-entity, not occurrences — rename for clarity. **Promote when**: any re-mine targets a different persona/personality set (the imbalance becomes possible), or the next miner touch. Surfaced 2026-07-12 (#1608 final review).

**Why:** Corpus-integrity guard for future mines; current corpus verified unaffected.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:36
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. `stratifySample`'s global `slice(0, sampleSize)` truncation is still present and still unreachable with the current corpus (as the task itself already verified) — a real risk for the next re-mine with a different imbalance, correctly filed as a guard rather than fixed pre-emptively. Evidence: `git grep -n "stratifySample" packages/tooling/src` → lives in `mine-goldens.ts`; `grep -n "slice(0, sampleSize)" packages/tooling/src/memory/mine-goldens.ts` → line 86, unchanged.
---
<!-- COMMENTS:END -->
