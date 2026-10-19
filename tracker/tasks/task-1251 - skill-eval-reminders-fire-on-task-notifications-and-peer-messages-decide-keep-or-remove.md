---
id: TASK-1251
title: >-
  skill-eval reminders fire on task notifications and peer messages; decide keep
  or remove
status: Done
assignee: []
created_date: '2026-10-19 02:28'
updated_date: '2026-10-19 02:48'
labels:
  - 'area:hooks'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1239000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: TASK-1244 measured .claude/hooks/skill-eval.sh over 85 transcripts: ~94% of reminder-bearing turns are not human prompts (88% of task-notification turns, 50% of peer messages get one, because UserPromptSubmit runs on queued notifications and keyword-matches their text), and on human prompts only 11 of 222 fresh reminders (5%) were followed by a load of the named skill. Each reminder is injected context on every notification.

What: make the hook skip prompts containing <task-notification> or <cross-session-message> (with a probe arm for each), then decide on the 5% figure whether the hook stays at all. Seyag ruled out adopting it.

Acceptance: notification and peer-message prompts get no SKILL CHECK; the keep-or-remove decision is recorded here with its reason.

Decision: KEEP. With the two measured wrappers skipped, TASK-1244's count of reminders on human prompts is about 222 over 85 transcripts (~2.6 per session, ~6 lines each), so its context cost is now small. Other non-typed prompt shapes (slash-command expansions, pasted-content blocks) still reach the keyword branches and were not measured. The 5% load rate does not show the reminder fails when it is relevant: the 222 mix keyword false positives (bare deploy, mock, PR, migration) with real misses, and TASK-1244 did not separate the two. The 11 named-skill loads that followed one of those 222 reminders (TASK-1244) are non-zero value at near-zero cost. Removing it would also mean deleting the hook and probe and rewriting 10-working-posture.md § SKILL CHECK reminders are binding, which is a bigger change than this evidence carries.
<!-- SECTION:DESCRIPTION:END -->
