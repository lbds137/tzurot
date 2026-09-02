---
id: TASK-730
title: 'Inspect: redact header id tags for non-owner viewers'
status: To Do
assignee: []
created_date: '2026-08-22 13:47'
updated_date: '2026-09-02 13:38'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 730000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: /inspect shows a user the exact shipped prompt for their own generations, which flag-on includes other participants header id tags (TASK-726 mechanism). The tiebreaker verdict in prompt-assembly-architecture.md 9d D2 recommends hardening as defense-in-depth while explicitly NOT treating it as a substitute for the body transform (obscurity must not be load-bearing). Redaction costs the owner exact-bytes debugging on user-reported payloads, so the trade is owner taste.
What: in the inspect render path for non-owner viewers, mask (id:xxxx) shapes in prompt text views. Owner views stay exact.
Acceptance: owner decision recorded; if adopted, non-owner inspect views show masked tags.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Owner decision 2026-09-02: adopt. Mask (id:xxxx) shapes in non-owner /inspect prompt views; owner views stay exact. Priority stays low.
<!-- SECTION:NOTES:END -->
