---
id: TASK-442
title: Three copies of the git-commit-detection regex must agree — add a sync guard
status: To Do
assignee: []
created_date: '2026-08-05 21:37'
updated_date: '2026-08-05 21:37'
labels:
  - 'area:tooling'
  - 'area:ci'
  - 'size:S'
dependencies: []
priority: medium
ordinal: 442000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the same "is this a git commit" pattern now lives in THREE places — the bash lib `.claude/hooks/lib/git-command.sh` (is_git_commit_command), develop-code-commit-guard.sh (python GIT regex), and git-commit-filter-guard.sh (GIT_TARGET). The commit-tree false positive needed a synchronized three-way fix: bash in #1980, both python copies in #1981. lib/git-command.sh documents the coupling in a comment ("sync manually if the shape changes"), which is exactly the unenforced-invariant shape TASK-368 is about. A third divergence is a matter of when, not if. Raised by the #1981 round-3 review.

Fix shape: a probe or guard that feeds one shared case table through all three implementations and asserts identical verdicts — the pattern TASK-223 uses for the three protected-index registries. Cases must include the plumbing subcommands, the -C global-flag forms, and a real commit. Bonus: it would have caught the #1980-to-#1981 gap the moment it opened.

Note the implementations are NOT literally identical and should not be forced to be: python \w is Unicode-aware while the bash character class is ASCII-only, and re.ASCII would narrow \s and break a non-breaking-space commit. The guard asserts agreement on the case table, not textual identity.

Acceptance: one probe exercises all three implementations over a shared table; changing any one pattern without the others fails it.
<!-- SECTION:DESCRIPTION:END -->
