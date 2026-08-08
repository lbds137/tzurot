---
id: TASK-465
title: >-
  Lossy READS of files and tool output have no decision-point trigger, and cost
  three misses in one session
status: To Do
assignee: []
created_date: '2026-08-08 00:06'
updated_date: '2026-08-08 00:06'
labels:
  - 'area:process'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 465000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Surfaced 2026-08-07 during the TASK-458 work. Three errors in one session, all the same class: a partial read treated as complete. None was caught by tooling; each surfaced by accident.

1. Read a tracker task with sed -n 18,40p and treated the window as the whole file. The section that mattered (STATUS after #1999, at line 77) was cut off. Pushed a commit built on the wrong conclusion AND told the owner that member (e) was live work when it had already shipped. Caught only because a branch switch happened to print the full file.
2. Swept for a stale claim with grep across TWO NAMED FILES by phrase, declared the sweep done, and left the identical false claim live in a third file - in the ERROR OUTPUT a reader hits at the moment they act on it. Caught only because I opened that file later for an unrelated reason.
3. Read PIPESTATUS[0] after a three-stage pipeline to get a hook exit code. That index is the echo, not the hook. Nearly recorded a working blocking gate as broken. Caught only because the value looked suspicious.

Why the existing rules did not prevent it: 10-working-posture "Lossy steps are for known output shapes" covers this class conceptually, but it is framed around COMMAND OUTPUT and its read-side tell is "an empty or oddly short result". All three misses produced results that looked complete and plausible. There is no trigger for the case where the window itself is the lie.

Per the session-mining guidance, a rule that exists and is still violated is a COMPLIANCE finding - another rule restating it is worthless. So the fix is a decision-point trigger sentence in the EXISTING rule, not a new rule.

Fix shape: add to 10-working-posture the trigger "before making a claim about what a FILE says or does not say, either read it whole or state the window you read". Plus the PIPESTATUS note belongs with it - when measuring an exit code through a pipeline, index the right stage or do not pipe. Keep it to a few lines; the rules budget is 2085/2270 and this must not become an essay.

Also consider whether a hook can catch shape 1 mechanically: a Bash call using sed -n or head/tail on a file under tracker/ or .claude/ is a deterministic trigger, though the correction is not mechanical. Probably rule-only.

Acceptance: the trigger sentence lands in 10-working-posture via a review-gated PR, and it names the file-read case explicitly rather than only the command-output case.
<!-- SECTION:DESCRIPTION:END -->
