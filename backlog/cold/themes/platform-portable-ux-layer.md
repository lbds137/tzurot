### Theme: Platform-Portable UX Layer (Discord Design System)

_Focus: lift the bot's UI + messaging vocabulary to the same standardized, declarative level the routing layer already has — encode UX **intent** separately from its Discord expression, so the experience is consistent **by construction** (not reconciled by periodic audits) and portable to other platforms via adapters._

**Design artifact (ACCEPTED 2026-07-04, boulder #1 session)**: [`docs/proposals/backlog/platform-portable-ux-design.md`](../../../docs/proposals/backlog/platform-portable-ux-design.md) — grounded on a 3-agent code sweep, council-passed (GLM 5.2 + Kimi K2.7), all open calls decided by owner. **The artifact governs**: architecture (§4), phasing (§5 — supersedes the sketch that used to live here), and decisions (§6, incl. multi-tag all-failed → each errored persona replies its own in-character error line). Implementation phases pull from it.

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

_Audit detail: 5 Explore-agent reports (2026-06-28) distilled above; re-grounded 2026-07-04 by a 3-agent code sweep (deltas: 9 modal sites not 8; 3 button-order violations incl. one in shared `destructiveConfirmation.ts`; generation-path errors already in-character via webhook — the "100% system-voiced" audit row was wrong for that path; three parallel custom-ID conventions)._
