---
id: TASK-1110
title: >-
  Drift check for the harness core.md section pointers in .claude rules, skills
  and hooks
status: To Do
assignee: []
created_date: '2026-09-25 21:58'
updated_date: '2026-10-11 19:26'
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
Why: PR #2541 replaced whole rule sections with pointers of the form "harness `core.md` § <heading>" (about 15 sites across .claude/rules, .claude/skills and claim-shape-guard.sh). The harness file lives outside the repo (~/Projects/seyag/plugins/seyag/rules/core.md, loaded through ~/.claude/rules), so a renamed or removed heading there turns every pointer silently inert and no in-repo gate notices; checkDocIdRefs in backlogLint.ts is the analogous guard for doc-N mentions. Raised by claude-review round 4 on #2541.

Fix shape: a pnpm ops guard:harness-refs (packages/tooling/src/dev/) that greps .claude/rules, .claude/skills and .claude/hooks for the pointer form, resolves each cited heading against the harness file when the path is reachable, reports misses, and skips with an explicit "harness file not reachable" line otherwise (CI cannot reach it, so this runs on the /tzurot-doc-audit cadence and in pnpm ops health, not as a merge gate). Positive control: a deliberately wrong heading in a fixture must be reported.

Second pointer form (added by #2547, claude-review round 3): `harness:doc-audit § Step 2` in `.claude/skills/tzurot-doc-audit/SKILL.md` (frontmatter description and § 0) and in `backlog/cadence-ledger.json` (the `memory-prune` trigger). It resolves against `~/Projects/seyag/plugins/seyag/skills/doc-audit/SKILL.md` headings, so the guard should also cover `harness:<skill> § <heading>` pointers and scan `backlog/cadence-ledger.json`.

Acceptance: the guard lists every pointer with its resolution; a fixture with one bad heading reddens it; the doc-audit skill names it as a step.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-10-11 (#2605): a second pointer family now exists, `seyag:<skill> § <exact heading>` in .claude/skills (35 at merge, checked by exact-heading grep against the seyag plugin skill files). Fold it into this drift check rather than a separate guard. Positive control worth keeping: `seyag:session-mining § Session Mining: extracting learnings` (a title-shaped heading, least obviously stable). The guard needs the seyag checkout present; skip with a notice where it is absent (CI).
<!-- SECTION:NOTES:END -->
