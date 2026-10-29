---
id: TASK-1324
title: >-
  Fix the 2684 tripwire regex - quoted -C args bypass it (round-6 review finding
  1)
status: Done
assignee: []
created_date: '2026-10-29T03:52:00Z'
updated_date: '2026-10-29T05:00:00Z'
labels:
  - area:tooling
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1307000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The round-6 review on PR 2684 traced by hand that settings-gh-wrappers.test.ts's tripwire regex /pnpm (?:-C \S+|--dir \S+) ops gh:(?!ci-gate)\S+/ cannot match the canonical Monitor form pnpm -C "$(git rev-parse --show-toplevel)" ops gh:ci-gate - the quoted command substitution contains spaces and \S+ cannot cross them - so a doc copying that line with a write verb (gh:pr-edit) would keep the test green. The tripwire as shipped asserts only unquoted single-word -C args, a form absent from the repo. Fix in the SAME next-session visit as TASK-1323 (both gate the 2684 merge): (1) regex to (?:-C|--dir)(?:=|\s+)(?:"[^"]*"|\S+); (2) inline positive-control fixtures through the same regex - one quoted-$(...) write-verb case, one --dir= case - both expected to match; (3) mutation check per Testing Standards principle 9: change gh:ci-gate to gh:pr-edit on the 05-tooling line in a scratch copy and watch the tripwire go red; (4) cover --dir=path, -C<path>, and -C after other pnpm globals, or record what stays uncovered; (5) widen the scan to .claude/hooks/*.sh (pr-monitor-reminder.sh carries the third Monitor copy) and docs/reference/tooling/, or justify the two-file scope in a comment; (6) update the file header + describe to cover the tripwire subject. Acceptance: the positive controls match, the mutation reddens, the suite is green, and PR 2684's body counts re-derived.
<!-- SECTION:DESCRIPTION:END -->
