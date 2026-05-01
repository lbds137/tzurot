# TTS Engine Upgrade Epic — Phase 1 Implementation Plan

> **Status**: Decisions locked 2026-05-01 via three-council review (Gemini 3.1 Pro Preview → GLM 5.1 → Kimi K2.6). Pre-implementation gate remaining: empirical Mistral API smoke test (deferred to next session pending Mistral account setup).
> **Lifecycle**: Build-process doc — DELETE after Phase 1 ships. Architectural rationale lives in `docs/research/voice-cloning-2026.md`; the code itself documents the shipped feature.
> **Created**: 2026-05-01. Last revised: 2026-05-01 post-council.

**Cross-references**:

- Decision log: [`docs/research/voice-cloning-2026.md`](../../research/voice-cloning-2026.md) — "2026-05-01 TTS Upgrade Decision" section.
- Phased plan summary: [`backlog/active-epic.md`](../../../backlog/active-epic.md).

---

## Pivot from initial plan: Voxtral via direct Mistral, not OpenRouter

**Critical finding during council review**: OpenRouter only proxies `/audio/speech` — it does NOT expose the voices management API needed for Voxtral cloning. Voxtral cloning at the Mistral level uses a two-step pattern: `POST /v1/voices` (create voice from base64 reference audio, returns `voice_id`) → `POST /v1/audio/speech` (synthesize text with `voice_id`). Structurally identical to ElevenLabs.

**Same $16/1M pricing direct as via OpenRouter** — no markup, free tier available for testing. The 85% cost reduction holds.

**Implication**: Phase 1 BYOK provider is `MistralTtsProvider` (not `OpenRouterTtsProvider`). OpenRouter remains a future option for preset-voice models (Kokoro 82M at $0.62/1M, GPT-4o Mini TTS at $0.60/1M) if a budget tier is ever needed — track as Phase 3.

---

## 1. The `TtsProvider` interface

### Final shape (post-three-council reconciliation)

```ts
// packages/common-types/src/services/tts/TtsProvider.ts

export type TtsProviderId = 'self-hosted' | 'elevenlabs' | 'mistral';

export interface TtsCapabilities {
  /** Maximum text length per synthesis call. */
  maxCharacters: number;
  /**
   * Whether `prepare()` does meaningful work (clone voice, fetch reference,
   * cache lookup). False for stateless providers that pack reference audio
   * into every synthesize() request.
   */
  requiresPrepare: boolean;
  /** Whether the provider supports zero-shot voice cloning from reference audio. */
  supportsReferenceAudio: boolean;
  /** Output audio format. */
  outputFormat: 'mp3' | 'wav' | 'pcm' | 'opus';
}

export interface TtsContext {
  /** Personality slug — always required (cache key, voice handle source). */
  slug: string;
  /** BYOK key if provider needs it (ElevenLabs, Mistral). Undefined for self-hosted. */
  byokKey?: string;
  /** Optional model override from resolved tts_config. */
  modelId?: string;
}

/**
 * Opaque handle returned by prepare(). Discriminated union unifies stateful
 * (voice-id) and stateless (inline-audio) providers under one interface.
 *
 * The `_brand` field prevents accidental construction outside the provider —
 * callers receive an opaque token they can only pass back to synthesize().
 */
export type PreparedTts =
  | { _brand: 'prepared'; kind: 'voiceId'; id: string; provider: TtsProviderId }
  | {
      _brand: 'prepared';
      kind: 'inlineAudio';
      buffer: Buffer;
      mimeType: string;
      provider: TtsProviderId;
    };

export interface TtsProvider {
  readonly id: TtsProviderId;
  readonly displayName: string;
  readonly capabilities: TtsCapabilities;

  /**
   * Cheap predicate: is this provider's prerequisites available?
   * Examples: ElevenLabs requires byokKey. Mistral requires byokKey.
   * Self-hosted requires VOICE_ENGINE_URL configured.
   *
   * Resolver uses this to skip providers cleanly without catching auth-error
   * at synthesize() time.
   */
  isAvailable(ctx: TtsContext): boolean;

  /** Cheap predicate: can this provider handle the resolved config + context? */
  canHandle(config: ResolvedTtsConfig, ctx: TtsContext): boolean;

  /**
   * Lifecycle: ensure prerequisites (voice cloned/registered, warmup).
   * May be slow. Returns opaque handle.
   *
   * Stateless providers (e.g., a future provider that passes reference audio
   * inline per-call) return a `kind: 'inlineAudio'` handle. Stateful providers
   * (ElevenLabs, Mistral) return `kind: 'voiceId'`.
   */
  prepare(ctx: TtsContext): Promise<PreparedTts>;

  /**
   * Synthesize text using a prepared handle. Returns audio buffer in the
   * provider's `capabilities.outputFormat`. Long text is the provider's
   * responsibility (chunking/native).
   */
  synthesize(text: string, handle: PreparedTts): Promise<Buffer>;

  /**
   * Optional cleanup hook. NOT `Symbol.asyncDispose` — explicit method that
   * the dispatch wrapper calls if present. Most providers have no per-handle
   * resource to release (ElevenLabs voice persists in account, Mistral
   * voice persists in account, self-hosted slug stays registered). Reserved
   * for future providers with WebSocket / temp-file lifecycle needs.
   */
  dispose?(handle: PreparedTts): Promise<void>;
}
```

### Council-driven decisions

**No `Symbol.asyncDispose`** — three-council vote 2-1 (GLM + Kimi against). No current provider needs cleanup; `await using` is a tax on every call site for hypothetical future benefit. Optional `dispose?()` method is non-breaking to add when a stateful provider arrives.

**`PreparedTts` as opaque discriminated union** — Kimi's catch. Unifies stateful (voice_id) and stateless (inline-audio) providers under one interface. Without this, the resolver ends up with `if (provider instanceof X)` branches that destroy the abstraction.

**`capabilities` object** — Kimi's catch. Resolver dispatches based on `requiresPrepare` (skip eager prepare for stateless providers, do it for cloning providers). Without this, dispatcher hardcodes provider-specific knowledge.

**`isAvailable()` gate** — Kimi's catch. Cleanly skip providers without configs (no Mistral key → skip Mistral) instead of catching auth errors at synthesize time.

**Slot eviction stays provider-private** (all three councils agree). ElevenLabs `evictAndClone` is internal to `ElevenLabsTtsProvider`. Mistral may or may not have similar slot constraints — TBD during smoke test; if so, `MistralTtsProvider` implements its own internal eviction.

---

## 2. Error taxonomy: extend existing `ApiErrorCategory`

Three-council convergent decision: do NOT invent parallel TTS error hierarchy. Reuse the existing LLM-shaped categories. Bot-client already cases on `RATE_LIMIT`, `AUTH`, `QUOTA_EXCEEDED`, `TIMEOUT`, etc. for LLM errors.

```ts
// packages/common-types/src/types/api-error.ts (extend existing enum)
export enum ApiErrorCategory {
  // ... existing values ...
  VOICE_NOT_FOUND = 'voice_not_found', // NEW: voice slug doesn't exist
  CLONING_FAILED = 'cloning_failed', // NEW: provider voice clone failure
}

// packages/common-types/src/services/tts/TtsProviderError.ts (new)
export class TtsProviderError extends Error {
  constructor(
    public readonly category: ApiErrorCategory,
    public readonly provider: TtsProviderId,
    public readonly isFallbackEligible: boolean,
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
  }
}
```

**`isFallbackEligible: boolean`** (Kimi's catch) — not all errors should trigger fallback. Without this, falling back on a 400 (text too long, content filtered) burns credits trying the next provider only to fail again with the same input.

| Category             | `isFallbackEligible`   | Reason                                                    |
| -------------------- | ---------------------- | --------------------------------------------------------- |
| `RATE_LIMIT`         | `true`                 | Different provider has different quota                    |
| `AUTH`               | `true` (skip provider) | Different provider has different key                      |
| `TIMEOUT`            | `true`                 | Network blip; try alternative                             |
| `SERVER_ERROR` (5xx) | `true`                 | Provider problem, not request problem                     |
| `QUOTA_EXCEEDED`     | `true`                 | Different provider has different quota                    |
| `VOICE_NOT_FOUND`    | `false`                | Same voice slug missing in gateway = same fail everywhere |
| `CLONING_FAILED`     | `false` (mostly)       | Likely a malformed reference audio — same fail everywhere |
| `INVALID_KEY`        | `true` (skip provider) | This provider can't help; try next                        |

**`provider` field on every error** (GLM addition, Kimi confirmed) — observability. Distinguishes "ElevenLabs rate limit" from "Mistral rate limit" in logs without parsing message strings.

---

## 3. The `tts_configs` Prisma schema

Mirror `LlmConfig` (`prisma/schema.prisma:150-189`) closely. **No `referenceAudioVersion` column** — that was Gemini's recommendation; both GLM and Kimi argued correctly that voice-cloning cache invalidation is a provider-internal concern. The `ElevenLabsTtsProvider` and `MistralTtsProvider` each maintain their own in-memory `Map<slug, hash>` and rehash the bytes during `prepare()`. For restart resilience: encode the hash in the provider's voice description field (e.g., `tzurot:${hash}`) and parse it on `listVoices()` — zero schema cost, zero coupling.

```prisma
model TtsConfig {
  id                String                @id @db.Uuid
  name              String                @db.Citext
  description       String?
  ownerId           String                @map("owner_id") @db.Uuid
  isGlobal          Boolean               @default(false) @map("is_global")
  isDefault         Boolean               @default(false) @map("is_default")
  /// Default config for guest mode. Mirrors LlmConfig.isFreeDefault pattern.
  /// Enforced by partial unique index: tts_configs_free_default_unique (WHERE is_free_default = true)
  isFreeDefault     Boolean               @default(false) @map("is_free_default")
  /// Stable provider id — 'self-hosted' | 'elevenlabs' | 'mistral'.
  provider          String                @db.VarChar(40)
  /// Provider-specific model id (e.g. 'eleven_multilingual_v2', 'voxtral-mini-2603').
  /// NULL for providers with no model dimension.
  modelId           String?               @map("model_id") @db.VarChar(255)
  /// JSONB for provider-specific knobs. Validated by TtsAdvancedParamsSchema in common-types.
  advancedParameters Json?                @map("advanced_parameters")
  createdAt         DateTime              @default(now()) @map("created_at")
  updatedAt         DateTime              @updatedAt @map("updated_at")

  owner                       User                       @relation("TtsConfigOwner", fields: [ownerId], references: [id], onDelete: Cascade)
  personalitiesUsingAsDefault PersonalityDefaultTtsConfig[]
  userPersonalityConfigs      UserPersonalityConfig[]    @relation("UserPersonalityTtsConfig")
  usersWithAsDefault          User[]                     @relation("UserDefaultTtsConfig")

  @@unique([ownerId, name], map: "tts_configs_owner_id_name_key")
  @@index([ownerId])
  @@index([isGlobal])
  @@index([isFreeDefault])
  @@map("tts_configs")
}

model PersonalityDefaultTtsConfig {
  personalityId String      @id @unique @map("personality_id") @db.Uuid
  ttsConfigId   String      @map("tts_config_id") @db.Uuid
  updatedAt     DateTime    @updatedAt @map("updated_at")
  ttsConfig     TtsConfig   @relation(fields: [ttsConfigId], references: [id], onDelete: Cascade)
  personality   Personality @relation(fields: [personalityId], references: [id], onDelete: Cascade)

  @@index([ttsConfigId])
  @@map("personality_default_tts_configs")
}
```

**Additions to existing models**:

- `User`: `defaultTtsConfigId String? @map("default_tts_config_id") @db.Uuid` + relation
- `UserPersonalityConfig`: `ttsConfigId String? @map("tts_config_id") @db.Uuid` + relation
- `Personality`: back-relation to `PersonalityDefaultTtsConfig`

**Cascade scope keys**: same as LLM (per-personality user override → user default → personality default → hardcoded fallback).

**Hard cutover migration** (three-council convergent, kill the dual-write shim): one-off Prisma migration script reads existing `configOverrides.elevenlabsTtsModel` (`packages/common-types/src/schemas/api/configOverrides.ts:47`), creates corresponding `tts_configs` rows, drops the field. Zero runtime branching. Single user, no zero-downtime requirement.

The seed migration creates 3 system-owned global TtsConfigs (`isGlobal: true, ownerId: <bot-owner uuid>`):

- `kyutai-self-hosted` (provider: `self-hosted`, modelId: null)
- `elevenlabs-multilingual-v2` (provider: `elevenlabs`, modelId: `eleven_multilingual_v2`)
- `mistral-voxtral-mini` (provider: `mistral`, modelId: `voxtral-mini-2603`)

The free default flag points to `kyutai-self-hosted`.

---

## 4. The `TtsConfigResolver`

**Location**: `packages/common-types/src/services/TtsConfigResolver.ts`. Mirrors `LlmConfigResolver.ts` structure precisely.

**Resolution order**: `UserPersonalityConfig.ttsConfigId` → `User.defaultTtsConfigId` → `PersonalityDefaultTtsConfig` → `getFreeDefaultConfig()` from DB → hardcoded fallback.

**Caching**: same as `LlmConfigResolver` — `${userId}-${personalityId}` key, `INTERVALS.API_KEY_CACHE_TTL`, `TtsConfigCacheInvalidationService` parallel to `LlmConfigCacheInvalidationService.ts:48-101`. Redis pub/sub channel `TTS_CONFIG_CACHE_INVALIDATION` added to `REDIS_CHANNELS` in `packages/common-types/src/constants/queue.ts`.

**Return shape**:

```ts
export interface ResolvedTtsConfig {
  provider: TtsProviderId;
  modelId: string | null;
  advancedParameters: TtsAdvancedParams;
  source: 'user-personality' | 'user-default' | 'personality' | 'free-default' | 'hardcoded';
  configName?: string;
}
```

**Provider-instantiation separation**: the resolver returns `ResolvedTtsConfig` only. `TTSStep` consults a provider registry (`Map<TtsProviderId, TtsProvider>`) to pick the implementation. Providers have lifecycle state; resolver doesn't own them.

**Resolver-level `PreparedTts` cache** (Kimi's catch): `Map<${providerId}:${slug}, PreparedTts>` keyed by provider+slug. Single-instance bot-client, no Redis needed. Without this, every Discord message re-clones (ElevenLabs/Mistral) or re-fetches reference audio. TTL similar to existing voice caches (~30 min).

---

## 5. The `MistralTtsProvider` (was OpenRouterTtsProvider)

**Location**: `services/ai-worker/src/services/voice/providers/MistralTtsProvider.ts`. Companion stateless HTTP module: `services/ai-worker/src/services/voice/MistralTtsClient.ts` (parallels `ElevenLabsClient.ts`).

**Endpoints** (per Mistral docs, confirmed by smoke test in next session):

- `POST /v1/voices` — create voice. Body: `{ name, sample_audio: <base64>, sample_filename, languages?, gender?, age?, tags?, slug? }`. Returns `{ voice_id, ... }`.
- `GET /v1/voices` — list voices in account.
- `DELETE /v1/voices/{voice_id}` — remove voice (for slot eviction if Mistral has account quota).
- `POST /v1/audio/speech` — synthesize. Body shape TBD by smoke test, but expected: `{ model: 'voxtral-mini-2603', input: <text>, voice: <voice_id>, response_format: 'mp3' | 'wav' }`.

**Auth**: `Authorization: Bearer ${MISTRAL_API_KEY}`. New API key in user config alongside existing ElevenLabs/OpenRouter keys.

**Voice lifecycle** (mirrors `ElevenLabsVoiceService.ts:74-113`):

1. List voices on first prepare(): `GET /v1/voices`.
2. If voice with name `tzurot-${slug}` exists, cache its `voice_id` → return `PreparedTts { kind: 'voiceId', id, provider: 'mistral' }`.
3. If not, fetch reference audio from `fetchVoiceReference(slug)`, base64-encode, POST to `/v1/voices`. Cache result.
4. On account quota error: provider-internal eviction (same `evictAndClone` pattern as ElevenLabs, gated by mutex per below). TBD if Mistral has slot quotas — confirm via smoke test.

**`buildVoxtralSpeechBody()` isolated function** (GLM + Kimi catch): wraps the speech-synthesis request body construction. When Mistral changes API shape, you touch one function. Free engineering hygiene.

**`buildVoxtralVoiceCreateBody()` isolated** likewise for the create-voice request.

**Eviction mutex** (three-council convergent): if Mistral has slot quota, the eviction critical section is wrapped in a promise-chain mutex:

```ts
private evictionLock = Promise.resolve();
async prepare(ctx): Promise<PreparedTts> {
  const next = this.evictionLock.then(() => this.prepareInner(ctx));
  this.evictionLock = next.catch(() => {});  // don't poison the chain
  return next;
}
```

Five lines, no library, prevents the double-evict race GLM traced.

**Restart resilience for hash tracking**: encode the audio hash in the Mistral voice's `description` field as `tzurot:${hash}`. On `listVoices()`, parse the description to recover the hash without DB schema cost.

---

## 6. Audio format normalization (Kimi's catch)

Different providers accept/return different formats. ElevenLabs accepts MP3/WAV/m4a, Voxtral accepts what Mistral docs describe as base64 with `sample_filename` for format detection (probably MP3/WAV/Opus), Kyutai may need specific sample rate.

**Decision**: gateway returns canonical format. `fetchVoiceReference(slug)` in `services/api-gateway/src/routes/public/voiceReferences.ts` returns PCM WAV 16-bit 24kHz mono. If gateway can't run ffmpeg (Railway constraints), fall back: shared `normalizeAudio(buffer): Promise<Buffer>` utility in `packages/common-types/src/utils/` that providers call from `prepare()` before encoding/uploading.

**Verify during PR 1**: does the existing api-gateway voice-reference endpoint already normalize, or pass through raw user-uploaded audio? If pass-through, the normalization layer is part of PR 1. If already normalized, just confirm format matches what providers expect.

---

## 7. Cost telemetry (Kimi's catch — implement now)

The entire epic is justified by an 85% cost reduction. Cannot claim victory without metrics.

**Implementation**: one log line per synthesis call inside each provider's `synthesize()`:

```ts
logger.info(
  {
    event: 'tts.synthesize',
    provider: this.id,
    model: ctx.modelId,
    charCount: text.length,
    durationMs: Date.now() - start,
    // Optional: outputBytes from response for size-vs-text correlation
  },
  'TTS synthesis'
);
```

Aggregate later via log sink. Free observability win. Surfaces cost reduction empirically and helps debug fallback behavior.

---

## 8. `TTSStep` refactor

**Current** (`TTSStep.ts:137-159`): hardcoded "if BYOK ElevenLabs key, use that, else self-hosted."

**Future**:

1. Resolve `ResolvedTtsConfig` from `TtsConfigResolver.resolve(userId, personalityId)`.
2. Build the **fallback chain**: ordered list of available providers based on resolved config + `isAvailable(ctx)`.
3. Walk the chain via `TtsDispatcher`: for each provider, check `canHandle(config, ctx)`; if yes, call `prepare()` (cached at resolver level), then `synthesize()`. On any error where `isFallbackEligible: true`, try next. On `isFallbackEligible: false`, propagate immediately.
4. Outer `Promise.race` with `TTS_MAX_TOTAL_MS` (240s) preserved but applied to the **entire lifecycle** (prepare + synthesize), not just synthesis (Gemini's gotcha caught the budget-scope issue).

**Default fallback order**: resolved provider first → self-hosted always last (if `VOICE_ENGINE_URL` configured) — the safety net stays.

**Provider registry**: module-level `Map<TtsProviderId, TtsProvider>` constructed lazily. Reset hook for tests: `resetTtsProviderRegistry()`.

**TtsDispatcher extraction**: `services/ai-worker/src/services/voice/TtsDispatcher.ts`. `TTSStep.process` becomes ~80 lines (prerequisite checks + delegate + log).

---

## 9. Settings UX — `/settings tts ...`

Match `/settings preset ...` shape exactly (settings/index.ts:344-397).

Subcommands:

- `/settings tts browse` — list all TtsConfigs (global + user-owned)
- `/settings tts set personality:<x> tts:<y>` — per-personality override
- `/settings tts reset personality:<x>` — clear per-personality override
- `/settings tts default tts:<y>` — set user global default
- `/settings tts clear-default` — clear user global default

Files (mirror `services/bot-client/src/commands/settings/preset/`): browse.ts, set.ts, reset.ts, default.ts, clear-default.ts, autocomplete.ts, guestModeValidation.ts.

**BYOK validation** (block at command time, not at synthesis):

- Mistral provider selected without Mistral key → "Configure your Mistral key first via `/settings apikey set`"
- ElevenLabs provider selected without ElevenLabs key → same shape
- Self-hosted: always allowed

**Old `/settings voices model`** removed in the hard-cutover migration. Bot-client deletes the dashboard at `commands/settings/voices/model.ts` as part of PR 3.

**Gateway routes** (mirror `services/api-gateway/src/routes/user/llm-config.ts`):

- `services/api-gateway/src/routes/user/tts-config.ts` — list/get/create/update/delete user TtsConfigs
- `services/api-gateway/src/routes/admin/tts-config.ts` — admin-only global TtsConfig management
- `services/api-gateway/src/services/TtsConfigService.ts` — parallel to `LlmConfigService`

---

## 10. PR breakdown

Three-council convergent: keep 3 PRs separate.

**PR 1 — Foundation** _(no behavior change)_

Schema + interface + refactor of existing services. Hard-cutover migration script. Existing 2 services validate the interface (two implementations against it — Gemini's "validate abstraction with implementation" concern is resolved by this).

- Prisma migration: `tts_configs`, `personality_default_tts_configs`, `User.defaultTtsConfigId`, `UserPersonalityConfig.ttsConfigId`. Seed system-global rows. Migrate `configOverrides.elevenlabsTtsModel` → `tts_configs` row. Drop `elevenlabsTtsModel` field.
- `packages/common-types/src/services/tts/`: `TtsProvider`, `PreparedTts`, `TtsCapabilities`, `TtsProviderError`, `TtsConfigResolver`, `TtsConfigCacheInvalidationService`, `TtsAdvancedParamsSchema`. Extend `ApiErrorCategory` with `VOICE_NOT_FOUND` + `CLONING_FAILED`.
- `services/ai-worker/src/services/voice/providers/SelfHostedTtsProvider.ts` wrapping `VoiceRegistrationService` (kept as internal).
- `services/ai-worker/src/services/voice/providers/ElevenLabsTtsProvider.ts` wrapping `ElevenLabsVoiceService` (kept as internal). Adds `evictionLock` mutex.
- Provider registry module.
- Resolver-level `PreparedTts` cache.
- Cost telemetry log line in both providers.
- Audio format normalization (verify gateway, add `normalizeAudio()` if needed).
- Tests for everything new (`structure.test.ts` colocation enforced).

**PR 2 — Mistral provider + dispatch refactor** _(new BYOK provider)_

Pre-PR-2 gate: Mistral API smoke test confirms request/response shapes.

- `services/ai-worker/src/services/voice/MistralTtsClient.ts` — stateless HTTP functions parallel to `ElevenLabsClient.ts`. Includes `buildVoxtralSpeechBody()` and `buildVoxtralVoiceCreateBody()` as isolated named functions.
- `services/ai-worker/src/services/voice/providers/MistralTtsProvider.ts` — clone-and-cache lifecycle, eviction mutex if Mistral has slot quotas.
- `services/ai-worker/src/services/voice/TtsDispatcher.ts` — the fallback chain walker, respects `isFallbackEligible`.
- `TTSStep.ts` refactor: replace hardcoded branching with `TtsConfigResolver` + dispatcher.
- Plumb Mistral API key via `ApiKeyResolver` (extend, not parallel-build). Add `mistralApiKey?: string` to `ResolvedAuth` if `auth.apiKey` doesn't already cover it (decide empirically).
- Wire `TtsConfigCacheInvalidationService` Redis subscription in ai-worker bootstrap.

**PR 3 — Settings UX + admin routes** _(opt-in user-facing feature)_

- Gateway routes: `routes/user/tts-config.ts`, `routes/admin/tts-config.ts`, `TtsConfigService`.
- Bot-client: `/settings tts ...` subcommand group + handlers + autocomplete + tests.
- Delete `/settings voices model` dashboard (already orphaned post-migration).

Each PR ships green tests, no behavioral regression. PR 1 invisible to users. PR 3 is opt-in.

---

## 11. Identified gotchas

**(a) Outer timeout budget covers full lifecycle, not just synthesis**: Gemini's catch. `prepare()` (cloning) might take 10s; `synthesize()` 2s; budget must wrap both. Move the `Promise.race(TTS_MAX_TOTAL_MS)` outside the dispatcher's per-attempt loop.

**(b) Mistral slot quota — unknown until smoke test**: ElevenLabs has explicit slot caps that drive `evictAndClone`. Mistral docs don't mention a quota. Smoke test should attempt to create more voices than expected free-tier limit and observe error shape. If Mistral has no quota, eviction code is dead — keep the mutex anyway since concurrent clone races can still happen on first-time creation.

**(c) Migration ordering & rollback safety**: `tts_configs` rows referenced by `User.defaultTtsConfigId` mean a rollback that drops the table also nulls the FK. Mitigation: `onDelete: SetNull` on user/personality FK references.

**(d) Voice-engine cold-start**: `waitForVoiceEngine` (`voiceEngineWarmup.ts`) currently called inside `TTSStep.performVoiceEngineTTS:357`. Move into `SelfHostedTtsProvider.prepare()`. Other providers' `prepare()` is fast — dispatcher should NOT pre-warm voice-engine if chosen provider is Mistral/ElevenLabs UNLESS voice-engine is in the fallback chain. The existing "proactive parallel warmup" backlog item folds in cleanly: dispatcher fires `client.getHealth()` fire-and-forget against voice-engine when a non-self-hosted provider is primary.

**(e) Concurrent slot-eviction races**: existing logic in `ElevenLabsVoiceService.evictAndClone:187-254` handles 404-on-double-delete but NOT "both clone over each other" race per GLM trace. Eviction mutex closes this gap. Test: explicit concurrent prepare() calls for two different slugs at max-capacity.

**(f) Smoke test gates PR 2**: Mistral API request/response shapes must be empirically confirmed before code lands. Free tier covers this. Tasks queued for tomorrow: account setup, two-step curl, document in scratch file.

**(g) Test infrastructure**: existing voice tests are mock-heavy. New providers follow same pattern. `structure.test.ts` enforces colocation — every new `.ts` needs `.test.ts`. Estimated 12-15 new test files across PRs.

**(h) Provider id stability as DB contract**: `'self-hosted' | 'elevenlabs' | 'mistral'` strings are stored in DB. Renaming any is a migration. Document loudly in `TtsProviderId` constant.

**(i) ESLint max-lines on TTSStep**: currently 407 lines. PR 1 may temporarily add lines before PR 2's dispatcher extraction reduces it. Watch for it.

**(j) `fallback eligible` taxonomy gotcha**: Kimi's catch. Get it wrong and falling back on a 400 burns credits failing again. Test: synthesize with text >maxCharacters (should NOT fall back), with bogus voice slug (should NOT fall back), with rate-limit injection (should fall back).

---

## 12. Backlog implications

**Phase 1 surfaced — add to `backlog/inbox.md`**:

- _"Reference audio TTLCache in `voiceReferenceHelper.ts`."_ Optimization: cache reference audio buffer for 5min to avoid repeated gateway round-trips. Defer if it bloats Phase 1; ship as Phase 1.5.
- _"Mistral API smoke test results."_ Document empirical request/response shapes in `voice-cloning-2026.md` after smoke test (next session).
- _"Mistral slot quota verification."_ TBD via smoke test. If quota exists, confirm eviction-mutex code paths.
- _"Audio format normalization at gateway."_ Verify or implement during PR 1.

**Phase 2 — NeuTTS Air**:

- TTS preset gains `selfHostedEngine: 'kyutai' | 'neutts-air'` (JSONB advancedParameters, no schema change).
- `services/voice-engine/server.py` adds NeuTTS Air alongside Pocket TTS. Provider doesn't change shape; only request payload to voice-engine carries engine choice.

**Phase 3+ — Kimi's creative additions** (track in inbox now, defer implementation):

- **Budget Guard decorator**: wrap stack to switch to free Kyutai once `MONTHLY_TTS_BUDGET_CENTS` exceeded. Counts characters via cost telemetry log events. Directly serves cost goal as a safety net.
- **Canary synthesis**: when Mistral first lands, run both Mistral and ElevenLabs in parallel for 1% of requests (behind a flag), compare latency/quality, only upload Mistral result. Logs the delta. Empirically validates the 85% claim.
- **Voice fingerprint / embedding**: design `fetchVoiceReference` to eventually return `{ buffer, embedding: Float32Array }`. Today the embedding field is unused; tomorrow it unlocks next-gen providers (e.g., Zonos accepts speaker embeddings) without schema change.
- **OpenRouter TTS as Phase 3 budget tier**: preset-voice models (Kokoro 82M $0.62/1M, GPT-4o Mini TTS $0.60/1M) for users who want minimal cost and accept losing per-persona voice differentiation. Plugs into the abstraction as a fourth provider category.

**Defer to icebox**:

- Streaming TTS responses end-to-end through pipeline (Discord webhook upload is single-attachment; minimal user-facing benefit).
- Output cache for stock phrases (~$6/mo savings post-Mistral migration; doesn't justify cache invalidation complexity).
- Circuit breaker per provider (static fallback chain + cost telemetry logs cover the same need at lower complexity).
- Partial-failure UX footer (`[voice: backup]`); cosmetic; logs surface when fallback fires.

---

## 13. Pre-implementation checklist (tomorrow)

Before any PR 1 code lands:

- [ ] Mistral account setup (console.mistral.ai). Free tier covers smoke test.
- [ ] Empirical smoke test: two-step curl against Mistral API. Confirm `POST /v1/voices` body (base64 reference, response shape) and `POST /v1/audio/speech` body (voice_id usage, response format).
- [ ] Document smoke test in scratch file or directly in `voice-cloning-2026.md`.
- [ ] Confirm gateway `/voice-references/{slug}` returns canonical format or plan `normalizeAudio()` helper.
- [ ] Verify `auth.apiKey` plumbing for Mistral key (reuse vs. new field decision).

Then start PR 1.

---

## Critical Files for Implementation

- `services/ai-worker/src/jobs/handlers/pipeline/steps/TTSStep.ts` — dispatcher refactor target
- `services/ai-worker/src/services/voice/ElevenLabsVoiceService.ts` — slot-eviction logic to preserve verbatim inside `ElevenLabsTtsProvider`; same pattern for `MistralTtsProvider`
- `services/ai-worker/src/services/voice/VoiceRegistrationService.ts` — internals of `SelfHostedTtsProvider`
- `packages/common-types/src/services/LlmConfigResolver.ts` — exact template for `TtsConfigResolver`
- `packages/common-types/src/services/LlmConfigCacheInvalidationService.ts` — template for `TtsConfigCacheInvalidationService`
- `prisma/schema.prisma` — `LlmConfig` (lines 150-189) is schema template
- `services/bot-client/src/commands/settings/preset/default.ts` — UX template for `/settings tts default`
- `services/api-gateway/src/routes/public/voiceReferences.ts` — verify canonical format output
