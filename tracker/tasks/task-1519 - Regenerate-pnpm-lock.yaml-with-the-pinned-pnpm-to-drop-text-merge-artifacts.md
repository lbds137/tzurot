---
id: TASK-1519
title: Regenerate pnpm-lock.yaml with the pinned pnpm to drop text-merge artifacts
status: To Do
assignee: []
created_date: '2026-11-24T01:11:00Z'
labels:
  - area:deps
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1519000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: rebase-merging the two dependabot groups (PRs 2793 and 2792) combined their pnpm-lock.yaml edits as text. PR 2798 removed the duplicated @tybys/wasm-util@0.10.5 key, but two artifacts remain. (1) An orphaned @tybys/wasm-util@0.10.4 entry in packages: and snapshots: that nothing references; --frozen-lockfile tolerates it. (2) pnpm install --lockfile-only rewrote about 1,170 lines locally, so the merged file is still far from what pnpm would resolve. The cause is unknown: more merge artifacts, or a local pnpm version different from the packageManager pin. Left alone, the next real install drops the churn into an unrelated PR.

What: after the beta.249 release, run pnpm install --lockfile-only with the packageManager-pinned pnpm (check pnpm --version against package.json first), as its own chore(deps) PR. Read the delta: if it is version noise, record why; if it contains more orphans or duplicates, the regeneration removes them.

Acceptance: the 0.10.4 orphan is gone, a regenerate with the pinned pnpm produces no diff, and the PR body classifies the delta.
<!-- SECTION:DESCRIPTION:END -->
