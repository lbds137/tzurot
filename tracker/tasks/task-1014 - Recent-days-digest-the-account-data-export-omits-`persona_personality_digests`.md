---
id: TASK-1014
title: >-
  Recent-days digest: the account data export omits
  `persona_personality_digests`
status: Done
assignee: []
created_date: '2026-09-18 13:20'
updated_date: '2026-09-18 17:03'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 1010000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the account export gathers every user-derived table (`services/ai-worker/src/jobs/AccountExportAssembler.ts` reads conversationHistory, memory, memoryFact, userPersonaHistoryConfig, ...) but nothing in the ai-worker export path mentions the digest (`grep -il digest services/ai-worker/src/jobs/*Export*.ts` = 0 files, beta.226 cut). The digest is derived text about the user and the privacy policy lists it in the retention table, so the export is incomplete on a data-rights axis.
Fix shape: add the persona digests (`digest_text`, `generated_at`, `window_start`, the personality slug) to the export payload and its Markdown render, keyed under the persona; extend the assembler test with a digest row and assert it reaches export.json.
Acceptance: an account with one done digest exports it; an account with none exports an empty list.
<!-- SECTION:DESCRIPTION:END -->
