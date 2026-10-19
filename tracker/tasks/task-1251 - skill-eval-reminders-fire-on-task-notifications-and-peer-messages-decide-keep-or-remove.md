---
id: TASK-1251
title: >-
  skill-eval reminders fire on task notifications and peer messages; decide keep
  or remove
status: To Do
assignee: []
created_date: '2026-10-19 02:28'
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
<!-- SECTION:DESCRIPTION:END -->
