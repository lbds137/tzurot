---
id: TASK-1325
title: Tripwire polish from the 2684 round-7 review
status: Done
assignee: []
created_date: '2026-10-29T05:01:00Z'
updated_date: '2026-10-29T17:41:00Z'
labels:
  - area:tooling
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1308000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Round-7 review on the merged wiring PR (verdict: nothing blocks): six non-blocking refinements to the settings-gh-wrappers tripwire. (1) widen the scanned rule and skill surfaces from the two hand-picked files to .claude/rules/*.md and .claude/skills/*/SKILL.md via a one-level readdirSync; (2) align the write-verb prose with the regex (it flags every non-ci-gate verb) or exclude the read set taken from SYG_LOSSY_PIPE_GH_WRAPPERS instead of hard-coding ci-gate; (3) document or cover a pnpm global flag placed after the -C argument (pnpm -C dir --silent ops gh:pr-edit); (4) scope \s to [ \t] so matches stay on one line; (6) add positive controls for -C path, -C with space, and the leading-global form. Item 5 (repoPath duplication) was ruled no-action by the reviewer until a third SYG_* pin arrives.
<!-- SECTION:DESCRIPTION:END -->
