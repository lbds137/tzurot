---
id: TASK-884
title: >-
  pr-body-ref-gate blocked a resolvable task id once; not reproduced in 200
  trials or a direct trace
status: Done
assignee: []
created_date: '2026-09-04 08:56'
updated_date: '2026-09-04 11:21'
labels:
  - 'area:hooks'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 882000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: on 2026-09-04 the PreToolUse gate pr-body-ref-gate.sh blocked a gh pr create whose body said Closes TASK-642, reporting task-642 as unresolved on origin/develop, while the task file had been on develop since 2026-08-17 and the gate printed verify command returned it. The same body text passed on retry minutes later and created PR 2322. Hypotheses tested and NOT confirmed: the grep engine (the resolver line at grep -qiF matches under both ugrep 7.8.4 and GNU grep 3.11 with and without -i, with and without the trailing space); a SIGPIPE race under the file-level set -o pipefail between printf and grep -q on the 91 KB listing (0 of 200 trials failed); the heredoc-shaped --body extraction (a direct run of the hook on a payload with the same shape resolved the id and traced IDS=task-642, MISSING empty). The first block came inside a long compound command that also carried git commit and git push; the retry ran gh pr create alone. Whether the compound shape matters is unmeasured.

Fix shape: none until it recurs. On the next occurrence, before retrying, save the exact tool_input.command to a file and run the hook on it directly with bash -x, capturing the TASK_LIST length and the PIPESTATUS of the grep -qiF line. If SIGPIPE is the cause the durable fix is to drop -q from that grep and send stdout to /dev/null so grep drains its input, in both the task and doc branches, with a probe case that feeds a listing larger than the pipe buffer.

Promote when: the gate blocks a resolvable id a second time.

RECURRED AND DIAGNOSED 2026-09-04, same day. Second block: a pnpm ops gh:pr-edit 2322 --body-file edit whose body said Closes TASK-642, again reported task-642 unresolved. The diagnostic above was run: the exact tool_input.command saved to a payload file, the hook run on it directly. A plain run returned exit 2; two bash -x runs disagreed with each other (one marked task-642 MISSING, the next matched it and continued), which is the signature of a race, not of the text. An instrumented copy of the hook that prints PIPESTATUS after the lookup line then reproduced it under the same payload: 59 of 60 runs PS=[0 0], 1 of 60 runs PS=[141 0] with the hook exiting 2. So the mechanism is exactly the SIGPIPE shape first hypothesized: the listing is about 92 KB, larger than the 64 KB pipe buffer; task-642 sits at row 612 of about 900, so grep -q exits on the match while printf is still writing the remainder; printf takes SIGPIPE (141); set -o pipefail makes the pipeline status 141 even though grep matched; the id lands in MISSING. It fires at roughly 1 to 2 percent per lookup, which is why 200 idle trials and 150 loaded trials of the bare pipeline missed it, and it favours ids that sort EARLY in the listing (a late id like task-885 lets printf finish before the match).

Fix shape, confirmed: in both the task and the doc branches, replace grep -qiF with grep -iF and send stdout to /dev/null, so grep drains its input and printf can never be killed mid-write; the status then comes from grep alone. Probe: a git shim on PATH (the existing broken-git shim in the probe shows the shape) whose ls-tree prints a synthetic listing larger than 64 KB with the referenced id near the top, run enough times to make a 1-percent race visible, plus the inverse control that the same id resolves when the listing is small. Canary: restore -q, and the large-listing case must show at least one 141 across its runs. Hooks are review-gated: its own PR.
<!-- SECTION:DESCRIPTION:END -->
