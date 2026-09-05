---
id: TASK-900
title: >-
  Measure voice_anchor per-turn size across the catalog; cap or subset if the
  tail is heavy
status: To Do
assignee: []
created_date: '2026-09-05 18:59'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 898000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the voice_anchor V-tier section (doc-97 Phase 1, PR #2348) restates personalityTraits, personalityTone, and conversationalExamples uncached on EVERY turn. Worst case measured at 5,574 chars (~1.4k tokens) assuming the 4,000-char modal cap on examples is the only writer; the runtime LoadedPersonality type carries no .max() (packages/common-types/src/types/schemas/personality.ts, the three z.string().optional() fields), so any write path that bypasses the modal cap (admin API, import, migration) inflates the per-turn cost silently. Surfaced by the PR 2348 round-1 review as informational.
Fix shape: (1) measure the rendered anchor size across the prod catalog (read-only, aggregates only) and report the distribution; (2) if the tail is heavy, choose between a runtime cap on the three fields (a .max() mirroring the API cap, plus a truncating formatter) and a subset heuristic (traits + tone always, examples only when short); (3) record the chosen number in doc-97. Trigger the reviewer named: a new write path for these fields that does not go through the modal cap.
Acceptance: the distribution is in doc-97 and either a cap ships or the decision not to is recorded with the numbers.
<!-- SECTION:DESCRIPTION:END -->
