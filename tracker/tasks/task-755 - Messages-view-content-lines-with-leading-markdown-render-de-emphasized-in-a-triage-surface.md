---
id: TASK-755
title: >-
  Messages view: content lines with leading markdown render de-emphasized in a
  triage surface
status: To Do
assignee: []
created_date: '2026-08-23 21:49'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 755000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: review observation on the subtext-banner change - a message-content line that itself starts with -# (or # / > / -) renders as Discord-styled markdown in the /inspect Messages view, so injected content can appear visually de-emphasized in the exact surface meant for prompt-injection triage. Pre-existing class (all line-leading markdown), slightly sharper now that banners deliberately use -# subtext.
Tension: the view pins message content BYTE-IDENTICAL (test-enforced), so escaping leading markdown would break that contract - the fix needs a design decision (escape in this debug view and drop/adjust the byte pin, or accept and document the skim hazard; the Full JSON view already provides byte-exact truth).
Acceptance: decision recorded; if escaping, the byte-identity test is adjusted deliberately; if accepting, the view docstring names the hazard and points at Full JSON.
<!-- SECTION:DESCRIPTION:END -->
