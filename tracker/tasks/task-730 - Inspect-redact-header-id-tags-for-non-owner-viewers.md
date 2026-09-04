---
id: TASK-730
title: 'Inspect: redact header id tags for non-owner viewers'
status: To Do
assignee: []
created_date: '2026-08-22 13:47'
updated_date: '2026-09-04 19:40'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
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

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:38
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. Owner decided to adopt (2026-09-02) but it's not yet built. Evidence: `grep -rn "mask.*id:\|redact.*header" services/bot-client/src/commands/inspect --include=*.ts | grep -v test` → no masking logic for `(id:xxxx)` shapes found; only the existing system-prompt / memory-preview redactions exist.
---

author: digest-pass
created: 2026-09-04 19:40
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): OWNER-DECIDED, UNBUILT (Shape 14). Carries a recorded owner decision; only implementation remains. Promoted to priority medium so it runs in one of the two decided-work drain batches rather than waiting on an opportunistic trigger that has not fired.
---
<!-- COMMENTS:END -->
