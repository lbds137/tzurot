---
id: TASK-346
title: Audit remaining route-factory functions for dead production wiring
status: To Do
assignee: []
created_date: '2026-07-28 22:27'
updated_date: '2026-07-28 22:38'
labels:
  - 'area:api-gateway'
  - 'size:M'
dependencies: []
priority: medium
ordinal: 346000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the codegen mounts.ts cutover left legacy router factories behind in several route families. Two confirmed-dead ones are already deleted (#1836 createAIRouter, TASK-316 createMemoryRoutes/createFreshRoutes/createIncognitoRoutes — the latter's "preserved for existing wiring" comments were stale lies). ~17 test files still consume expressRouterUtils to extract handlers from factory-built routers (admin/denylist, admin/settings, admin/tts-config, admin/usage, admin/diagnostic, admin/llm-config, wallet/setKey, wallet/testKey, wallet/listKeys, user/timezone, user/config-overrides, user/personality-config-overrides, user/model-override, user/llm-config, user/usage, user/history, shared-route-test-utils), suggesting their factories may also be dead in production (index.ts records the /internal /wallet aggregator mounts as removed).

Fix shape: per family — grep the factory's production consumers; if only tests consume it, delete the factory and migrate the tests to direct handler construction (the TASK-316 memory-family PR is the pattern: route wiring is owned by mounts.ts + codegen:routes --check; tests exercise handlers directly). If a factory IS production-mounted, leave it and record why. expressRouterUtils itself becomes deletable once its last factory-based suite migrates.

Acceptance: every remaining create*Routes/create*Router factory either has a verified production mount or is deleted with its tests migrated.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Rider from the #1842 review: modeDeps() (prisma+redis test-deps helper) is duplicated verbatim in memoryFresh.test.ts + memoryIncognito.test.ts — reviewer-judged not worth extracting at two copies; extract a shared test util if this audit's migrations mint a third copy of the same shape.

AUDIT DONE (full-repo sweep). Verdicts: 6 factories are LIVE production mounts and stay — createHealthRouter, createAvatarRouter, createExportsRouter, createGitHubReleaseWebhookRouter (index.ts:341-372), createMetricsRouter, createVoiceReferenceRouter (index.ts:386,395) — this is the deliberate non-codegen public/protected surface; their supertest-through-router tests are correct, not legacy. Exactly 2 are test-only dead: (1) createRemoveKeyRoute (routes/wallet/removeKey.ts — mounts.ts uses handleRemoveWalletKey directly; limiters wired at index.ts:446) — retirement PR in flight; (2) createDenylistRoutes (routes/admin/denylist.ts — mounts.ts registers the bare handlers) whose retirement also deletes expressRouterUtils(+test), its last consumer. The old "~17 test files consume expressRouterUtils" premise is stale: the memory-family migration already shrank it to ONE consumer (denylist.test.ts) and one export (getAllRoutes). The /cache-no-owner-auth invariant that denylist getAllRoutes test protects is independently pinned by mounts.component.test.ts + conformance fixtures, so the structural test can go.

BLOCKED slice: the denylist retirement must land WITH the TASK-411 decision (re-wire vs drop the denylist rate limiter) — deleting the factory orphans createRedisDenylistRateLimiter (its only caller), which knip would flag, and 411 is the owner-gated security call. When 411 resolves, the denylist PR closes this task.
<!-- SECTION:NOTES:END -->
