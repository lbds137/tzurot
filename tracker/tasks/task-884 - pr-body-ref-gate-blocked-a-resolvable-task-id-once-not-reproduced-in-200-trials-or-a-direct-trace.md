---
id: TASK-884
title: >-
  pr-body-ref-gate blocked a resolvable task id once; not reproduced in 200
  trials or a direct trace
status: To Do
assignee: []
created_date: '2026-09-04 08:56'
labels:
  - 'area:hooks'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 882000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: on 2026-09-04 the PreToolUse gate pr-body-ref-gate.sh blocked a gh pr create whose body said Closes TASK-642, reporting task-642 as unresolved on origin/develop, while the task file had been on develop since 2026-08-17 and the gate printed verify command returned it. The same body text passed on retry minutes later and created PR 2322. Hypotheses tested and NOT confirmed: the grep engine (the resolver line at grep -qiF matches under both ugrep 7.8.4 and GNU grep 3.11 with and without -i, with and without the trailing space); a SIGPIPE race under the file-level set -o pipefail between printf and grep -q on the 91 KB listing (0 of 200 trials failed); the heredoc-shaped --body extraction (a direct run of the hook on a payload with the same shape resolved the id and traced IDS=task-642, MISSING empty). The first block came inside a long compound command that also carried git commit and git push; the retry ran gh pr create alone. Whether the compound shape matters is unmeasured.

Fix shape: none until it recurs. On the next occurrence, before retrying, save the exact tool_input.command to a file and run the hook on it directly with bash -x, capturing the TASK_LIST length and the PIPESTATUS of the grep -qiF line. If SIGPIPE is the cause the durable fix is to drop -q from that grep and send stdout to /dev/null so grep drains its input, in both the task and doc branches, with a probe case that feeds a listing larger than the pipe buffer.

Promote when: the gate blocks a resolvable id a second time.
<!-- SECTION:DESCRIPTION:END -->
