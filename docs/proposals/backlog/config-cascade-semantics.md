# Config Cascade Semantics — Design

> **Status**: ACCEPTED 2026-07-05 (config-cascade boulder) — trio council pass unanimous on all calls, riders folded (§8); owner sign-off 2026-07-05
> **Supersedes/extends**: [`config-cascade-design.md`](config-cascade-design.md) (Phase 1–2 shipped, incl. a channel tier the doc predates; its Phases 3–5 fold into §5 here) · anchors the [`preset-cascade-standardization`](../../../backlog/cold/themes/preset-cascade-standardization.md) theme
> **Owner directives**: server/community as a config tier (2026-07-05 — per-server settings don't exist at all today); off-vs-inherit; resolver priority; profiles-vs-presets.
> **Grounding** (2026-07-05): 2-agent sweep — cascade-as-implemented (resolver order, sentinel pipeline, setting-family table, pain points incl. the 2026-02 post-mortem lineage) + preset-entity landscape (two-cascade reality, profiles proposal, guild raw material, invalidation pattern).

## 1. The system as it actually is

**Two deliberate, parallel cascades** feed every generation:

- **System A — field-merge** (`ConfigCascadeResolver`): 11 JSONB overlay fields, merged `hardcoded → admin → personality → channel → user-default → user×character` (six levels; the channel tier shipped after the old proposal was written). Per-field source tracking exists.
- **System B — row-select** (`LlmConfig`/`TtsConfig`/Vision/STT resolvers): first-match-wins preset pointers, `user×character → user-default → personality` with admin/free defaults via `AdminSettings` pointer columns (guest handling in AuthStep). No admin/channel tier in the waterfall itself.

The split is intentional and code-documented; the old proposal's `llmOverrides` bridge (inline param tweaks atop a preset) was never built. **This design keeps the split** (reaffirmed) — presets pick *what model rig*, the cascade tunes *how the conversation behaves*.

**The sentinel reality**: inheritance is encoded purely by JSONB key **absence**; the write path strips nulls. Booleans survive ("off" = stored `false`), but `maxAge`'s UI "off" (-1) collapses to null → stripped → **silently means "inherit"** — masked today only because the hardcoded default is also null. `TRI_STATE_PATTERN.md` documents a *different, older* mechanism (typed `Boolean?` columns) — doc and mechanism have split.

## 2. Decisions

### D1. Sentinel semantics: absence = inherit, stored null = explicit OFF

Keep absence-as-inherit (it's the JSONB overlay's natural grammar and booleans already work). Add the missing third state by **storing explicit `null` for fields whose domain has an OFF meaning**, instead of stripping it:

| Field class | Inherit | Explicit value | Explicit OFF |
| --- | --- | --- | --- |
| Booleans (5) | key absent | `true`/`false` | `false` IS off — already correct |
| `maxAge` | key absent | seconds | **stored `null`** (= no age limit, terminal — stops falling through) |
| Zero-min numerics (`maxImages`, `memoryLimit`) | key absent | n | `0` IS off — already correct |
| Enums (`voiceResponseMode`) | key absent | value | `'never'` IS off — already correct |

Mechanics, council-hardened: `mergeConfigOverrides` distinguishes *clear this key* (delete) from *set null* (persist); **`NULL_TERMINAL_FIELDS` registry** (today: `{maxAge}`) with a zod refinement rejecting null on every other field + a test asserting the registry matches the schema's nullable set — null-as-OFF is a per-field contract, enforced, not a convention; **the wire contract is explicit** — IMPLEMENTATION AMENDMENT (Phase 0, 2026-07-05): `null` on the wire keeps its pre-existing meaning of "clear this override" for EVERY field (all five dashboards already used it that way); OFF travels as `CONFIG_WIRE_OFF` (`-1`, the value the duration UI already produced) and the gateway merge maps it to stored `null`. The council draft's null-on-wire-as-OFF would have collided with the established clear signal — same ambiguity, new layer; the sentinel resolves it with zero client-contract breakage with an **HTTP-boundary integration test** proving null survives transport (the failure surface is serializers, not the resolver); the **hardcoded `maxAge` default is pinned to `null` with a comment + test** — legacy rows whose "off" was silently stripped are unrecoverable-intent (documented breaking change), and pinning the default guarantees the latent landmine can't detonate; resolution treats stored null as terminal. The dashboard vocabulary standardizes as **inherit / value / off** per field (off shown only where the domain has one) with **per-field source indicators** ("your override" / "channel" / "server" / "character default" / "global") — the prior proposal's Phase-4 promise, now cheap because `sources` tracking already exists. `TRI_STATE_PATTERN.md` gets rewritten to describe THIS mechanism (the typed-column pattern it documents survives only in legacy fields).

**Why not a tagged union in storage** (`{kind:'off'}`): heavier migration, breaks `.strip()` schema hygiene, and null-as-off matches the one field that needs it; if a future field needs OFF distinct from a meaningful null, revisit then (no such field exists in the 11).

### D2. The guild tier: `… → personality → GUILD → channel → …`

New `GuildSettings` model mirroring `ChannelSettings` (`guildId` unique, `configOverrides` JSONB, `createdBy`), slotting between personality and channel:

```
hardcoded → admin → personality → GUILD → channel → user-default → user×character
```

Rationale (council-corrected wording): **place-over-creator, and USER tiers remain supreme** — channel (a place) already beats personality (creator defaults); guild is a broader place, so it slots below channel by specificity. This is a **binding override tier, not a fallback** — document it as such. The **DM/server behavioral split is intentional and documented**: the same character + user resolve differently in a server (its norms apply) vs a DM (no place tiers) — that's the feature, not an accident. `AdminSettings` remains the global bot-owner singleton (one bot, one admin tier — NOT per-guild; the guild tier is the per-guild thing).

- **Who writes it**: server managers (Discord Manage Server permission) via `/server settings` (Discord's user-facing word is "server", not "guild"); a new `DashboardLevel: 'guild'` per the boulder-#1 design system (pagination-by-concern applies — it's the same 11 settings).
- **All 11 settings exposed** (mirror the channel dashboard exactly; `voiceTranscriptionEnabled` stays admin-only as today).
- **Invalidation (council-corrected — NOT the channel playbook verbatim)**: guild invalidation is **1:N**, not 1:1 — a guild-settings change must invalidate every cached resolution whose channel belongs to that guild, including channels holding their own overrides (they inherit the non-overridden fields). Design: the cache key gains a guild component (`userId|personalityId|channelId|guildId`) so `invalidateGuildCache(guildId)` position-matches directly — no guild→channels query, no under-invalidation. `'guild'` event on `ConfigCascadeCacheInvalidationService`; route publishes on write; multi-field edits publish once (the dashboard already batches per save).
- **ResolutionContext, explicit (council)**: `resolveOverrides` takes `guildId: string | null` threaded from the job envelope/interaction (null = DM or unknown → tier skipped; a guildId whose settings row doesn't exist → tier contributes nothing). No inference, no flags.
- **Audit minimum (council, all three)**: `GuildSettings` carries `updatedBy` + `updatedAt` — server-wide edits are the first tier where "who changed the norm" is a question someone will actually ask. History table deferred (trigger: a real dispute).
- **Per-tier write enforcement (council)**: admin-only fields (`voiceTranscriptionEnabled`) are excluded from non-admin tier writes **at the route/schema layer**, not just hidden in the UI — a per-tier writable-fields filter.
- **The System-B gap is communicated, not discovered**: `/server settings` states plainly that server-wide model/TTS defaults aren't a thing yet ("presets are per-user; server default model is a later phase") — otherwise the most-expected server setting is the one missing, unexplained.
- **DMs**: no guild → tier skipped (same as channel today).
- **NOT in v1**: guild-tier *preset* pointers (System B stays untouched; named trigger: a server community actually asks for a server default model — one demand signal already on record: a user asked why their chosen model did not apply to everyone in the server, ingested 2026-07-05 from the notes cleanup) and **policy clamps** (a guild *cap* that binds even user tiers). Clamps are a second AXIS (bounds, not precedence) requiring a post-resolution clamp pass — council consensus: when the trigger fires (first genuine moderation/cost-control need), it's a **design session of its own**, not a small follow-up; noting that here prevents under-scoping later.

### D3. Resolver priority: keep user-default above personality-default

The April-2026 council-flagged question, now decided: **both systems today already resolve user-default > personality-default, consistently — keep it.** Rationale: a user's explicit default is a deliberate act ("I always want X"); the personality default serves users who chose nothing. Flipping it would make a creator's defaults silently override a user's stated preference on every character they meet — surprising in exactly the wrong direction. The real gap the April discussion pointed at is *visibility*, not order: D1's source indicators make "why is this value in effect" legible, which dissolves most priority confusion.

### D4. Profiles vs presets: layer, never replace

Settled semantically here; built under the model-configuration-overhaul theme. A **profile is a container referencing presets** (v1 shape per that theme: paid preset + free-fallback preset + auto-switch on quota); a **preset stays the atom** (one model + params). Cascade pointers (System B) may eventually point at profile-or-preset; resolution flattens profile→preset at invocation time given quota state. Nothing about System A changes. The unbuilt `llmOverrides` bridge stays unbuilt — the "one-off temperature tweak atop a preset" use case is served by cloning a preset today and by profiles later; adding a third place where sampling params can come from would blur the two-cascade boundary that keeps this system comprehensible.

### D5. Integrity riders (ordered first)

- **RouteDeps footgun**: `cascadeResolver`/`llmConfigResolver` become **required** in `RouteDeps`; the read endpoints that construct detached local resolvers (un-invalidated — a stale-cache bug waiting for traffic) switch to the injected singletons. (Existing follow-up row, promoted into this design's Phase 0.)
- **Legacy shape cleanup**: the stale 3-field `ResolvedExtendedContextSettings` doc-shapes reconciled to the 11-field reality; dead LlmConfig columns remain the queued legacy-column Phase-A DROP (referenced, not duplicated).
- The preset cascade's missing **character-tier pin UX** (theme item 1 — creators can't pin a default preset since #853) ships with this boulder's UX phase, including the shapes-import "set by import" provenance note.

### D6. The "field #12" checklist (council — this is how the next sentinel bug arrives otherwise)

Adding a cascade field requires deciding, in one place: OFF domain (and `NULL_TERMINAL_FIELDS` membership), tier writability (admin-only?), dashboard family + tri-state vocabulary, hardcoded default, and source-indicator label. The checklist lives next to `ConfigOverridesSchema` as a doc-comment; the registry tests make skipping it loud.

### D7. Explain surface

Per-field source tracking already exists; expose it: the `/inspect` Config view (boulder-#1 spec already adds one) gains the resolved cascade with per-field winning tier — "why did the bot do that" answered from data we already compute. Cheap; Phase 2.

## 3. What this deliberately does NOT do

Unify the two cascades (the split is the architecture, not a bug) · guild presets or clamps in v1 (named triggers) · migrate env vars to admin settings (separate ideas-entry; the cascade is ready to receive them whenever) · touch memory-pool scoping (boulder #3 owns social memory scoping — config tiers and memory pools share the guild axis but are different systems) · rebuild dashboards beyond the design-system patterns already specced.

## 4. Schema sketch

```prisma
model GuildSettings {
  id              String   @id @default(uuid())
  guildId         String   @unique @db.VarChar(20)
  /// Config cascade overrides (guild tier — between personality and channel).
  /// Null means no guild-level overrides set.
  configOverrides Json?    @map("config_overrides")
  createdBy       String   @db.VarChar(20)
  /// Last editor (Discord user id) — server-wide edits need attribution (council).
  updatedBy       String   @db.VarChar(20)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  @@map("guild_settings")
}
```

Additive migration; no data backfill. `ConfigOverrideSource` + `DashboardLevel` gain `'guild'`; `resolveOverrides` gains `guildId?` (threaded from the job envelope, which already carries it).

## 5. Phasing

| Phase | Contents | Notes |
| --- | --- | --- |
| **0 — sentinel + integrity** | D1 storage semantics + `NULL_TERMINAL_FIELDS` registry/refinement + HTTP-boundary null-transport test + UI `-1`→`null` force-cut + pinned-null-default test + maxAge end-to-end fix; RouteDeps required + detached-resolver cleanup; TRI_STATE_PATTERN.md rewrite | Fixes the live semantics bug (at BOTH the storage and wire layers) before adding a tier that would inherit it |
| **1 — guild tier** | GuildSettings model (+updatedBy/updatedAt) + resolver tier + ResolutionContext threading + 4-part cache key + 1:N-correct 'guild' invalidation + per-tier writable-fields filter + `/server settings` dashboard (Manage Server-gated, System-B gap stated) | The channel-tier pattern, corrected for guild's fan-out |
| **2 — cascade UX completion** | Per-field source indicators (inherit/value/off vocabulary) across all six dashboards; `/inspect` cascade-explain view (D7); character-tier preset pin section on `/character edit` + shapes provenance note | Discharges the theme's items 1–2 + prior Phase 4 |
| **3+ (triggered)** | Guild presets (trigger: real demand) · policy clamps (trigger: moderation/cost need) · profiles (owned by model-configuration-overhaul theme) · env-var migration (ideas entry) | |

## 6. Absorption map (at landing)

`preset-cascade-standardization` theme → items 1–3 + the off-vs-inherit folded item discharged into this doc (theme keeps its smaller folded UX items); `config-cascade-design.md` → superseded-by note (its unshipped Phase 2.5 `MAX_REFERENCED_MESSAGES` unification and Phase 3/5 items get dispositions: 2.5 carried as a Phase-0 candidate rider, 3 = the queued column DROP, 5 = D1 covers focusMode placement already-shipped); follow-ups → RouteDeps row discharged (Phase 0); `now.md` → board updates.

## 7. Open calls (council agenda → owner)

1. **Guild placement** — personality → GUILD → channel (recommended; place-over-creator precedent) vs below personality (creator defaults beat server norms).
2. **D1 mechanism** — stored-null-as-OFF (recommended) vs tagged unions vs stop-stripping-everything.
3. **Priority** — keep user-default > personality-default (recommended, both systems consistent today).
4. **Profiles** — layer-never-replace semantic (recommended) vs merge into presets.
5. **`/server settings` naming + Manage Server gating** (recommended) vs owner-only v1.
6. **Clamp axis** — defer with trigger (recommended) vs design now.
