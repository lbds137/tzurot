---
id: TASK-494
title: 'Stop hooks: filter sidechain entries from transcript scans'
status: To Do
assignee: []
created_date: '2026-08-09 18:33'
labels:
  - 'area:process'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 494000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2031 review — neither promise-ledger-check.sh nor blocking-question-channel-check.sh filters sidechain/subagent entries when scanning the transcript, so a spawned agent could in principle pollute the turn-boundary, formal-channel, or final-text reads. Inherited pattern, now in two files; fail-open direction bounds the damage to a spurious block-once or a missed reminder.
Fix shape: in both hooks python blocks, skip records where isSidechain is truthy (verify the actual field name against a live transcript first — producer is authoritative); add a probe case per hook with a sidechain entry carrying a closing question / promise.
Acceptance: both probes green with new sidechain cases; both hooks ignore sidechain records.
<!-- SECTION:DESCRIPTION:END -->
