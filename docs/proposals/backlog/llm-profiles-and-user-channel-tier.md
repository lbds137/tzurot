# LLM Profiles (Quota Fallback) + User-Channel Tier — Design

> **Status**: ACCEPTED 2026-07-05 — trio council unanimous on all five calls, riders folded (§6); owner sign-off 2026-07-05
> **Theme**: [`model-configuration-overhaul.md`](../../backlog/cold/themes/model-configuration-overhaul.md) (both items) · Semantics anchor: [`config-cascade-semantics.md`](config-cascade-semantics.md) D4 (profiles layer, never replace — settled)
> **Owner directives on record**: tier-aware fallback (paid/BYOK users fall back to the PAID global default; only free/guest users land on the free default — `follow-ups` log-verified gap) · vision NOT bundled into profiles (decided 2026-06-26; the `kind` axis stays parallel)
> **Grounding** (2026-07-05): quota/402 runtime sweep (classification, caches, what-the-user-sees, the no-text-fallback fact) + preset UX surface map + piggyback-proposal interaction + user-channel raw material (no `(userId, channelId)` table exists; `UserPersonalityConfig` is the exact precedent; the cascade cache key already carries both dimensions).

## 1. The system as it is (verified)

A 402 today is **terminal**: classified (QUOTA_EXCEEDED / CREDIT_EXHAUSTION), never retried (PERMANENT), cached (per-account credit exhaustion; per-`(cacheKeyId, model)` rate limits) so the *next* attempt fails faster — and the user gets a top-up message mid-conversation. **No text model-fallback exists** (the only shipped analogs: same-model transient retries; z.ai→OpenRouter provider swap keeping the model; the vision fallback chain — the in-repo blueprint). "Preset" IS an `LlmConfig` row; the selection cascade is user×character → user-default → personality, with admin global/free pointer columns. The piggyback proposal's fairness allocator (owner-first headroom, per-user sliding windows, degrade-don't-error) gates *shared-key capacity*; it does not choose models.

## 2. Decisions

### D1. A "profile" is a preset WITH a fallback edge — no new entity

The theme imagined a container entity bundling paid+free presets. The lighter shape that delivers the same UX: **one nullable self-relation on `llm_configs`** —

```prisma
/// Quota-fallback target: when generation with THIS preset fails on a quota
/// category (or is short-circuited by the exhaustion caches), resolution
/// retargets to this preset instead of failing the turn. Null = use the
/// tier-aware default chain (D2). One hop only — the fallback's own pointer
/// is never read. Integrity (council, 3×): CHECK (fallback_config_id != id);
/// ON DELETE SET NULL (degrades to the null-branch default chain) with a
/// dashboard indicator on presets whose fallback was nulled by a deletion.
fallbackConfigId String? @map("fallback_config_id")
```

Users keep picking presets everywhere they do today (zero churn across the two-level default system, slots, guest gating); a preset that carries a fallback *is* the theme's "profile". The dashboard gains one field ("Fallback preset", preset-autocomplete). Rejected: a separate `llm_profiles` container — it adds a second nameable entity, a second browse surface, and pointer-migration ceremony for what is semantically one edge. Revisit only if profiles ever need to bundle MORE than the fallback edge (e.g. per-purpose param sets — no demand on record).

### D2. The switching layer: tier-aware, resolution-time first

Two firing points, same target logic:

- **Proactive (resolution-time)**: at model stamping, consult the existing caches (`CreditExhaustionCache` per account, `RateLimitCache` per model) — if the resolved preset's attempt is already known-doomed for this `cacheKeyId`, retarget NOW and skip the doomed round-trip. This is pure read of infrastructure PR #587 already built.
- **Reactive (failure-time)**: on a fresh QUOTA_EXCEEDED / CREDIT_EXHAUSTION from generation, one in-turn retarget + retry (never re-billing side effects; the agentic design's tools-never-re-bill constraint is honored because v1 fallback happens before tools exist in the loop).

**Target selection** (council-hardened — tier ALWAYS wins; the edge is a hint, not an override):
1. The failing preset's explicit `fallbackConfigId` — **tier-filtered**: skipped when the target isn't accessible to the requesting user's tier (a guest never lands on a paid target; a BYOK user's target must honor the paid-default directive) or is itself known-doomed.
2. Else the **tier-aware default**: BYOK/paid user → `AdminSettings.globalDefaultLlmConfig`; guest/free user → `freeDefaultLlmConfig`.
3. Else (target also doomed / missing): today's terminal error, unchanged.

**Trigger matrix (council, 2×independent)** — classification decides whether retargeting can even help:

| Failure | Retarget? |
| --- | --- |
| `CREDIT_EXHAUSTION` (account-level) | Only when the fallback target uses a **different billing entity** (BYOK key exhausted → system-key-backed default ✓; another preset on the same key ✗ — futile, straight to terminal) |
| `QUOTA_EXCEEDED` / rate-limit (model-scoped) | Yes — a different model has its own headroom |
| Anything transient | No — same-model retries own it (unchanged) |

Mid-stream coherence is a non-issue by architecture: delivery is completion-only (streaming deliberately deprioritized), so a retarget never splices partial outputs. **Params contract**: the fallback preset runs with its OWN sampling params (it was configured coherently for its model; the primary's params may not transfer), while the System-A behavior cascade (memory/context/display settings) is untouched — it never depended on preset selection. One hop, hard-stopped in the resolver (the target's own `fallbackConfigId` is never read; the dashboard says so). **Announced, never silent**: the footer names both ("⟨primary⟩ → ⟨fallback⟩ — out of credit"), and every fire emits a structured audit event (requestId, from/to, classification, proactive-vs-reactive) so "why did I get the free model" is answerable from logs.

**Viability seam**: one predicate — `isViable(targetConfig, cacheKeyId)` — wraps the exhaustion/rate caches today and is where the piggyback allocator's capacity check joins when it ships (the allocator decides *whether* shared capacity exists; this design decides *which model*). **Cache freshness**: the exhaustion/rate caches already carry TTLs (bounded staleness); Phase 0 adds the missing recovery edge — setting/updating a wallet key clears that account's exhaustion entry (piggybacks on the existing ApiKey invalidation event), so a top-up isn't stranded behind a stale doom-cache.

### D3. User-channel tier: `UserChannelConfig`, System-A JSONB only

The theme's missing tier ("1-week maxAge globally but off in #general"), built on the exact `UserPersonalityConfig` precedent: `@@unique([userId, channelId])`, deterministic id (`uuidv5('user_channel_settings:{userId}:{channelId}')`), `configOverrides Json?`. **JSONB cascade only in v1** — no preset FKs (same trigger discipline as guild presets: add System-B pointers when someone actually asks for per-channel models).

- **Placement** (the contestable call, §6): recommended `… → channel → user-default → USER-CHANNEL → user-personality`. Rationale: among the user's own expressions, specificity ascends — generic default < place-scoped < character-scoped; a user's character-specific intent ("this character always terse") is their most deliberate setting. Counter-position for council: "off in #general" is *situational* and should beat character defaults there.
- **Cache/invalidation: free.** The resolver cache key is already `userId|personalityId|channelId` — both dimensions present; `invalidateUserCache`/`invalidateChannelCache` cover it positionally. One new tier loader + one `'user-channel'` source label + `DashboardLevel` value.
- **Surface**: `/channel overrides` (mirrors `/character overrides` naming — MY settings for THIS channel; `/channel settings` remains the shared channel tier). Same 11 fields, same inherit/value/off vocabulary from the cascade design.
- **DMs**: works for free (DM channel ids flow through the same path) but mostly duplicates the channel tier there — the dashboard notes this rather than blocking it.

### D4. What this deliberately does NOT do

Separate profile entity (D1) · fallback chains (one hop) · per-channel presets (trigger: real ask) · the fairness allocator itself (piggyback proposal owns it; composition contract stated in D2) · vision bundling (decided 2026-06-26) · guest-upsell changes (existing gating untouched).

## 3. Phasing

| Phase | Contents | Note |
| --- | --- | --- |
| **0 — tier-aware default fallback** | Proactive + reactive retargeting with targets from the existing admin pointers; footer notice; NO schema change | Closes the log-verified "BYOK user dumped to error" gap immediately |
| **1 — explicit fallback edge** | `fallbackConfigId` column (CHECK ≠ self, ON DELETE SET NULL + dashboard fallback-lost indicator) + dashboard field + tier-filtered autocomplete + one-hop note in the UI | The theme's "profile" delivered |
| **2 — user-channel tier** | `UserChannelConfig` + loader + `/channel overrides` dashboard | Independent of 0/1; can ship first if preferred |
| **Triggered** | Per-channel preset FKs · profile bundles beyond the fallback edge · allocator integration details when piggyback ships | |

## 4. Absorption map (at landing)

`model-configuration-overhaul.md`: the "LLM Config Profiles" and "Config cascade extension — user-channel" sections point here (the server-tier line already points at the cascade design); "Free Model Quota Resilience" is absorbed by D2. `follow-ups` rows: the tier-aware fallback gap row → discharged into Phase 0; the shared-key starvation row stays (allocator scope). `config-cascade-semantics.md` needs no edit (D4 layer-never-replace honored; guild placement untouched).

## 5. Open calls — post-council status (trio unanimous on ALL five)

| # | Call | Status |
| --- | --- | --- |
| 1 | Fallback edge on the preset | **Unanimous** (container entity = over-engineering for one edge) + integrity riders adopted (CHECK, SET NULL + indicator, resolver hard-stop) — **CONFIRMED 2026-07-05** |
| 2 | User-channel below user-personality | **Unanimous** ("a #claude-only channel silently overriding every per-character preset would be the surprise"; escape hatch = clear the per-character override; merge order codified as one ordered list in code) — **CONFIRMED 2026-07-05** |
| 3 | Proactive + one reactive retarget | **Unanimous** (proactive-only leaves first-failure-per-window terminal) + the classification trigger matrix adopted; hard re-evaluate gate before tools enter the loop — **CONFIRMED 2026-07-05** |
| 4 | Always announce | **Unanimous, "non-negotiable"** (silent model swaps = inexplicable voice shifts); footer names both presets — **CONFIRMED 2026-07-05** |
| 5 | Phase order 0→1→2 | **Unanimous** (0 closes the live log-verified gap with zero schema) — **CONFIRMED 2026-07-05** |

## 6. Council record (2026-07-05 — GLM 5.2 · Kimi K2.7-code · Qwen 3.7 Max)

Adopted: tier-filter on the explicit edge — tier always wins, the edge is a hint (GLM's sharpest catch: the draft's chain bypassed the tier directive the moment anyone set an explicit fallback); classification-aware trigger matrix incl. the same-billing-entity futility rule (GLM+Qwen); FK integrity trio — CHECK ≠ self, ON DELETE SET NULL, resolver one-hop hard-stop + UI note (all three); params contract — fallback preset's own sampling params, System-A behavior cascade untouched (Kimi+Qwen); wallet-update clears the exhaustion cache (Kimi's stranded-after-top-up case); `isViable` predicate as the future allocator seam (Kimi); structured audit event per fire (Kimi); footer names both presets (Qwen). Declined/noted: mid-stream splice guard (N/A — delivery is completion-only by architecture); Kimi's "reserve an extension point on the entity" (the revisit-trigger already covers it; no speculative schema).
