# Active Epic — Detailed Log

_Per-PR slice detail for the current Active Focus (see [`../active-epic.md`](../active-epic.md)). Reset when the active epic/sweep changes — completed epics' logs live in git history (Memory System Overhaul's log: git history at the 2026-07-17 park; its state summary is in [`themes/memory-system-overhaul.md`](themes/memory-system-overhaul.md))._

## Platform-Portable UX Layer (Active Epic)

_Governing artifacts: `docs/proposals/backlog/ux-design-system-spec.md` + `platform-portable-ux-design.md`. Roadmap in `active-epic.md`._

### Phase 1 — catalog + voice ✅ COMPLETE (2026-07-07 → 2026-07-08, ten-PR train)

Implementation plan council-passed 2026-07-07 (GLM 5.2 · Kimi K2.7-code · Qwen 3.7 Max). Ratchet: **448 → 92** raw literals (`pnpm ops ux:literals`, −79%); residual 92 are documented exemption classes (embed titles/status-glyphs, operator diagnostic surfaces, doc-comment glyphs — none user-error copy). Every user-facing gateway-error surface routes through the honest-outcome classifier; multi-tag all-errored delivers each character in its own voice.

| PR | Scope | Status |
| --- | --- | --- |
| A (#1550) | `ux/catalog/` + `ux/render/` + total classifier + `ux:literals` ratchet (audit-class) + depcruise boundary + pilot consumers (CommandHandler catch-alls, saveError adapter) | ✅ MERGED |
| B (#1551) | `DASHBOARD_MESSAGES`→catalog, `replyError`→`replyContent` delegate, `DashboardUpdateError` + `extractApiErrorMessage` retired, dead `commandHelpers` deleted, PersonalityMessageHandler raw-leak FIXED, classifier `failedAction` override | ✅ MERGED |
| C (#1552) | Shape-B wrappers → nullOn404 honest-absence contracts; classifier `operation: 'read'` axis; `followUpSpec` (deferUpdate clobber guard); list-collapse class exempted w/ follow-ups row | ✅ MERGED |
| D1 (#1554) | Character family sweep; read/write-phase catch split; saveCharacter fail-arm preserved; ratchet 441→370 | ✅ MERGED |
| D2 (#1555) | Persona/preset families + character stragglers (~73 sites); notFound `hint` option; ratchet 370→269 | ✅ MERGED |
| D3a (#1557) | Memory family (9 files); read/write catch split; batchDelete/purge-handshake thrown-write gaps filed; ratchet 269→208 | ✅ MERGED |
| D3b (#1558) | Settings family; apikey rich-errors → per-status severity; ratchet 208→193 | ✅ MERGED |
| D3c (#1559) | shapes/channel/voice families (12 files); markdown-injection-via-slug closed; ratchet 193→153 | ✅ MERGED |
| D3d (#1560) | admin/models/history/help/deny families (~17 files); markdown-escaping + presence Redis-failure coverage; ratchet 153→92 | ✅ MERGED |
| E (#1561) | `SlotOutcome` discriminated union; all-errored → per-persona in-character delivery; `deliverErrorNoPersist` + shared `buildSyntheticErrorResult` | ✅ MERGED |

### Phase 2 — components (IN PROGRESS)

_Plan approved 2026-07-17 (`~/.claude/plans/radiant-tickling-candle.md`; 3-agent grounding + trio council; owner calls: bot-owner-only globals · warn-don't-block reverse shadow · names-first resolution + shadowed badge). Pilot = `/character alias` redesign + scoping tiers._

| Slice | What | Status |
| --- | --- | --- |
| PR-1a (#1697) | `utils/confirmation/` Tier-A + Tier-B factories (Cancel→Danger factory-owned; invoker ownership via `interactionMetadata`, not customId bytes — r1 caught the snowflake segment overflowing the 100-char customId budget; modal customId DERIVED from button customId); **fixed live bug**: `/voice voices clear` modal routed to /settings via config-rebuild (`source: 'settings'`), typed confirmation silently dropped; 4 button-order violations fixed; history+voice migrated; batchDelete buttons from Tier-A; dynamic `DELETE {NAME}` phrases (cap 39, label-consistent); mismatch echo markdown-escaped (r2) | ✅ MERGED 2026-07-17 (3 review rounds; r3 "nothing blocks merge") |
| PR-1b | `createComponentRouter` primitive + memory prefix-chain adoption + purge/account-delete onto Tier-B (wire-contract phrases via override; duplicate `assertInvokerOwnership` copies retire) | NEXT |
