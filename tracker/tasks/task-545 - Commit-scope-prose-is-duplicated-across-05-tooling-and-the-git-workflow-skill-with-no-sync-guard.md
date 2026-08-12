---
id: TASK-545
title: >-
  Commit-scope prose is duplicated across 05-tooling and the git-workflow skill
  with no sync guard
status: To Do
assignee: []
created_date: '2026-08-12 07:43'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 545000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2071 corrected the commit-scope list in BOTH .claude/rules/05-tooling.md and .claude/skills/tzurot-git-workflow/SKILL.md, which had silently diverged from commitlint.config.cjs allScopes. The two copies now agree, but nothing enforces that they stay in sync — which is the same drift class TASK-523 just fixed for the content. Surfaced by the PR 2071 round-4 review.

Precedent: guard:monitor-command already keeps three copies of the CI-gate invocation byte-identical, so the repo has a working pattern for exactly this.

Fix shape, pick one: (a) single-source it — leave the full rendering in 05-tooling.md and have SKILL.md point at it. Cheapest, but the skill is the surface someone reads while writing a commit, so a pointer costs them a hop at the moment they need the answer. (b) add a cheap guard that asserts both files render the same scope set AND that the set matches allScopes in commitlint.config.cjs — strictly better, because it catches divergence from the SOURCE rather than merely divergence from each other. Two files agreeing on a wrong list is the failure that already happened.

Prefer (b). A guard comparing prose to a generated list needs a stable extraction; the scope line has a fixed shape in both files, so a targeted regex is enough. Register it per docs/reference/audit-enforcement.md.

Acceptance: a change to allScopes that leaves either markdown copy stale fails a gate, rather than being rediscovered as a later staleness task.
<!-- SECTION:DESCRIPTION:END -->
