---
id: TASK-927
title: >-
  security:advisories classifies direct by name alone, so a direct+transitive
  package gets the wrong remediation
status: Done
assignee: []
created_date: '2026-09-09 21:13'
updated_date: '2026-09-12 14:08'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 925000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: isDirect is computed as `raw.ecosystem === "npm" && directNames.has(raw.package)` (packages/tooling/src/audits/advisories.ts:251) — pure membership of the package NAME in the workspace declaration set. It never reads the declared RANGE or the lockfile. So when a package is declared directly AND also pulled transitively, and every direct range already satisfies the fix while the lockfile still resolves a vulnerable copy, the report prints `(direct)` plus `Dependabot PR expected` — and no Dependabot PR will ever open, because from Dependabot view we are already patched.

Measured cost, not hypothesized: GHSA-rgj7-g3m4-5g8c (sharp, HIGH) hit exactly this shape. All four services declared ^0.35.4 while packages/embeddings pulled sharp@0.35.3 through @huggingface/transformers@4.2.0. The beta.222 release plan was written as `merge the Dependabot bump the moment it opens` on the strength of that label, and the actual fix was a pnpm.overrides floor bump.

Fix shape: classify from the RESOLVED tree rather than the declaration set. When the package name is in directNames, additionally check whether the lockfile still carries a version inside the advisory vulnerableRange; if it does while the direct declarations exclude it, that instance is transitive-only in practice — label it accordingly and print the pnpm.overrides remediation (the wording already exists at advisories.ts:285) instead of the Dependabot line at advisories.ts:282. A third label is probably clearer than reusing `transitive`, since the package genuinely is both.

Acceptance: an advisory whose direct declarations already exclude the vulnerable range but whose lockfile still resolves a vulnerable copy prints the overrides remediation, not `Dependabot PR expected`; a purely-direct advisory and a purely-transitive one keep their current wording; all three shapes pinned in packages/tooling/src/audits/advisories.test.ts, which already has per-shape cases to extend.
<!-- SECTION:DESCRIPTION:END -->
