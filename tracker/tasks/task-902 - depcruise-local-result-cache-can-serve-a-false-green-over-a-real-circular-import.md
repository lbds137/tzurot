---
id: TASK-902
title: >-
  depcruise local result cache can serve a false green over a real circular
  import
status: To Do
assignee: []
created_date: '2026-09-06 17:08'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 900000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: during the slice A cycle fix (PR #2350), pnpm depcruise printed no violations with MemoryFormatter.ts <-> MemoryNoteSplitRender.ts physically cyclic on disk; re-running against a fresh node_modules/.cache/dependency-cruiser directory reported the violation. The cache is configured at .dependency-cruiser.cjs (cache: strategy content, folder node_modules/.cache/dependency-cruiser). CI does not reference that folder (grep of .github/workflows/ci.yml, 2026-09-06) so it starts cold there; the false green is a LOCAL gate problem, and pnpm quality runs pnpm depcruise through it.
Fix shape: reproduce with the recorded cycle (re-add an import of stripLegacyLocationSpans from MemoryFormatter.js in MemoryNoteSplitRender.ts) against a warm cache; then either drop the cache block, switch to a strategy that keys on the resolved graph, or have the quality chain pass a fresh cache dir. A correctness gate must not be able to report green over a present violation.
Acceptance: the reproduction reddens on a warm cache; a note in 05-tooling.md or the depcruise config says which mechanism was chosen.
<!-- SECTION:DESCRIPTION:END -->
