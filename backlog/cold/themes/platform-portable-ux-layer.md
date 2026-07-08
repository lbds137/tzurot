### Theme: Platform-Portable UX Layer (Discord Design System)

_Focus: lift the bot's UI + messaging vocabulary to the same standardized, declarative level the routing layer already has — encode UX **intent** separately from its Discord expression, so the experience is consistent **by construction** (not reconciled by periodic audits) and portable to other platforms via adapters._

**Design artifacts (both ACCEPTED 2026-07-04, boulder #1 session)** — two docs, one system:

1. [`docs/proposals/backlog/ux-design-system-spec.md`](../../../docs/proposals/backlog/ux-design-system-spec.md) — **the WHAT** (normative design system): tokens (entity emojis, badge glossary + collision rule, colors, list grammar, sentinels/timestamps), components (browse/detail/dashboard/modals/outcome/pending states, expand mechanism, button vocabulary), command grammar (verb table, option conventions, IA moves incl. `/settings preset`→`/preset override`, `/deny` modal-form redesign), discoverability (picker hiding, description style, context-menu Inspect), `/inspect` + owner-surface dispositions. Full-trio council pass (GLM 5.2 · Kimi K2.7 · Qwen 3.7 Max); all 21 decisions adopted.
2. [`docs/proposals/backlog/platform-portable-ux-design.md`](../../../docs/proposals/backlog/platform-portable-ux-design.md) — **the HOW** (machinery): message catalog + outcome-honesty classifier, builder consolidation, enforcement (ESLint rules, ratchet, depcruise boundary), phasing. The spec's §9 maps every normative decision onto these phases.

Implementation phases pull from the spec via the machinery doc. Key owner decisions on record: multi-tag all-failed → each errored persona replies its own in-character error line; owner/admin surfaces are first-class UX; emoji criterion = obvious to the lowest common denominator.

**Consolidates / supersedes**: the two `cold/ideas.md` entries — "Platform Abstraction Layer — decouple UX from Discord" and "Slash command architecture redesign `[TRIAGE-NEEDED]`" — plus the 2025-12 proposal `SLASH_COMMAND_ARCHITECTURE.md` (triaged shipped/superseded/dead in the artifact's §2, tier table mined into §4.1; file deleted 2026-07-04, git preserves it). Promoted from idea → theme 2026-06-28 after a 5-dimension UX audit gave it a concrete requirements base.

**Why now (user framing, 2026-06-28)**: "we have inconsistent experiences in places and it bothers me, and periodic audits aren't enough to reconcile. We need bigger building blocks and standard ways of creating slash command UX… an independent layer representing our UX that could easily be ported to other platforms." Key insight from the prior 2026-04-13 investigation: **the design-system problem and the portability problem are the same problem** — a DSL that eliminates per-command boilerplate must encode the UX intent above Discord.js, which is exactly what a cross-platform adapter layer needs.

#### The core finding — the surface is bimodal (5-dimension audit, 2026-06-28)

| Layer | Standardization | Evidence |
| --- | --- | --- |
| **Routing / structure** | ~90–100% | `defineCommand` 14/14; subcommand routers 12/14; `::` custom-ID delimiter 100%; button label/emoji separation 100%; `DISCORD_COLORS` 100% (zero hardcoded hex); browse-select factory 10/10; dashboard CRUD builders for all CRUD flows; deferral/ack rule — **no violations** (enforced by context typing) |
| **UI components** | ~35% | embeds ~33% shared, buttons ~43%, **modals ~24%**, action-rows ~43%. ~280 hand-built vs ~150 framework-backed Discord.js calls |
| **Messaging** | scattered | 60+ files with inline error/info literals; emoji + wording inconsistent; **100% system-voiced** (zero in-character) |

The routing "DSL nucleus" is solid; the **UI + messaging vocabulary is the haphazard part**. The design system's job is to lift those two layers to where routing already sits.

#### Catalogued inconsistencies (requirements input)

**A. Command vocabulary**
- Verb drift: `remove` (deny) vs `delete` (memory) for the same shape; `clear` overloaded across destructive (history/memory) AND non-destructive (settings/voice) actions.
- Option-name drift: `query` (4 browse cmds) vs `search` (memory subcommand) for the same operation; `kind` vs `type` overloaded across unrelated domains; character/personality/persona triad.
- Choice-sets duplicated inline (filter sets, timeframes) — `deny/index.ts` extracts them to consts (the exemplar); others inline.

**B. Components**
- Buttons: label/emoji separation 100% ✓, but **button ORDER is documented-not-enforced** → 2 live violations (`memory/batchDelete.ts`, `memory/purge.ts` place the Danger button before Cancel).
- Embeds: `DISCORD_COLORS` 100% ✓; **emoji-title-prefix inconsistent** (some titles have it, some don't — no rule); ~67% of embeds hand-built (no shared **detail-card** builder for non-dashboard detail views).
- **Modals: 24% adoption — the single biggest dedup.** 8 commands hand-roll the SAME ~50-line `ModalBuilder`+`TextInputBuilder` loop (~400 LOC) despite `ModalFactory` existing.
- Select menus: 100% shared `buildBrowseSelectMenu` ✓.

**C. Flows**
- Deferral/ack ✓ consistent; ephemerality ✓ mostly consistent (enforced by `DeferredCommandContext` typing).
- Confirmation: **two patterns, no middle ground** — simple 2-button (preset/persona delete) vs typed-phrase 3-step (memory purge / history hard-delete) — plus inconsistent phrase format (`DELETE X MEMORIES` vs fixed `DELETE`) and divergent modal-error handling.

**D. Messaging** (also feeds the standing **in-character error delivery** directive — see `cold/ideas.md`)
- Emoji prefixes: `❌` dominant but variants exist (`⏳` vs `⌛`; a few Unicode-variant `❌`); no enforced map.
- Wording: "try again" vs "try again later" vs "An error occurred" — no rule distinguishing user-error (retry) from infra (retry later).
- **100% system-voiced.** ~9 transient/infra error sites (gateway timeouts, cache loads, provider fetch) are the prime in-character-delivery candidates.
- Centralized helpers exist (`DASHBOARD_MESSAGES`, `replyError`, `commandHelpers`) but 60+ inline-literal sites bypass them. No single message catalog.

#### Design-system requirements (priority order)

1. **Message catalog + vocabulary** — centralize user-facing strings as **intent-based** entries (`error.notFound`, `error.transient`, `success.saved`, …) with enforced emoji + wording rules. This is the keystone: an intent catalog is simultaneously (a) the consistency fix, (b) the seam for **in-character delivery** (render an intent through the persona), and (c) the seam for **platform portability** (render an intent per-platform). Satisfies the standing in-character-errors directive.
2. **Modal factory adoption** — retire the 8 hand-rolled modal loops onto `ModalFactory` (~400 → ~80 LOC); biggest single dedup.
3. **Detail-card embed builder** — a shared builder for non-dashboard detail embeds (~67% hand-built today).
4. **Confirmation hierarchy** — define tiers (simple-confirm vs typed-phrase), one shared util, consistent phrase format.
5. **Command vocabulary constants** — verb taxonomy (delete vs remove vs clear), shared choice-sets, query/search/filter naming.
6. **Enforcement** — button-order + adoption are documented-not-enforced (hence the 2 live violations). A lint/guard makes consistency structural — **the direct answer to "periodic audits aren't enough."**

#### The portability angle

Both the in-character directive and platform portability resolve at the same seam: if commands emit **intent** (a message intent, a component intent) instead of raw Discord.js trees + literal strings, then "how Discord renders it," "how the persona voices it," and "how a web UI / Revolt adapter renders it" all become pluggable renderers. The ~40–50% irreducible Discord.js surface IS the adapter boundary. So the real open call isn't "is CPD low enough" — it's "how thin an abstraction, and how seriously do we pursue portability now."

#### Phasing + design calls — RESOLVED, see the artifact

Phase 0 (triage + design) completed 2026-07-04. The phase plan now lives in the artifact's §5 (1: catalog + voice · 2: components · 3: vocabulary + enforcement · 4: adapter, trigger-gated); every open design call is decided in its §6. Do not re-derive here — plan-mode for each phase starts from the artifact.

#### Phase 1 — IN PROGRESS (started 2026-07-07, five-PR train)

Implementation plan council-passed 2026-07-07 (GLM 5.2 · Kimi K2.7-code · Qwen 3.7 Max; record in the PR-A body + plan file). Ratchet baseline at start: **448** raw literals (`pnpm ops ux:literals`).

| PR | Scope | Status |
| --- | --- | --- |
| A (#1550) | `ux/catalog/` + `ux/render/` + total classifier + `ux:literals` ratchet (audit-class) + depcruise boundary + pilot consumers (CommandHandler catch-alls, saveError adapter) | ✅ MERGED |
| B (#1551) | `DASHBOARD_MESSAGES`→catalog, `replyError`→`replyContent` delegate, `DashboardUpdateError` + `extractApiErrorMessage` retired, dead `commandHelpers` deleted, PersonalityMessageHandler raw-leak FIXED, classifier `failedAction` override | ✅ MERGED |
| C (#1552) | Shape-B wrappers → nullOn404 honest-absence contracts; classifier `operation: 'read'` axis; `followUpSpec` (deferUpdate clobber guard); list-collapse class exempted w/ follow-ups row | ✅ MERGED |
| D1 (#1554) | Character family sweep (avatar/voice/view/export/create/import/dashboardShared); read/write-phase catch split; saveCharacter fail-arm preserved; ratchet 441→370 | ✅ MERGED |
| D2 | Remaining character files (browse/chat/dashboard/randomPick/edit) + persona + preset families; riders: plain-Error kind-loss follow-up, split-helper threshold | Next |
| D3 | memory/settings/shapes/channel/admin/models families | Pending |
| E | `SlotOutcome` discriminated union, per-persona multi-tag canned error delivery, STT/MessageHandler/truncation wording, in-character upgrade | Pending |

_Audit detail: 5 Explore-agent reports (2026-06-28) distilled above; re-grounded 2026-07-04 by a 3-agent code sweep (deltas: 9 modal sites not 8; 3 button-order violations incl. one in shared `destructiveConfirmation.ts`; generation-path errors already in-character via webhook — the "100% system-voiced" audit row was wrong for that path; three parallel custom-ID conventions)._
