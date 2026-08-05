---
id: TASK-441
title: >-
  Backport commit-tree exclusion to python-side git-commit guards (+ hook nits
  from #1980 review)
status: To Do
assignee: []
created_date: '2026-08-05 20:32'
labels:
  - 'area:tooling'
  - 'size:S'
dependencies: []
priority: medium
ordinal: 441000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: #1980 fixed \bcommit\b matching plumbing subcommands (commit-tree/commit-graph) in lib/git-command.sh, but develop-code-commit-guard.sh (~line 79) and git-commit-filter-guard.sh (~line 64) still use the bare \bcommit\b Python regex. develop-code-commit-guard BLOCKS, so a legitimate git commit-tree on develop with dirty review-gated files would be wrongly blocked. Raised by the #1980 round-5 review; not folded in because changing a blocking hook deserves its own probe-covered PR.

Members (same touch, fold in): (a) the backport itself - trailing ([^-a-zA-Z0-9_]|$) equivalent in both Python regexes + probe cases; (b) move the two jq forks in claim-shape-guard.sh / fixup-rider-check.sh behind a raw substring pre-check on $INPUT so the cheap-first comment is accurate; (c) show the session-mining mid-turn jq snippet inside its for-loop context (standalone snippet references loop-scoped $f/$CORPUS); (d) consider reusing develop-code-commit-guard heredoc/quote stripping in is_git_commit_command to kill message-text false-fires.

STATUS after #1981: (a), (b) and (c) SHIPPED. (d) remains — the task stays open for it. #1981 deferred (d) because it needs a runtime-confirmed false-fire first, and the bash-vs-Python tradeoff is real: bash cannot express the heredoc delimiter backreference, so the options are a bash state loop or forking Python from the lib.

(e) NEW, from the #1981 round-3 review: the raw-stdin pre-check landed only in claim-shape-guard.sh and fixup-rider-check.sh, but develop-code-commit-guard.sh and git-commit-filter-guard.sh are the PreToolUse hooks that run on EVERY Bash call, and they still fork jq twice before their decoded-command short-circuit. That is where a cheap-first pass actually pays. Not ridden in #1981 because an early exit added to a BLOCKING guard is a behavior change needing its own probe cases. See also TASK-442 (the three-way regex sync guard).

Acceptance: git commit-tree not treated as git commit by any hook (probe-pinned in both guards); claim-shape/fixup-rider hooks fork jq only when the input plausibly contains a commit.
<!-- SECTION:DESCRIPTION:END -->
