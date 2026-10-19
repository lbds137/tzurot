---
id: TASK-1048
title: >-
  develop-code-commit-guard misses a commit inside bash -c or an unquoted
  heredoc body
status: To Do
assignee: []
created_date: '2026-09-22 19:39'
updated_date: '2026-10-19 03:47'
labels:
  - 'area:tooling'
  - 'size:M'
  - 'state:dependent'
dependencies:
  - TASK-1242
priority: medium
ordinal: 1042000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the TASK-1045 adversarial pass (2026-09-22) measured two bypasses of develop-code-commit-guard that predate that PR, identical with the old and new shell_quotes helper. (1) A plain `bash -c 'git commit -m x'` passes the guard (exit 0). (2) An unquoted-marker heredoc body whose `$( )` runs a commit passes it (exit 0); strip_heredoc_bodies removes the body before any scan, but bash executes substitutions in an unquoted body. Also unprobed: shell-invoking tools with no shell word (watch, su -c, ssh host) around a single-quoted command.
Fix shape: unwrap -c / eval arguments and scan them as commands, the way board-commit-branch-gate already unwraps bash -c, sh -c and eval to depth three (commit 6e868e627); scan unquoted-marker heredoc bodies for substitutions instead of stripping them. Add probe rows for each, and decide watch/su/ssh coverage explicitly.
Acceptance: probe rows for bash -c, sh -c, eval, and an unquoted heredoc body with a commit substitution all block on develop; the harness in TASK-1045 PR body shows those rows at exit 2.

## Merged from TASK-1049 (2026-10-12)

TASK-1049 (priority medium, was state:owner): independent adversarial pass on the fail-closed single-quote skip in `shell_quotes`. Why: TASK-1045 (PR #2477) shipped a single-quote skip in `substitution_spans` that removes text from two blocking guards (lossy-pipe-guard, develop-code-commit-guard). A first adversarial pass broke version one five ways; the rebuilt fail-closed version passes the combined 46-row harness, but a second independent pass was stopped by a safety classifier before testing anything. The owner ruled to ship with the gap stated; this work owns closing it, and it is the verification half of this task's bypass fixes.
Fix shape: an independent break-it pass from a context that did not write the code (a subagent prompt framed as building guard bypasses tripped a classifier). Harnesses: scratchpad copies are session-local, so rebuild from `git show` of the pre-PR helper vs the current one. Candidate list: shell contexts without a shell word (watch, su -c, ssh, xargs, find -exec, env -S, trap, alias, source), variable indirection to a shell, spelling tricks around the shell-word boundary, heredoc regex variants, escaped or split `$'`, and span-desync shapes (`$(( ))`, `$(<`, nested backticks, a double quote inside `${}`). Acceptance: a written verdict (bypass found or not) with the candidate list and old/new guard exit codes; any bypass gets a probe row and a fix.
OWNER DECISION 2026-10-04 (AskUserQuestion, chose the recommendation): the owner runs the break-it pass in a fresh session briefed with this task; it stays in the owner queue until then. Owner question (as filed): who runs the break-it pass, since a subagent attempt was stopped by a safety classifier? Recommendation (as filed): the owner starts a fresh session with this task as the brief, since a first-person request from the owner gives the pass the authorization context a delegated prompt lacked. So: the fix half (bash -c / heredoc) is startable by any session; the break-it pass is owner-run and sequenced after the fix.

Dependent on TASK-1242 (backlog review batch C, owner-approved 2026-10-18): the protected-branch rule of develop-code-commit-guard moves to the Seyag branch-commit component, so the bash -c / eval unwrap and the unquoted-heredoc scan ride upstream with it; the commit-header pre-check stays here. When Seyag ships branch-commit, check whether it blocks these shapes; close this task if so, otherwise re-scope it to the remaining gap. The owner-run break-it pass then targets the Seyag version.
<!-- SECTION:DESCRIPTION:END -->
