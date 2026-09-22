---
id: TASK-1049
title: >-
  Independent adversarial pass on the fail-closed single-quote skip in
  shell_quotes
status: To Do
assignee: []
created_date: '2026-09-22 19:56'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:owner'
dependencies: []
priority: medium
ordinal: 1043000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: TASK-1045 (PR #2477) shipped a single-quote skip in substitution_spans that removes text from two blocking guards (lossy-pipe-guard, develop-code-commit-guard). A first adversarial pass broke version one five ways; the rebuilt fail-closed version passes the combined 46-row harness, but a second independent pass on it was stopped by a safety classifier before testing anything. The owner ruled to ship with the gap stated; this task owns closing it.
Fix shape: an independent break-it pass from a context that did not write the code, ideally run by the owner or a session the owner starts (a subagent prompt framed as building guard bypasses tripped a classifier). Harnesses: scratchpad copies are session-local, so rebuild from git show of the pre-PR helper vs the current one. Candidate list: shell contexts without a shell word (watch, su -c, ssh, xargs, find -exec, env -S, trap, alias, source), variable indirection to a shell, spelling tricks around the shell-word boundary, heredoc regex variants, escaped or split $', and span-desync shapes ($(( )), $(<, nested backticks, a double quote inside ${}).
Acceptance: a written verdict (bypass found or not) with the candidate list and old/new guard exit codes; any bypass gets a probe row and a fix.
Owner question: who runs the break-it pass, since a subagent attempt was stopped by a safety classifier?
Recommendation: the owner starts a fresh session with this task as its brief — a first-person request from the owner gives the pass the authorization context a delegated prompt lacked.
<!-- SECTION:DESCRIPTION:END -->
