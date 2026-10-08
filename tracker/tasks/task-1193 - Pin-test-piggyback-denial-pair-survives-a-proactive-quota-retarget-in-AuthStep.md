---
id: TASK-1193
title: >-
  Pin-test: piggyback denial pair survives a proactive quota retarget in
  AuthStep
status: To Do
assignee: []
created_date: '2026-10-08 18:10'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
type: task
ordinal: 1183000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
why: PR 2583 round-4 review — the proactive quota-retarget branch in resolveLlmAuthWithQuotaCheck spreads ...llmAuth first, so the piggyback denial pair survives a post-denial retarget; two fresh-context review reads verified the spread order, no test pins it.
what: one unit test driving applyProactiveQuotaFallback over a resolved auth carrying piggybackSkipped/piggybackModel, asserting both fields arrive in the retargeted result (file lives beside the branch it pins).
acceptance: mutating the spread order to drop the pair turns the test red.
<!-- SECTION:DESCRIPTION:END -->
