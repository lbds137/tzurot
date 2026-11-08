---
id: TASK-1362
title: >-
  Block git commit/push --no-verify in agent sessions; drop the pre-push hint
  that suggests it
status: Done
assignee: []
created_date: '2026-11-08T10:28:00Z'
updated_date: '2026-11-08T17:34:00Z'
labels:
  - area:tooling
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1345000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: Deck weekly mining w1108-29 (5 items over 4 sessions, mostly Tzurot): fixup commits made with --no-verify skipped lint-staged (prettier/eslint), so formatting failures surfaced only in CI and each cost a CI round. Measured 11-08: no hook blocks --no-verify on feature-branch commits (git grep -n no-verify over .claude/hooks shows only probes and develop-code-commit-guard's flag parser), the only prose rule is 00-critical.md's develop doc-commit line, and .husky/pre-push prints 'or use: git push --no-verify' twice (grep no-verify .husky/pre-push) as the advertised escape.

What: a PreToolUse Bash hook (.claude/hooks/, with its probe and a registry row in check-hook-probes-registry.ts) that blocks git commit or git push carrying --no-verify (or -n on commit) unless an explicit override env var is set for the documented exceptions (hook probes create fixture commits with --no-verify inside their own temp repos: scope the block to the real repo or exempt -C into a temp dir, and prove it with the probe). Remove the --no-verify suggestion from the two .husky/pre-push messages. The commitlint subject-case half of w1108-29 is ruled out as a duplicate: 05-tooling.md Commitlint gotchas already states it and the commit-msg hook rejects it at commit time, at no CI cost.

Acceptance: the probe shows a blocked commit --no-verify and push --no-verify, an allowed override, and existing probes that seed temp repos with --no-verify still pass; guard:hook-probes green.
<!-- SECTION:DESCRIPTION:END -->
