## ⚡️ Quick Wins

_Small tasks that can be done between major features. Good for momentum._

### `[LIFT]` Cache the global-preset model-id set in `/models browse`

`loadAnnotatedModels` (`services/bot-client/src/commands/models/browse.ts`) calls `userClient.listUserLlmConfigs()` on **every** browse interaction (initial command, each page flip, filter/search change) just to derive the global-preset model-id set for pinning. That set doesn't change during a browse session, so the repeated fetch is wasted network cost (it rides in the existing 3-way `Promise.all`, so latency impact is small — but it's avoidable). **Fix shape**: a short-TTL (or per-session) in-memory cache of the `isGlobal` preset model-id set, refreshed lazily. Same shape as the other bot-client TTL caches. Surfaced 2026-06-15 by PR #1218 review (rounds 2–4 flagged it repeatedly as a follow-up).

> Note: 7 items previously filed here all shipped in PR #1082-1084 (Layer 2 + Layer 3 of the periodic-audit-enforcement proposal). The remaining work tracked in [`docs/proposals/backlog/periodic-audit-enforcement.md`](../docs/proposals/backlog/periodic-audit-enforcement.md) is Layers 4-5 (markdown baselines + `ops:health` cron aggregator).

_Shipped 2026-06-12 (quick-wins sweep, PRs #1191/#1192/#1193): stacked-JSDoc merge in check-duplicate-exports, contentToText replacing the BaseMessage content-as-string casts, integration-coverage services/** glob._

_Shipped 2026-06-03 (quick-wins sweep, PRs #1147/#1148/#1149): redis removal + test-factories depcruise boundary, `guard:dockerfile-dist`, view.ts coverage + typed preset unflatten pipeline._

_Shipped 2026-06-14 (#1202): admin-route test asserting `hasZaiCodingKey:true` accepts z.ai-only models (`z-ai/glm-5.2`) on create + update._
