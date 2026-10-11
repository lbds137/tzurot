---
id: TASK-1208
title: turn-end-shape-gate fires on turns that did end on text
status: Done
assignee: []
created_date: '2026-10-11 13:06'
updated_date: '2026-10-11 19:28'
labels:
  - 'area:hooks'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1197000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: in one session on 2026-10-11 the Stop hook turn-end-shape-gate.sh blocked four turn ends as "ends on a tool call" (PushNotification, Bash, Bash, SendMessage) where the assistant had written a closing text block after that tool call. Each false block costs a forced extra turn and trains the agent to ignore the gate. Hypothesis, unverified: the hook reads the transcript JSONL before the final text block is flushed, or classifies the last ENTRY rather than the last content block of the last assistant message.

What: reproduce with the probe (.claude/hooks/turn-end-shape-gate.probe.sh) using a transcript whose last assistant message has tool_use then text; check how the session JSONL actually records that sequence by reading a real session JSONL; fix the classification. Compare with the seyag twin (plugins/seyag/hooks/turn-end-shape-gate.sh, 173 vs 107 lines): if seyag already handles it, this folds into TASK-1106 (retire the twin).

Acceptance: a probe row with tool_use followed by a text block passes; the existing ends-on-tool row still blocks.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-10-11: #2604 retires the Tzurot copy; the Seyag plugin copy reads the Stop payload last_assistant_message first, which may fix this. Keep open until the plugin copy is observed live not misfiring on a turn that ended on text; the probe path in the description (.claude/hooks/turn-end-shape-gate.probe.sh) is gone, use seyag plugins/seyag/hooks/turn-end-shape-gate.probe.sh.

2026-10-11 closed: transcript audit. All 14 fires today (00:00Z onward) came from the retired Tzurot copy (.claude/hooks/turn-end-shape-gate.sh); the seyag plugin copy ran on every one of those same stop events and passed. After #2604 (18:36Z), 51 stop events ran the plugin gate across 26 transcripts: 0 fires. Fix = retirement in #2604 (plugin reads last_assistant_message first).
<!-- SECTION:NOTES:END -->
