---
id: TASK-1110
title: >-
  Drift check for the harness core.md section pointers in .claude rules, skills
  and hooks
status: To Do
assignee: []
created_date: '2026-09-25 21:58'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1103000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR #2541 replaced whole rule sections with pointers of the form "harness `core.md` § <heading>" (about 15 sites across .claude/rules, .claude/skills and claim-shape-guard.sh). The harness file lives outside the repo (~/Projects/claude-harness/plugins/harness/rules/core.md, loaded through ~/.claude/rules), so a renamed or removed heading there turns every pointer silently inert and no in-repo gate notices; checkDocIdRefs in backlogLint.ts is the analogous guard for doc-N mentions. Raised by claude-review round 4 on #2541.

Fix shape: a pnpm ops guard:harness-refs (packages/tooling/src/dev/) that greps .claude/rules, .claude/skills and .claude/hooks for the pointer form, resolves each cited heading against the harness file when the path is reachable, reports misses, and skips with an explicit "harness file not reachable" line otherwise (CI cannot reach it, so this runs on the /tzurot-doc-audit cadence and in pnpm ops health, not as a merge gate). Positive control: a deliberately wrong heading in a fixture must be reported.

Acceptance: the guard lists every pointer with its resolution; a fixture with one bad heading reddens it; the doc-audit skill names it as a step.
<!-- SECTION:DESCRIPTION:END -->
