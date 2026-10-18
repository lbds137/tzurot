---
id: TASK-1241
title: >-
  develop-code-commit-guard subject pre-check: two false positives ($(…)
  subject, uppercase TASK id after the type prefix)
status: To Do
assignee: []
created_date: '2026-10-18 12:49'
labels:
  - 'area:hooks'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1229000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the 2026-10-18 session-log retro (owner-approved proposals, relayed by the Deck session) found two false positives of the commit-header pre-check in .claude/hooks/develop-code-commit-guard.sh, each seen twice in session logs. Both block commits that commitlint would accept, costing a retry each time.

What:
1. A commit subject given as a command substitution other than the canonical heredoc (for example -m "$(printf ...)" or -m "$(cat msgfile)") is judged by _plain_subject on its unexpanded text. Either evaluate it after expansion is impossible in a PreToolUse hook, so skip the header verdict (return ok) when the extracted subject starts with $( or a backtick.
2. A subject whose text after the type prefix opens with an uppercase task id (docs(backlog): TASK-1179 Done) trips the case verdict (subject_part[:1].isupper()). First probe whether commitlint's subject-case rule actually accepts that subject (run it through the commit-msg hook in a scratch repo or commitlint directly); if it does, exempt a leading TASK-N id from the case check; if commitlint rejects it too, the hook is right and this item closes as working-as-designed with the probe output recorded here.

Add a probe case for each in .claude/hooks/develop-code-commit-guard.probe.sh (fixture text fed on stdin, per 05-tooling.md), and run the probe after the edit.

Acceptance: both shapes pass the hook (or item 2 is recorded as matching commitlint), the existing taskopen/length/case probes still fire, guard:hook-probes green.
<!-- SECTION:DESCRIPTION:END -->
