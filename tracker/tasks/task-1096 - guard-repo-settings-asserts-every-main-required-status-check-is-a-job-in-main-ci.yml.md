---
id: TASK-1096
title: >-
  guard:repo-settings asserts every main-required status check is a job in main
  ci.yml
status: Done
assignee: []
created_date: '2026-09-25 01:45'
updated_date: '2026-09-25 07:04'
labels:
  - 'area:ci'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 1089000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: 2026-09-24 the main ruleset (5788828) required `hook-posix-parse`, a CI job that existed only on develop (#2506 landed after the beta.229 cut), so every main-cut PR was unmergeable with no bypass actor (#2516 blocked; GitHub 405 "Required status check hook-posix-parse is expected"). The check was mirrored to main when the rulesets were re-applied from the #2518 snapshots; `.github/rulesets/README.md` § Required status checks and `branch-protection.json` still list 13 for main. Owner ruling 2026-09-24: dropped from the main ruleset live (12 checks now); re-add at the beta.230 cut.
Fix shape: (1) `packages/tooling/src/dev/check-repo-settings.ts` gains an assertion: every `required_status_checks[].context` on the DEFAULT-branch ruleset must be a job id in `origin/main:.github/workflows/ci.yml` (parse job keys; matrix jobs like `unit-tests (ai-worker)` match by the job id prefix before ` (`; `docker-build-smoke-ok` is a real job). Fail loud with the offending context and the remedy (remove it, or wait for the release that ships the job). Add the symmetric warning (not failure) for a job that develop requires and main does not, so the re-add at the cut is prompted. (2) Rewrite README § Required status checks: main = the 12, develop = those + `hook-posix-parse` + `fixup-check`, and the rule: a context joins the main list only after the release that ships its job reaches main; regenerate `branch-protection.json` from the live ruleset. (3) Add the cut step to `/tzurot-git-workflow` § Release security preflight or the now.md deploy notes: re-add `hook-posix-parse` to the main ruleset after beta.230 merges.
Acceptance: `pnpm ops guard:repo-settings` fails on a synthetic ruleset carrying a context absent from main ci.yml (unit test with a fixture), passes on the live one; README and snapshot match the live main ruleset.
<!-- SECTION:DESCRIPTION:END -->
