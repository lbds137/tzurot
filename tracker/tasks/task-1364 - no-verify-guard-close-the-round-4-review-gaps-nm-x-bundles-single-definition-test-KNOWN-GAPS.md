---
id: TASK-1364
title: >-
  no-verify-guard: close the round-4 review gaps (-nm"x" bundles,
  single-definition test, KNOWN GAPS)
status: Done
assignee: []
created_date: '2026-11-08T17:32:00Z'
updated_date: '2026-11-08T19:19:00Z'
labels:
  - area:tooling
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1347000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2722 (TASK-1362) merged at its fourth claude-review round with no blockers; the remaining findings are recorded here instead of a fifth round. The first is a real under-arm in the guard: commit_skips in .claude/hooks/no-verify-guard.sh only walks a bundle that fully matches -[A-Za-z]+, so a bundle whose arg-taking letter carries an attached non-letter value is skipped even when n comes first: git commit -nm"fix: x" (token -nm<placeholder>), git commit -nFmsg.txt, git commit -anm'x' all pass while git really skips the hooks.

What:
1. commit_skips: match the leading letter run of a single-dash token (re.match(r"-([A-Za-z]+)", tok), not --) and walk it with the existing ARG_TAKING break. Probe: -nm"x" blocks, -mn"x" passes.
2. packages/tooling/src/dev/gitCommitPattern.test.ts single-definition check: add no-verify-guard.sh to HOOK_FILES and assert no inlined GIT_PUSH_RE copy (the push regex body); update the stale both-hooks / two-hooks prose in that file.
3. KNOWN GAPS in the hook header: brace expansion and process substitution end the argument span (git commit -m x src/{a,b}.ts -n, git commit -F <(echo x) -n), unless blanking glued {...} is cheap; git aliases (git ci -n) are not seen.
4. Probe: one case capturing stderr on TZUROT_ALLOW_NO_VERIFY=1 git push --no-verify and grepping the override-used line.
5. Optional: pin git stash push -n as a non-push row in PUSH_CASES.

Acceptance: the probe blocks -nm"x" and -nFmsg.txt and passes -mn"x"; the single-definition test covers all three importers and GIT_PUSH_RE; KNOWN GAPS lists braces, process substitution and aliases; guard:hook-probes green.
<!-- SECTION:DESCRIPTION:END -->
