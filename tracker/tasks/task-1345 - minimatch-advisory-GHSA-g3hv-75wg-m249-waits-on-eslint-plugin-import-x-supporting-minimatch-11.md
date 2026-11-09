---
id: TASK-1345
title: >-
  minimatch advisory GHSA-g3hv-75wg-m249 waits on eslint-plugin-import-x
  supporting minimatch 11
status: Done
assignee: []
created_date: '2026-11-03T12:30:00Z'
updated_date: '2026-11-09T13:47:00Z'
labels:
  - area:deps
  - size:S
  - state:observable
dependencies: []
priority: low
ordinal: 1328000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: Dependabot alert 197 (moderate, globparts amplification DoS) flags minimatch < 11.0.1. Every consumer is dev tooling: eslint, @eslint/config-array, eslint-plugin-import-x, eslint-plugin-sonarjs, @stryker-mutator/core, @ts-morph/common and @typescript-eslint/typescript-estree, all on 10.2.6 (pnpm-lock.yaml). Nothing ships to prod, and the patterns come from our own config.

Tried at the beta.242 cut (2026-11-03): an override minimatch@>=10.0.0 <11.0.1 to >=11.0.1 <12.0.0 resolved all eight to 11.0.4, but lint failed in every package. eslint-plugin-import-x 4.17.1 (its latest, published 2026-06) imports makeRe from minimatch, which 11 no longer exports, and it declares minimatch ^9.0.3 || ^10.1.2. No patched 10.x exists (10.2.6 is the newest).

What: when import-x ships a release that accepts minimatch 11, or minimatch backports the fix to 10.x, widen the override in package.json pnpm.overrides and run lint.

Acceptance: pnpm ops security:advisories reports no minimatch advisory, and lint is green.

Promote when: eslint-plugin-import-x supports minimatch 11, or a patched 10.x lands (npm view eslint-plugin-import-x dependencies.minimatch).
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Shipped in PR 2727 (f8d1309d9, 2026-11-09): eslint-plugin-import-x 4.18.0 declares minimatch ^11.0.1, override now forces 7-11.0.0 onto 11.0.5; lint green on all 27 tasks (forced, 0 cached). The advisory-close half of the acceptance moves to TASK-1371, which closes once the release reaches main (Dependabot reads the default branch).
<!-- SECTION:NOTES:END -->
