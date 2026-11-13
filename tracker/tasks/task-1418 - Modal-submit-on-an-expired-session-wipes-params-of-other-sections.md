---
id: TASK-1418
title: 'Modal submit on an expired session wipes params of other sections'
status: To Do
assignee: []
created_date: '2026-11-13T04:15:00Z'
labels:
  - area:bot-client
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1418000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
PR 2746 round-5 review Medium (claude-review): a modal submit on an EXPIRED session (sessionManager.get returns null — dashboard.ts only logs a warning at the null check and proceeds) merges onto {} and the presence gate sends advancedParameters built from just the submitted section; the gateway wholesale replace (LlmConfigService.ts:362-363) then erases every other section's params plus the non-form keys (e.g. penalties, thinking, verbosity). VERIFIED PRE-EXISTING at merge by the driver diff-read: the old code made the identical PUT (round 5 changed only the unflattenPresetData call's second argument; session?.data → undefined reproduces the old single-arg behavior exactly, and the reviewer writes "this isn't new"). Merged with her word ("Merge now, fix filed") on the release window. Fix (reviewer option (a)): on a null session, omit advancedParameters from the payload entirely — a param edit is then lost, but nothing else is destroyed. (Reviewer's stronger option (b): refetch the preset as the baseline — precedent handleSelectMenu's missing-session refetch.) REQUIRED test: null-session handleModalSubmit (mockSessionManagerGet.mockResolvedValue(null), sampling-section submit) asserting penalties + thinking survive or advancedParameters is omitted.
Acceptance: a sampling-section modal submit with a null session sends NO advancedParameters key (or merges onto a refetched baseline), pinned by a test.
<!-- SECTION:DESCRIPTION:END -->
