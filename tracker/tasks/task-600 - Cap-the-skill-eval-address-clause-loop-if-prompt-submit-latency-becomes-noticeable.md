---
id: TASK-600
title: >-
  Cap the skill-eval address clause loop if prompt-submit latency becomes
  noticeable
status: To Do
assignee: []
created_date: '2026-08-14 02:52'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 600000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: skill-eval.sh runs synchronously on every UserPromptSubmit. Its address branch forks two greps PER CLAUSE with no cap on clause count. Measured on this machine: ~97ms typical for the whole hook, ~213ms worst case at 20 clauses. The cost is roughly linear in clause count, so a large paste that both contains the word address (common - IP address, email address, a variable named address) and is comma/period/semicolon-heavy (a pasted log or code block) could scale well past that in one submission.

A whole-prompt grep for address already gates entry to the loop, so prompts without the word pay nothing. This is specifically about long address-containing pastes.

Fix shape: bound the loop - break after N clauses (40 is roughly 2x the measured worst case and well past any real sentence count) and note in the comment that the tail is unexamined past the cap. A miss there costs one absent suggestion, which is the same cost model the branch already documents for its five accepted gaps, so truncating is consistent rather than a new compromise.

Promote when: prompt submission feels laggy on a long paste, or someone times the hook and it exceeds ~500ms. Filed rather than fixed because the reviewer framed it as conditional and PR 2093 was already at round 8 of a ~6-round cap; the branch has been rewritten five times and each pass is where a defect entered.

Acceptance: the loop has an upper bound; the cap and its consequence are stated in the comment; the probe still passes.

Note: assistant-generated from review, counts against the session net.
<!-- SECTION:DESCRIPTION:END -->
