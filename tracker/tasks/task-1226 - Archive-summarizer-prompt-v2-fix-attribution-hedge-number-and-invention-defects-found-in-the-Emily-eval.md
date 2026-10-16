---
id: TASK-1226
title: >-
  Archive summarizer prompt v2: fix attribution, hedge, number and invention
  defects found in the Emily eval
status: Done
assignee: []
created_date: '2026-10-13 01:26'
updated_date: '2026-10-16 18:16'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 1215000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Summarizer prompt v2: fix the Emily-eval defect classes (ATTRIBUTION 18, HEDGE_LOST 15, OMISSION 31, DISTORTION 20, INVENTION; 4 serious), then rerun pass 3 on the same 400 summaries (target >=90% faithful, 0 serious).

Grounding 2026-10-16: prompt at services/ai-worker/src/services/archiveSummary/archiveSummaryPrompt.ts (SUMMARIZER_SYSTEM_PROMPT, 5 worked examples, 60-word cap). Defect-to-gap map: ATTRIBUTION - pronouns in the source echoed unresolved (3f8b6079 unnamed 'her'); rule needed: resolve every pronoun to the named party or drop the claim. HEDGE_LOST - conditionals dropped (the prompt's OWN example 4 drops 'if the weather held'); rule: conditionals/hedges/negations survive. OMISSION - strengthen: keep every number/dose/deadline/duration/named plan. INVENTION (893b74f0 invented voice-note report, 9f39745d knee pain) - needs a NOT-inventing worked example: vague source in, vague summary out. TENSE_STATE 3 (relative-time anchoring already in ex 1). Findings detail: docs/local/emily-eval/summary-findings/s-1..s-5.md (unread). Version bump = ARCHIVE_SUMMARY_PROMPT_VERSION (@tzurot/common-types/constants/memoryArchive); the bump re-admits dead+done rows (MEM-ARCH-022) and gates TASK-1227 part 3's backfill sweep (run memory:summarize AFTER the bump - pre-bump = double spend). Acceptance rerun = the eval pass-3 harness on the same 400 (z.ai GLM summarizer + judge; personal data -> local files only).
<!-- SECTION:DESCRIPTION:END -->
