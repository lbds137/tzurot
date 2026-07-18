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
| PR-1b (#1698) | `createComponentRouter` primitive (ordered table, kind-aware match, acked unrouted fallback) + memory chain adopted + purge/account-delete onto Tier-B (wire-contract phrases via override; 2 duplicate invoker-guards + 4 raw splits retired; retired prefixes out of componentPrefixes; incidental fix: purge's uncapped modal label threw on long names) | ✅ MERGED 2026-07-17 (clean review, "looks ready") |
| PR-2 (#1700) | `utils/browse/listEmbedBuilder.ts` — §2.4 row grammar (absolute numbering shares the select menu's slice math — the drift class dies), §2.1 titles (`🎭 Characters` / `⚙️ Presets`), D19 empty states, word-first legends; character+preset adopted; **filter-row builder CUT** (no browse hand-builds filter buttons — plan target didn't exist in code); r2 caught a real stacked-empty-state regression (fixed + pinned); preamble/header blank line locked as intentional | ✅ MERGED 2026-07-18 (3 rounds) |
| PR-3a (#1701) | alias tiers: migration (`user_id` nullable FK, lower() partial uniques on the normalized form, per-scope uuid seeds, grandfathered globals) + two-lookup resolver (personal→global, access filter each step, `resolveAliasUserUuid` separate from the bot-owner bypass) + PGLite invariant component test | ✅ MERGED 2026-07-18 (2 rounds; r2 full-pass "no blocking issues" — verified fallthrough, cache isolation, migration safety); dev migration applied |
| PR-3b (#1702) | alias tier gateway CRUD + policy: visibility-gated verbs (invisible==missing==404), bot-owner-only global writes, user-scoped default (`scope` defaults 'user' so the transitional #1695 UI writes personal rows), list widens edit→visibility (global + caller's own only, truncated flag), per-tier shadow checks + soft caps (25), my-aliases endpoint (batched include, per-caller shadowed marking), reverse-shadow `shadowedAliases` warn-don't-block + shared ⚠️ advisory sender (`CATALOG.info.warning`); **#1701 ride-alongs shipped**: single user-lookup resolver (seam-pinned) + scope-union collapse; codegen `z.input` request bodies (defaults optional at call sites); identity mutation floor re-cleared with 2 mutant-killer tests (77.25→78.24) | ✅ MERGED 2026-07-18 (2 rounds; r2 "none of these block merge" — traced the auth model + all three resolver paths; 3 minors → 2 follow-up rows filed, 1 dismissed on merits) |

_**Owner design call (2026-07-18): in-place filter controls ADOPTED** — spec §3.1's "filter/sort where applicable," previously unbuilt; scope calls in this epic run through the DESIGN lens ("would it improve the experience?"), not just the dedup lens. Toggle buttons for ≤3-value filters (sort-toggle pattern); multi-dimensional (preset scope × capability) likely a filter select — decide once at PR-4b. **PR-4 pilots the first filter toggle on the alias browse; PR-4b extracts `filterRowBuilder` from that real usage and generalizes** (character, deny, memory facts, models)._

_PR-4b scope additions (from #1700 r3 observations): fix the pre-existing double-blank-line edge (own-empty + others-present — CTA's trailing blank + builder separator stack; add the missing regression test for that combo) · consider a builder pre-flight (`totalPages`/`safePage`) if a third preamble-needs-pagination consumer appears · evaluate splitting the over-budget browse files (character 540 / preset 538 vs the 400 max-lines rule) while the sweep restructures them._

_PR-7 scope additions (from #1698 review observations): settings' third hand-rolled chain joins the character-chain router migration (fixes its pre-existing no-ack fallthrough by construction); revisit `DestructiveCustomIds.parse`'s action cast only if an exhaustiveness-assuming switch consumer appears._
