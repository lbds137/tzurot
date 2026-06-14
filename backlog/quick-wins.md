## ⚡️ Quick Wins

_Small tasks that can be done between major features. Good for momentum._

> Note: 7 items previously filed here all shipped in PR #1082-1084 (Layer 2 + Layer 3 of the periodic-audit-enforcement proposal). The remaining work tracked in [`docs/proposals/backlog/periodic-audit-enforcement.md`](../docs/proposals/backlog/periodic-audit-enforcement.md) is Layers 4-5 (markdown baselines + `ops:health` cron aggregator).

_Shipped 2026-06-12 (quick-wins sweep, PRs #1191/#1192/#1193): stacked-JSDoc merge in check-duplicate-exports, contentToText replacing the BaseMessage content-as-string casts, integration-coverage services/** glob._

_Shipped 2026-06-03 (quick-wins sweep, PRs #1147/#1148/#1149): redis removal + test-factories depcruise boundary, `guard:dockerfile-dist`, view.ts coverage + typed preset unflatten pipeline. One new item filed below from the sweep's review cycles._

### `[CHORE]` Admin-route test: `hasZaiCodingKey:true` accepts z.ai-only models

**Surfaced 2026-06-14** (claude-review on release PR #1200). The admin llm-config routes pass `hasZaiCodingKey: true` unconditionally (global presets), and the user routes have an end-to-end test for the z.ai-key path — but there's no explicit **admin-route** test verifying that a z.ai-only model like `z-ai/glm-5.2` is accepted on the admin create/update path. The validation logic is covered in `modelValidation.test.ts`; this closes the route-level coverage story.

**Action**: add a test in `services/api-gateway/src/routes/admin/llm-config.test.ts` asserting that an admin create with `model: z-ai/glm-5.2` succeeds (mirrors the user-route `should save a z.ai-only model` test). ~15 min.
