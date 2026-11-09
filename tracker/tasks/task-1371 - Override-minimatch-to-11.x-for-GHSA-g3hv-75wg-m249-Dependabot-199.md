---
id: TASK-1371
title: Override minimatch to 11.x for GHSA-g3hv-75wg-m249 (Dependabot 199)
status: To Do
assignee: []
created_date: '2026-11-09T00:38:00Z'
updated_date: '2026-11-09T13:47:00Z'
labels:
  - area:deps
  - size:S
  - state:observable
dependencies: []
priority: medium
ordinal: 1354000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: Dependabot alert 199 (medium, GHSA-g3hv-75wg-m249) flags minimatch >=7.0.0 <11.0.1; the lockfile resolves one copy, 10.2.6, pulled only by dev tooling (eslint 10.x, @eslint/config-array, eslint-plugin-import-x, eslint-plugin-sonarjs, @typescript-eslint/typescript-estree, @stryker-mutator/core, @ts-morph/common). pnpm ops security:advisories classifies it transitive, so Dependabot can never open a PR (not a dependabot.yml coverage gap). The existing root package.json pnpm.overrides entry "minimatch@>=10.0.0 <10.2.3": ">=10.2.3 <11.0.0" also caps it below the fix.

What: replace that override with one forcing the 7-11.0.0 range to ^11.0.5 (latest 11.x per pnpm view, engines node 18|20|>=22), pnpm install, confirm the lockfile resolves only 11.x, then run pnpm quality (lint is the main consumer) and the full test suite; its own PR.

Acceptance: security:advisories reports no open advisory; lint, quality and tests green; ships with the beta.243 release preflight per /tzurot-git-workflow (ride transitive fixes via override).
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Code shipped in PR 2727 (f8d1309d9, 2026-11-09). Remaining: alert 199 closes only when the beta.243 release lands on main (default branch); after that merge run pnpm ops security:advisories and mark Done. Override removal condition: drop minimatch@>=7.0.0 <11.0.1 from pnpm.overrides once @eslint/config-array, @typescript-eslint/typescript-estree, @stryker-mutator/core and @ts-morph/common all declare ^11 (pnpm view <pkg> dependencies.minimatch); until then it forces ^9/^10 declarers onto 11 silently, so a consumer bump that starts using a 10-only API fails at lint.
<!-- SECTION:NOTES:END -->
