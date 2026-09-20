---
id: TASK-947
title: >-
  adm-zip advisory GHSA-vwc7-r8mq-g2x9 has no published fix; the existing
  override cannot reach one
status: To Do
assignee: []
created_date: '2026-09-12 21:07'
labels:
  - 'area:deps'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: medium
ordinal: 945000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: pnpm ops security:advisories reports GHSA-vwc7-r8mq-g2x9 (medium, adm-zip, extraction follows destination symlinks and allows arbitrary file overwrite) as transitive with no fix published. Verified 2026-09-12: pnpm why -r adm-zip resolves a single copy, adm-zip 0.6.0, reached through onnxruntime-node from both @tzurot/ai-worker and @tzurot/embeddings, so it sits in the prod dependency tree rather than a dev-only branch. The vulnerable range is >= 0.5.9 through 0.6.0, and pnpm-lock.yaml already carries an override pinning adm-zip below 0.6.0 up into the >=0.6.0 <0.7.0 range from an earlier advisory in the same package. The new range extends through exactly the version that override targets, so there is nothing to bump to today and Dependabot will never open a PR for it.
Fix shape: nothing to do until upstream publishes a fixed release. When one lands, widen the existing pnpm.overrides entry to reach it and confirm the advisory clears. An onnxruntime-node release that drops the adm-zip dependency closes it equally well.
Promote when: a fixed adm-zip release exists, or a release preflight shows the advisory carrying a fix.
Acceptance: pnpm ops security:advisories reports no open adm-zip advisory.

UPDATE 2026-09-20 — the Promote when has FIRED and the override is in flight. adm-zip 0.6.1 is published (`pnpm view adm-zip version` → 0.6.1), and it clears BOTH open advisories at once: GHSA-7q85-xj36-vmfc (HIGH, raised since this task was filed; vulnerable < 0.6.1) names >=0.6.1 as its fix, and 0.6.1 falls outside this task's own GHSA-vwc7-r8mq-g2x9 range (>= 0.5.9, <= 0.6.0) even though that advisory still publishes no fix of its own. PR #2457 widens the entry from `adm-zip@<0.6.0` to `adm-zip@<0.6.1`; `pnpm why adm-zip -r` then resolves a single copy at 0.6.1, outside both ranges. The "nothing to do until upstream publishes a fixed release" fix shape above is SPENT.

Why this task stays open past that merge: its acceptance line cannot be checked from the fix. `pnpm ops security:advisories` enumerates GitHub's OPEN Dependabot alerts and consults the lockfile only to classify SCOPE — `classifyScope` (grep the name in `packages/tooling/src/audits/advisories.ts`) short-circuits to `transitive` for any package not in the direct-declaration set, returning before it ever calls `collectResolvedVersions`, so no transitive resolution moving can change its output. Separately, Dependabot raises alerts against the DEFAULT branch (the push to #2457's branch printed `GitHub found 2 vulnerabilities on lbds137/tzurot's default branch`), so they close when the override reaches `main` at the next release cut, not at the develop merge. Remaining work is one observation: re-run `pnpm ops security:advisories` after the next release lands on main, and close on a clean result.
<!-- SECTION:DESCRIPTION:END -->
