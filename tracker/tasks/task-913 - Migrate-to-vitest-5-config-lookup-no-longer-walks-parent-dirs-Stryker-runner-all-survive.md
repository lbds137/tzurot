---
id: TASK-913
title: >-
  Migrate to vitest 5: config lookup no longer walks parent dirs, Stryker runner
  all-survive
status: To Do
assignee: []
created_date: '2026-09-07 23:49'
labels:
  - 'area:ci'
  - 'size:M'
  - 'state:observable'
dependencies: []
priority: medium
ordinal: 911000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: dependabot #2360 (dev group, 14 updates) bumped vitest 4.1.11 to 5.0.0 (released 2026-09-03) and @vitest/coverage-v8 to 5.0.0; CI run 34166540201 failed twice. (1) unit-tests (packages): SystemSettingsService.component.test.ts and VoiceTranscriptCache.component.test.ts ran inside the unit tier (hook timeout 10s; test Redis unreachable) because the root vitest.config.ts exclude list stopped applying: vitest 5 no longer searches parent directories for config files (migration guide, Configuration Lookup), and every package runs bare vitest from its own directory with no local config. (2) mutation-tests: every mutant survived in all five tracked packages (config-resolver 0.91, cache-invalidation 16.43, conversation-history 0.82, identity 6.24, clients 11.02 against floors near 95); @stryker-mutator/vitest-runner 10.0.0 declares peer vitest >=2.0.0 but no test executes under it on vitest 5; mechanism unverified, the same config-lookup change is the first candidate. Both majors were ignored server-side on the group on 2026-09-07 (@dependabot ignore vitest major version; @dependabot ignore @vitest/coverage-v8 major version) so the other 12 bumps can land.
Fix shape: own PR. Give each package an explicit config (a per-package vitest.config.ts extending the root, or --config in each test script, or root test.projects); verify the exclude set per tier against the tier-config table in TESTING.md; check the Stryker configFile per package and re-run pnpm --filter @tzurot/<pkg> test:mutation for one tracked package before opening the PR; sweep the other vitest 5 behavior changes repo-wide: clearMocks defaults to true, non-top-level vi.mock and vi.hoisted now throw, unawaited .resolves and .rejects assertions now fail, JSON and JUnit reporters write under .vitest/ by default (CI artifact paths), VITEST_WORKER_ID starts at 1; requires Vite >= 6.4 and Node >= 22.12. Then post @dependabot unignore for both packages on the open dev-deps PR; add matching ignore entries to dependabot.yml only if the migration is deliberately deferred (the config is read from main). After merge, rebase every open PR before merging it (dev-tooling major rule in the git-workflow skill).
Acceptance: the dev-deps group PR carrying vitest 5 is green on unit-tests (packages), mutation-tests, and component-integration-tests with no baseline edits, and pnpm ops mutation:check --summary reports every tracked package at or above its floor.
Promote when: @stryker-mutator/vitest-runner ships the fix for stryker-js issue 6210 (PR 6214: match the Vitest 5 test name separator when filtering tests). Then: bump vitest and @vitest/coverage-v8 to ^5 in the root, packages/tooling, scripts/, and tests/ package.json files (a partial patch with exactly those five files, lockfile included, is what the 2026-09-08 unit produced and held back), unignore both majors on the dependabot group, and run one tracked package's test:mutation before opening the PR.
<!-- SECTION:DESCRIPTION:END -->

Finding 2026-09-08 (nested-dispatch unit, PR #2364): the config-lookup half is built and shipped separately: per-package vitest.config.ts shims in the seven bare packages plus services/website (the pattern embeddings, tooling, scripts, and the services already used), vitest.workspace.ts deleted (unreferenced; defineWorkspace is gone in vitest 5), the five Stryker headers corrected. Canary on vitest 5: 18 component tests collected in common-types without a local config, 0 with it; on vitest 4 the shim is neutral (3091 listed either way). With the shims in place, Stryker on vitest 5 finds and runs all 199 config-resolver tests in its dry run but scores 0.91 anyway, running 0.39 tests per mutant: the runner's per-test name filter uses the vitest 4 separator, so no test matches and every covered mutant survives. That is upstream stryker-js issue 6210 (opened 2026-09-04), fix PR 6214 in progress; the runner peer range (vitest >=2.0.0) admits vitest 5 without supporting it. Ruled out by probe in the unit: the runner version branch (semver >=4.1.0 is true for 5.0.0) and the beforeEach task context (still present on vitest 5). The bump therefore waits on the release; waiving the mutation ratchet is ruled out by the standing rising-target posture. The vitest 5 behavior sweep found nothing to change: 0 non-top-level vi.mock or vi.hoisted (716 top-level positives), 0 .sequential API uses, 0 un-awaited resolves/rejects; nine suites green on vitest 5 with no test edits; junit.xml still lands at the package root.
