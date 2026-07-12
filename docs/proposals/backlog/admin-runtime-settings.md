# Admin Runtime Settings — env-var migration + two-axis settings dashboards

**Status**: ACCEPTED 2026-07-12 — full trio council (GLM-5.2 · Kimi-K2.7-code · Qwen-3.7-Max) + owner sign-off on all open calls (O1 JSONB+amendments · O5 single-command page groups · O7 openrouter/auto seeds · confirm-all on the council-adopted set) · **Amended 2026-07-12** (owner, post-acceptance): all four floors configurable — free floors join the registry (O8/D10)
**Extends**: [`config-cascade-semantics.md`](config-cascade-semantics.md) (ACCEPTED — this occupies its named "env-var migration" follow-on slot, §3 + phasing row 3+) · [`ux-design-system-spec.md`](ux-design-system-spec.md) §3.3/D14 (pagination-by-concern — this builds the mechanism) · [`platform-portable-ux-design.md`](platform-portable-ux-design.md) §4.4 Phase 2
**Supersedes**: nothing (the `cold/ideas.md` settings-dashboard entry is absorbed at acceptance)

## Owner directives (verbatim, immutable)

1. *"Env vars are for stuff that is very implementation specific or for secrets"* — product knobs are slash-settable (2026-07-10).
2. **Two-axis UX**: audience pages — **Cascade Defaults** pages vs **owner-only System** pages — with concern grouping within each; *"an extra page or two for owner-only stuff"* (2026-07-11).
3. **Flag fates case-by-case**: `EXTRACTION_ENABLED` **retires** (proven in prod); `FACTS_IN_PROMPT_ENABLED`, `ZAI_FREE_TIER_ENABLED`, `AUTO_TRANSCRIBE_VOICE` **migrate** (2026-07-11).
4. **Full ~15-var migration set in one slice** — one coherent before/after; dead-env cleanup rides (2026-07-11).
5. Model settings in dashboards are **free-text with catalog validation** (no dropdowns — 25-option cap); autocomplete on the slash path (2026-07-12).
6. The admin model settings are named **fallback models**, not defaults — *"these are the ultimate last tier fallback so they need to be rock solid"* (2026-07-12).
7. **Fallback seeds are OpenRouter router aliases** (2026-07-12): free users → `openrouter/free` (already the structural guest floor in code); paid floors seed **`openrouter/auto`** for both text and vision. Consciously accepted for a rare floor hit: per-message model variance (voice drift) and unpredictable routed cost — the floor's job is to always answer, not to be the everyday model. Owner's own fit-check research cited both caveats before choosing.
8. **All four floors are configurable** (2026-07-12, post-acceptance amendment): *"amend please, I want all of them configurable"* — the free floors become registry settings too (`fallbackTextModelFree`/`fallbackVisionModelFree`, seeded `openrouter/free`), not code constants. The draft's keep-as-constant call was design economy, not an owner directive. The write path accepts only free-route models, so a free-floor misconfiguration can never bill the system key (D9/D10).

## Grounding provenance

Three parallel read-only sweeps (2026-07-12): (A) per-var consumption matrix + AdminSettings read/write/invalidation architecture; (B) dashboard machinery + platform constraints + design-system bindings; (C) prior-artifact binding decisions + invalidation catalog + boot-coherence inventory. Plus owner env-var audit (2026-07-11, 51 schema vars swept). Findings marked [V] verified with file:line evidence in the grounding reports.

## The system as-is (verified facts only)

- **`getConfig()` memoizes process-wide on first call** — no migrating var is runtime-live today regardless of call-site shape. The per-var question is refactor *cost*, not current liveness. [V]
- **`AUTO_TRANSCRIBE_VOICE` is already dead**: deprecated, ignored at boot (bot-client logs a warning), its function lives at `admin_settings.configDefaults.voiceTranscriptionEnabled`, read via the 60s-TTL `getAdminSettingsCached()` in `VoiceMessageProcessor`. **This is the finished reference implementation of the migration pattern.** [V]
- **AdminSettings today**: singleton row (`ADMIN_SETTINGS_SINGLETON_ID`), `configDefaults` JSONB (cascade admin tier, `ConfigOverridesSchema`-validated) + six nullable preset-pointer FKs. No scalar tunables. Excluded from db-sync (dev/prod diverge by design). [V]
- **Consumers**: every migrating var is read in **ai-worker** except `PUBLIC_RATE_LIMIT_PER_MIN` (**api-gateway**). Both have Prisma. **No migrating var is read in bot-client** — no new gateway proxy read path needed. [V]
- **Read-timing classes** [V]:
  - *Per-request reads* (cheap to make live): `FACTS_IN_PROMPT_ENABLED`, `EXTRACTION_MODEL`, `EXTRACTION_PROVIDER` (the latter two also have boot-coherence checks).
  - *Constructor captures* (need re-read or rebuild): `ZAI_FREE_TIER_ENABLED` + `HEADROOM_PERCENT` + `GLOBAL_DAILY_BUDGET` (admission/quota singletons at `redis.ts` module load), `FREE_TIER_*` ×4 (same), `EXTRACTION_BATCH_THRESHOLD` (`ExtractionTrigger` constructor), `PUBLIC_RATE_LIMIT_PER_MIN` (rate-limiter middleware at server construction).
  - *Boot assembly gates*: `EXTRACTION_ENABLED` (gates construction of the whole extraction worker) — but it RETIRES, dissolving the problem.
  - *Module-const captures* (worst): `DEFAULT_AI_MODEL` (ModelFactory, CacheKeyBuilder), `VISION_FALLBACK_MODEL` (VisionProcessor, describeImageWithFallback) — `const config = getConfig()` at module top in four files.
- **Invalidation**: 9-service house pattern (`BaseCacheInvalidationService`, one Redis channel per domain, strict event validators). The cascade service's `{type:'admin'}` event already exists; the admin write route already publishes it; **subscriber is ai-worker only**. bot-client's admin-settings cache relies on 60s TTL cross-instance; api-gateway's own cascade cache is not cross-process invalidated. [V]
- **No DB-first-env-fallback precedent exists.** The house transition pattern is `TtsConfigBootstrap.seedDefaultPointersIfUnset`: **boot-seed the DB value only when unset (never clobber an explicit admin choice), then DB is authoritative**, with hardcoded constants as the literal floor. [V]
- **Boot-coherence checks** (`logZaiCoherenceMisconfigurations`, `logZaiFreeTierBootCoherence`) validate flag+key+catalog coherence at boot from env. Once flags are DB-backed and runtime-mutable, boot-only checks are insufficient. [V]
- **Dashboards**: two stacks; the settings stack (`utils/dashboard/settings/`) powers `/admin settings` (11 settings, flat) and `/settings defaults edit` (10 settings, flat). No group concept, no pagination, no page in session state, no 25-cap on its select builder, Close-button removal (design-system D18) pending, `/settings` green color violates D4. §3.3's pagination-by-concern mechanism (`DashboardConfig` section groups) is accepted-but-unbuilt; D14 already decided the 3-page grouping for the existing 11. Browse layer's `calculatePaginationState` + 25-guard are cleanly liftable; page state belongs in the Redis session (custom-ids stay short; avoids the G8 fragmentation). [V]

## Decisions

### D1 — Storage: a `systemSettings` JSONB sibling on AdminSettings; cascade knobs stay in `configDefaults`

Owner-only operational knobs (quota budgets, headroom, feature flags, fallback models, rate limit) land in a **new `system_settings` JSONB column** on the AdminSettings singleton, validated by a new `SystemSettingsSchema` zod registry — structurally parallel to `configDefaults`/`ConfigOverridesSchema`. Cascade-eligible knobs continue to live in `configDefaults` (none of the migration set qualifies today; `voiceTranscriptionEnabled` already proved that path).

*Why*: mirrors the proven JSONB-registry pattern (validation, wire contract, write route, invalidation all have precedent); one singleton row keeps updates atomic and audit (`updatedBy`) shared; the accepted cascade semantics stay untouched (constraint: keep the System-A/System-B split; system settings are neither — they are **non-cascading operational state**, a deliberate third bag on the same row, not a third *resolution path* for generation params).
*Rejected*: typed columns per setting (a migration per knob, no type win the zod registry doesn't already give); a separate KV table (council-proposed for row-level locking — rejected because the write surface is ONE gateway PATCH route on a one-owner bot, and the singleton keeps updates atomic; the real risks are addressed by the amendments below).

**Council-driven amendments (concurrency + evolution)**: (a) reads use `.passthrough()`-style unknown-key preservation so an older process can never strip-and-clobber keys a newer process wrote (the rolling-deploy data-loss vector); (b) the PATCH route does a fresh read-merge-write server-side per request (the existing `mergeConfigOverrides` shape) — a client never submits the whole bag; (c) writes carry an `updatedAt` optimistic-concurrency check, rejecting on mismatch with a "settings changed underneath you — refresh" error.

### D2 — Registry-first: every system setting is a `SYSTEM_SETTINGS_REGISTRY` entry

One entry per setting carrying: key, zod validator (**with bounds** — the migrating vars keep their env-schema ranges), dashboard metadata (label, group, control type), seed source (the env var / constant it migrates from), consumer service(s), and a **`liveness`** field: `'live'` (takes effect next read) | `'rebuild'` (takes effect on singleton rebuild — see D5) | `'restart'` (restart-required — and the write response MUST render a "saved; takes effect on next deploy/restart" warning banner; an unmarked restart-required setting that silently appears saved is the council-named footgun. All current settings land `'live'`; the tier exists for future pool-size-class knobs). The registry powers schema validation, dashboard rendering, the seed pass, and the `/inspect`-style explain surface — one place to add setting #N+1 (the "field #12 checklist" discipline, ported).

### D3 — Resolution: seed-once-when-unset, then DB-authoritative; env vars deleted

Per the house transition pattern: a boot-time seed pass (api-gateway, alongside `TtsConfigBootstrap`) writes each registry entry's seed value into `system_settings` **only if the key is absent** — an admin's explicit choice is never clobbered. **Race-safety (council)**: the seed is a per-key conditional JSONB merge (SQL `jsonb strict "insert-if-absent"` semantics via `INSERT … ON CONFLICT` / conditional `jsonb_set`, not read-modify-write in app code) — idempotent under concurrent replica boots, and within one environment every replica derives identical seed values from the same env anyway. After the migration release, the env vars are **deleted from Railway and the zod schema** (the owner's env-cleanup rides: the dead bot-client strays go too). Readers fall back to the registry's in-code seed constant if the DB row/key is somehow absent — the literal floor beneath the floor. **No perpetual env-fallback chain** (no precedent, and it would leave two sources of truth).

Consequence accepted and announced: system settings are **per-environment** (admin_settings never syncs) — dev and prod are tuned independently, which is the point.

### D4 — Read path: a cached `SystemSettingsService` in common-types/config-resolver, per-consumer singletons

ai-worker and api-gateway read through a small `SystemSettingsService` (Prisma singleton read → zod-validated → TTLCache, TTL = the house `API_KEY_CACHE_TTL`), exposing typed getters (`get('factsInPromptEnabled')`). **Hot-path contract (council)**: `get()` is a SYNCHRONOUS in-memory cache read — never a per-call DB hit. Refresh is stale-while-revalidate: on TTL expiry or invalidation the stale value keeps serving while one async refresh runs (single-flight); on DB failure the service serves the last-known value, else the registry's in-code seed constant — the floor beneath the floor. The hot path can therefore never block on, or fail because of, the settings store. bot-client never reads system settings (verified: none of the set is bot-client-consumed); if that changes, the existing gateway `getAdminSettingsCached` pattern extends.

### D5 — Liveness: re-read at use for cheap reads; **options-provider refactor** for constructor-captured singletons

- *Per-request readers* (`FACTS_IN_PROMPT_ENABLED`, `EXTRACTION_MODEL`, `EXTRACTION_PROVIDER`): swap `getConfig().X` for `systemSettings.get('x')` — live immediately.
- *Constructor captures* (quota/admission singletons, `ExtractionTrigger` threshold): rather than rebuilding singletons on invalidation (lifecycle risk: in-flight state, double-subscription — council concurred), the singletons' options become **provider functions** (`() => systemSettings.get(...)`) evaluated per admission/consume call. Council clarification folded: this is safe precisely because `get()` is a sync in-memory read (D4) — the classes' Redis/queue STATE is untouched, only the numeric option values become late-bound; each decision point reads its options once (request-level consistency at the single read site). The quota classes already take options objects; the change is mechanical and testable. Registry liveness: `'live'`.
- `PUBLIC_RATE_LIMIT_PER_MIN` (api-gateway middleware): the limiter's per-request budget lookup reads the cached service; liveness `'live'` with the cache TTL as propagation bound.
- *Module-const captures* (`fallbackTextModel`, `fallbackVisionModel`): move the read into the call sites (four files) — the refactor the consumption matrix priced as worst-case but is still just "stop hoisting `getConfig()`".
- *Free-floor constant reads* (directive 8): every read site of the guest-floor constants swaps to a registry read in the same pass — `GUEST_MODE.DEFAULT_MODEL` (guest ladder last resort in `guestModeOverrides.ts` **and** the quota-degrade retarget in `quotaFallback.ts` — both must swap or the decision forks) and `MODEL_DEFAULTS.VISION_FALLBACK_FREE` (guest clamp + free floor across `visionAuthResolver`, `VisionProcessor`, `composeVisionTiers`). Enumerate by grep at build; liveness `'live'`.
- `EXTRACTION_ENABLED` **retires**: the ENV VAR is deleted outright; a registry setting `extractionEnabled` becomes the runtime kill switch, checked per trigger-fire (liveness `'live'`). The extraction assembly (queue + worker registration) constructs unconditionally — when disabled, the trigger never enqueues, so the worker idles on an empty queue (verify at build that assembly construction is side-effect-free beyond registration; council flagged the crash-on-boot risk if it ever grows infra dependencies — it must not).

### D6 — Invalidation: a NEW `SYSTEM_SETTINGS_CACHE_INVALIDATION` channel (council-flipped)

The draft proposed reusing `{type:'admin'}`; the council majority flipped it: system settings are a distinct DOMAIN, and the house rule is one channel per domain — reuse would force cascade subscribers to process system events (and vice versa), and the strict exact-key event validators make retrofitting scope fields onto the existing event awkward. So: a 10th `BaseCacheInvalidationService` subclass, new `REDIS_CHANNELS` const, event `{type:'keys', keys: string[]} | {type:'all'}` (changed keys informational — subscribers clear the whole tiny cache either way). api-gateway both publishes AND subscribes (closing its known self-subscription gap for this domain); ai-worker subscribes; bot-client stays TTL-only (nothing it reads migrates). Cascade `{type:'admin'}` continues to serve `configDefaults` edits unchanged.

### D7 — Coherence checks move to write-time (+ boot echo)

The two boot-coherence validators become **write-time validations in the gateway route**, powered by the registry: setting `zaiFreeTierEnabled=true` with no `ZAI_CODING_API_KEY` (still env — it's a secret) is rejected with the same message the boot check logs today; `extractionProvider='zai-coding'` without the key, likewise; `extractionModel` must pass catalog membership. A slim boot echo remains (log-only).

**Runtime drift net (council: write-time can't see env-key rotation after a flag is enabled)**: the INVOCATION-TIME guards that already exist are the answer, now named as part of this design's contract — the z.ai admission path re-resolves the system key per request and fails open with a structured warn when it vanished; extraction resolves its provider per job and degrades with the same shape. Build-time task: verify each migrated flag's invocation site has such a guard, and add the missing ones. Coherence is thus enforced at all three times: write (reject), boot (echo), invoke (degrade + warn).

**Audit (council)**: every system-settings write emits a structured log `{key, oldValue, newValue, updatedBy}` — greppable history without a new table; the singleton's `updatedBy` column stays the last-writer marker.

### D8 — Two-axis dashboard: `/admin settings` grows pages; `/admin system` is the new owner surface

- **Axis 1 — Cascade Defaults** (existing `/admin settings`, edits `configDefaults`): gains the accepted D14 3-page grouping (Memory 5 · Context & Display 4 · Voice 2) via the §3.3 mechanism — `SettingsDashboardConfig` gains **groups**; the builder renders one concern-page at a time with `Page N/M · <Concern>` indicator and Secondary prev/next; the section select scopes to the current page. Page state lives in the Redis session (new `page` field), not custom-ids.
- **Axis 2 — System** (council-flipped from a separate `/admin system` command, 2/3 majority; the owner directive explicitly permits "at minimum separate pages"): the System surface lives as an owner-only PAGE GROUP inside `/admin settings` — no new command slot, one auth path, one session model. The page selector shows two groups: **Defaults** (the cascade pages) and **System**. System pages, concern-grouped and design-system-compliant (≤6 per page — the draft's 7-setting Free Tier page split): **Extraction** (enabled·model·provider·batch threshold) · **Free Tier — Fair Share** (4 FREE_TIER_ knobs) · **Free Tier — z.ai** (3 z.ai knobs) · **Models & Limits** (fallbackTextModel, fallbackVisionModel, fallbackTextModelFree, fallbackVisionModelFree, publicRateLimitPerMin — 5, still ≤6). Writes to System pages hit the new system-settings route (owner-auth at route/schema layer, not just UI).
- Rides along (same surfaces, accepted-but-pending design-system items): D18 Close-button removal, D4 BLURPLE fix on `/settings`, the 25-option cap adopted defensively in the settings select builder.
- The user `/settings defaults edit` inherits the same pagination mechanism (10 settings → same 3 groups minus admin-only voice setting); D14's 11-vs-10 discrepancy resolves as **one shared grouping map, per-tier writable filtering** (the existing pattern).

### D9 — Model fields: free text + catalog validation; autocomplete on the slash path (owner call, 2026-07-12)

The **slash setter with autocomplete is the PRIMARY path for model fields** (council: modals cannot autocomplete, and long model ids are typo-prone on mobile); the dashboard modal is the secondary path — free text, validated, input preserved on failure (design-system D15), error names the reason. The gateway write validates: OpenRouter catalog membership (via `OpenRouterModelCache`) for unprefixed/OpenRouter models — plus **image-input modality for the vision slot** — and `ZAI_MODEL_CATALOG` membership for `z-ai/` models. **Router aliases (`openrouter/auto`, `openrouter/free`) live on an explicit per-slot allowlist in the registry** — they may lack modality tags in the catalog, and the vision-capability check must not reject them (owner directive 7 makes `openrouter/auto` the paid seed). Catalog-cache cold/stale handling: floor fields (D10) fail CLOSED (rock-solid — no unverifiable write); other model fields fail open with a warning. **Free-floor slots validate stricter still (directive 8)**: only free-route models pass — `isFreeModel` (the `openrouter/free` alias or a `:free`-suffixed catalog model; deliberately NOT `isFreeTierEligibleModel`, whose z.ai members are wrong for an OpenRouter-system-key floor) — plus image-input modality for catalog models on the vision slot. This is the guard that makes free floors safe to expose: the one failure mode tunability adds (pointing guests at a model that bills the system key) is structurally rejected. The paired slash setter is `/admin settings set <setting> <value>` through the same validator.

### D10 — the four rock-solid floors: `fallbackTextModel` / `fallbackVisionModel` / `fallbackTextModelFree` / `fallbackVisionModelFree` (owner calls, 2026-07-12)

Renamed from "default" to **fallback** to distinguish from the global-default preset *pointers* (a tier users fall into) — these are the **floor** (what runs when every chain above is exhausted). Rock-solid means: never-empty by construction (write path rejects empty); in-code `MODEL_DEFAULTS` constants remain beneath them as the literal last resort; write-surface guidance says choose boring, highly-available targets. **Seeds (owner directive 7)**: both paid floors seed **`openrouter/auto`** — a router alias that always resolves to SOME available model, which is maximally rock-solid against single-model deprecation/outage; the accepted trade (owner-researched) is per-hit model variance and routed-cost unpredictability, acceptable for a rare floor. `MODEL_DEFAULTS` constants update to match at build.

**Free floors (directive 8, post-acceptance amendment)**: `fallbackTextModelFree` and `fallbackVisionModelFree` join the registry, both seeded **`openrouter/free`**. They replace the guest-floor constants at every read site (D5 enumerates the two constant classes and their consumers). The floor↔tier billing firewall is preserved: guests are hard-clamped onto the free floor for any non-primary vision tier (`visionAuthResolver`'s guest clamp), and the free-floor write validator (D9) accepts only free-route models — so rock-solid survives tunability via validation rather than immutability. The tier split is the point: a free user's runtime failure descends to the FREE floor (`openrouter/free`), a paid/BYOK user's to the paid floor (`openrouter/auto`); a free-user failure can never escalate into a system-key-billed model.

### D11 — Migration-set disposition table

| Env var | Fate | Registry key | Liveness | Notes |
|---|---|---|---|---|
| `EXTRACTION_ENABLED` | **retire** (owner) | `extractionEnabled` (kill switch) | live | boot gate dissolves (D5) |
| `FACTS_IN_PROMPT_ENABLED` | migrate | `factsInPromptEnabled` | live | per-request read already |
| `ZAI_FREE_TIER_ENABLED` | migrate | `zaiFreeTierEnabled` | live | provider-fn refactor; write-time coherence (D7) |
| `AUTO_TRANSCRIBE_VOICE` | **delete env** (already dead) | — (exists as `voiceTranscriptionEnabled`) | — | reference implementation |
| `EXTRACTION_BATCH_THRESHOLD` | migrate | `extractionBatchThreshold` | live | trigger reads provider fn |
| `EXTRACTION_MODEL` | migrate | `extractionModel` | live | catalog-validated; eval-gate note carried into write-surface copy |
| `EXTRACTION_PROVIDER` | migrate | `extractionProvider` | live | write-time coherence (D7) |
| `FREE_TIER_GLOBAL_DAILY_BUDGET` | migrate | `freeTierGlobalDailyBudget` | live | quota provider fns |
| `FREE_TIER_WINDOW_MINUTES` | migrate | `freeTierWindowMinutes` | live | shared by both quotas |
| `FREE_TIER_MIN_PER_WINDOW` | migrate | `freeTierMinPerWindow` | live | |
| `FREE_TIER_MAX_PER_WINDOW` | migrate | `freeTierMaxPerWindow` | live | |
| `ZAI_FREE_TIER_HEADROOM_PERCENT` | migrate | `zaiHeadroomPercent` | live | the "revisit with meters" knob — the whole point |
| `ZAI_FREE_TIER_GLOBAL_DAILY_BUDGET` | migrate | `zaiGlobalDailyBudget` | live | |
| `PUBLIC_RATE_LIMIT_PER_MIN` | migrate | `publicRateLimitPerMin` | live | api-gateway subscriber gap closes (D6) |
| `DEFAULT_AI_MODEL` | migrate + **rename** | `fallbackTextModel` | live | D10; module-const refactor |
| `VISION_FALLBACK_MODEL` | migrate + **rename** | `fallbackVisionModel` | live | D10; module-const refactor |
| `GUEST_MODE.DEFAULT_MODEL` (code constant, not env) | **promote to setting** (directive 8) | `fallbackTextModelFree` | live | D10; guest ladder + quota-retarget read sites (D5) |
| `MODEL_DEFAULTS.VISION_FALLBACK_FREE` (code constant, not env) | **promote to setting** (directive 8) | `fallbackVisionModelFree` | live | D10; vision guest clamp + floor sites (D5) |
| `EXTRACTION_DAILY_LIMIT` | **stays env** (owner) | — | — | malfunction tripwire, never tuned |
| `ZAI_CODING_API_KEY` + all secrets/infra | **stay env forever** | — | — | owner taxonomy |
| Dead bot-client strays (`DATABASE_URL`, `OPENROUTER_API_KEY`, `AI_PROVIDER`, `DEFAULT_AI_MODEL`, `VISION_FALLBACK_MODEL`) | **delete from Railway** | — | — | verify-by-removal on dev first |

## What this deliberately does NOT do

- **No cascade changes**: tier order, sentinel semantics, the System-A/B split, and the guild tier are ACCEPTED elsewhere and untouched.
- **No BYOK-billing consolidation**: the cost-attribution boulder (`cold/ideas.md`) remains adjacent; its knobs will join the registry when built.
- **No per-guild admin settings**: AdminSettings stays the one-bot singleton.
- **No secrets in the DB**, ever.
- **No custom-id unification** (G8): page state avoids custom-ids precisely so this doesn't entangle.

## Phasing (build slices — council-reordered: the control plane must exist before the old one is destroyed)

1. **PR 1 — plumbing + minimal control plane**: `system_settings` column (additive migration) + registry + `SystemSettingsService` (both services) + race-safe seed pass + NEW invalidation channel + write route & validations (D7/D9/D10) + **the `/admin settings set` slash setter** — so a validated write surface exists from day one.
2. **PR 2 — dashboards**: settings-stack groups/pagination mechanism + Defaults page group + System page group + ride-alongs (D18 Close removal, BLURPLE fix, 25-cap).
3. **PR 3 — consumer swaps + env deletion**: per-var read-path swaps (D5: provider-fns, module-const unhoisting, extraction boot-gate dissolution). Env vars deleted from the zod schema; Railway cleanup **dev first, prod after a soak window** — deletion is LAST, after the DB path is proven live, so rollback of any earlier PR never strands config.

## Council record (trio pass, 2026-07-12: GLM-5.2 · Kimi-K2.7-code · Qwen-3.7-Max)

**Adopted (council-driven changes to the draft)**: phasing reorder — env deletion last, control plane first (unanimous top miss); D1 concurrency amendments — passthrough unknown-keys, server-side merge, optimistic concurrency (GLM+Kimi amend; Qwen's KV-table rejection declined with reasoning recorded in D1); D3 race-safe per-key seed (all three); D4 hot-path contract — sync SWR cache, floor-constant fallback, never block (all three attacked provider-fns on a per-call-DB misread; the amendment makes the actual contract explicit); D6 flipped to a new invalidation channel (Qwen reject + one-channel-per-domain house rule outweighed the reuse convenience); D7 runtime-drift net named (invocation-time guards) + audit logging (Kimi); D8 flipped to single-command page groups (Kimi+Qwen reject of separate command; owner directive permits pages) + Free Tier page split at the ≤6 rule (Kimi); D9 slash-autocomplete primary for model fields + router-alias allowlist + floor-fields-fail-closed (all three on modal UX; allowlist from owner directive 7); D5/D11 EXTRACTION_ENABLED wording de-ambiguated (GLM caught the contradiction).

**Declined with reasons**: KV table (D1 — one-owner single-write-surface bot; amendments address the real vectors); rebuild-singletons-on-invalidation (D3/O3 — lifecycle risk the provider-fn + SWR contract avoids; Qwen's state-destruction scenario assumed re-instantiation, which provider-fns don't do); dropping the `restart` liveness tier (Qwen YAGNI — kept with the mandatory write-warning banner per Kimi's actionability condition); GLM's bot-client break concern (verified false at grounding — no migrating var is bot-client-read); Kimi's session-TTL page-state concern (expiry degrades to page 1 — benign).

## Open calls (council + owner)

| # | Question | Council verdicts | Resolution |
|---|---|---|---|
| O1 | JSONB on singleton vs. new table? | amend / amend / reject→KV | **CONFIRMED (owner 2026-07-12)**: JSONB + concurrency amendments (D1) |
| O2 | Reuse `{type:'admin'}` vs. new channel? | accept+scope / accept+scope / reject→new | **DECIDED**: new channel (D6, council-flipped) |
| O3 | Provider-fns vs. rebuild singletons? | amend / reject-as-stated / hybrid | **DECIDED**: provider-fns + SWR sync-read contract (D4/D5) |
| O4 | Retire extraction boot gate fully? | reject(wording) / conditional / keep-env-gate | **DECIDED**: retire; assembly stays side-effect-free (D5) |
| O5 | Separate `/admin system` command vs. pages? | accept / reject / reject | **CONFIRMED (owner)**: single command, System page group (D8) |
| O6 | Keep `'restart'` liveness tier? | accept / amend-if-actionable / reject(YAGNI) | **DECIDED**: keep + mandatory write-warning banner (D2) |
| O7 | Paid floor seeds = `openrouter/auto` (both slots)? | — (owner research, post-council) | **CONFIRMED (owner 2026-07-12)**: auto for both (D10) |
| O8 | Free floors: constants or settings? | — (post-acceptance owner amendment) | **DECIDED (owner 2026-07-12)**: configurable — `fallbackTextModelFree`/`fallbackVisionModelFree`, seeded `openrouter/free`, free-route-only validation (D9/D10) |
