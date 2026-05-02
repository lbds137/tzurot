# TTS Engine Upgrade Epic — Phase 1 Implementation Plan

> **Status**: Decisions locked 2026-05-01 (three-council review: Gemini 3.1 Pro Preview → GLM 5.1 → Kimi K2.6). Pre-implementation gates closed 2026-05-02 via empirical Mistral smoke test (gates 2/3/4) + supplementary council pass for newly-surfaced design questions (Gemini 3.1 Pro Preview, single-shot consultation 2026-05-02). **Cleared for PR 1 implementation.**
> **Lifecycle**: Build-process doc — DELETE after Phase 1 ships. Architectural rationale lives in `docs/research/voice-cloning-2026.md`; the code itself documents the shipped feature.
> **Created**: 2026-05-01. Last revised: 2026-05-02 post-smoke-test + supplementary council.

**Cross-references**:

- Decision log: [`docs/research/voice-cloning-2026.md`](../../research/voice-cloning-2026.md) — "2026-05-01 TTS Upgrade Decision" section.
- Phased plan summary: [`backlog/active-epic.md`](../../../backlog/active-epic.md).

---

## Pivot from initial plan: Voxtral via direct Mistral, not OpenRouter

**Critical finding during council review**: OpenRouter only proxies `/audio/speech` — it does NOT expose the voices management API needed for Voxtral cloning. Voxtral cloning at the Mistral level uses a two-step pattern: `POST /v1/audio/voices` (create voice from base64 reference audio, returns voice object with `id`) → `POST /v1/audio/speech` (synthesize text with `voice_id`). Structurally identical to ElevenLabs.

**Same $16/1M pricing direct as via OpenRouter** — no markup, free tier available for testing. The 85% cost reduction holds.

**Implication**: Phase 1 BYOK provider is `MistralTtsProvider` (not `OpenRouterTtsProvider`). OpenRouter remains a future option for preset-voice models (Kokoro 82M at $0.62/1M, GPT-4o Mini TTS at $0.60/1M) if a budget tier is ever needed — track as Phase 3.

### Smoke-test confirmed empirical shapes (2026-05-02)

Endpoint paths use the `/v1/audio/` namespace, not `/v1/`:

- `POST /v1/audio/voices` — clone. JSON body: `{ name, sample_audio: <base64>, sample_filename, languages, gender, age, tags, slug }`. Returns full voice object — extract `id`. Mistral SILENTLY DROPS `slug`/`languages`/`gender`/`age`/`tags` on creation; only `name` survives. Implication: cache-key strategy MUST use `name` as the find-or-create key (`tzurot-{personality_slug}`), identical to existing ElevenLabs pattern.
- `POST /v1/audio/speech` — synthesize. JSON body: `{ input, voice_id, model: 'voxtral-mini-tts-latest', response_format: 'wav' | 'mp3' | 'pcm' | 'flac' | 'opus' }`. Response is **always `application/json` with base64 `audio_data` field** (never raw binary, even when `response_format: 'wav'`). `MistralTtsClient` decodes base64 before returning Buffer to caller — ~33% on-wire inflation tolerated.
- `GET /v1/audio/voices` — list. Paginated `?page=1&page_size=50` (default 10, max-confirmed 50). Returns `{ items[], total, page, page_size, total_pages }`. Each item has `user_id: null` for presets, populated UUID for cloned voices. Phase 1 uses `page_size=50` with single-page assumption (>50 user voices is unrealistic at one-voice-per-personality scale); log a warning if pagination boundary is reached without finding the target voice.
- `DELETE /v1/audio/voices/{id}` — remove. Returns 200 with deleted voice body.
- Model name: `voxtral-mini-tts-latest` (or pinned `voxtral-mini-tts-2603`). Distinct from STT siblings (`voxtral-mini-transcribe-2507`, `voxtral-mini-realtime-2602`).
- Latencies (smoke test): clone 332-852ms, synthesize 2-7s for 200-400 char inputs (~14ms/char), delete ~200ms. Within Discord's post-defer budget.
- Input tolerance: Mistral cloned MP3 stereo at 44.1/48kHz without normalization. Gate-3 conclusion: **no `normalizeAudio()` helper needed for Mistral** — pass through gateway bytes verbatim. (See section 6 for output-side normalization which IS required, for an unrelated reason.)

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

**Endpoints** (smoke-test confirmed 2026-05-02):

- `POST /v1/audio/voices` — create voice. JSON body: `{ name, sample_audio: <base64>, sample_filename, languages, gender, age, tags, slug }`. Returns full voice object; extract `id`. Mistral silently drops `slug`/`languages`/`gender`/`age`/`tags` on creation — DO NOT rely on them for lookup.
- `GET /v1/audio/voices` — paginated list. Use `?page=1&page_size=50` to get user voices in one call.
- `DELETE /v1/audio/voices/{id}` — remove voice (for slot eviction if Mistral has account quota).
- `POST /v1/audio/speech` — synthesize. JSON body: `{ input, voice_id, model: 'voxtral-mini-tts-latest', response_format: 'wav' }`. Response is always `application/json` with base64 `audio_data` field — `MistralTtsClient` decodes before returning Buffer.

**Auth**: `Authorization: Bearer ${MISTRAL_API_KEY}`. Plumbed via `audioProviderKeys: Map<AudioProviderId, string>` per the supplementary council decision (see section 7a). One key, all Mistral audio endpoints (TTS now, STT later).

**Voice lifecycle** (mirrors `ElevenLabsVoiceService.ts:74-113`):

1. List voices on first prepare(): `GET /v1/audio/voices?page=1&page_size=50`.
2. If voice with name `tzurot-${slug}` exists in `items[]`, cache its `id` → return `PreparedTts { kind: 'voiceId', id, provider: 'mistral' }`.
3. If not, fetch reference audio from `fetchVoiceReference(slug)`, base64-encode, POST to `/v1/audio/voices` with `name: \`tzurot-${slug}\``. Cache returned `id`.
4. If pagination boundary is reached (>50 user voices) without finding the target name, log a warning and treat as "not found" → clone path. Pagination loop deferred to a backlog item if it ever bites.
5. On account quota error: provider-internal eviction (same `evictAndClone` pattern as ElevenLabs, gated by mutex per below). Mistral slot quota behavior TBD — observed during real usage; if no quota exists, eviction code is dead but mutex still defends against concurrent first-time-create races.

**Critical: name-as-find-key, no DB mapping** — same pattern as `ElevenLabsVoiceService`. The `name` field is the canonical identifier on Mistral's side; the in-memory `TTLCache` is the local fast path. Process restart clears the cache → next request lists Mistral and finds by `name`. NO new DB table, NO `personality_slug → voice_id` migration needed.

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

## 6. Output-side loudness normalization (NEW — supplementary-council 2026-05-02)

**Background**: smoke testing 4 real persona voice references through Mistral surfaced a **13.8 LU spread in synthesis loudness** across personas at default. Mistral preserves per-voice loudness baselines as an emergent function of voice identity — not directly inheritable from reference clip levels.

**Reference-side normalization fails twice**: it only narrowed the spread to 10.3 LU AND audibly distorted vocal character (EBU R128's LRA target applies dynamic range compression that crushes the expressive peaks the model conditions on). User confirmed the distortion subjectively. Skip reference-side normalization entirely.

**Output-side EBU R128 loudnorm works decisively**: 13.8 LU → 1.7 LU spread on the same four personas, no character distortion (output is already post-synthesis flat-ish speech with no expressive dynamics to crush).

### Locked design

- **Target: -14 LUFS** (Spotify standard, supplementary-council verdict over -16 LUFS podcast standard). Reasoning: Discord has no native loudness normalization, users on phones in noisy environments, AI voice has to compete with human-microphone audio. Louder target fits the playback context.
- **Filter spec**: ffmpeg `loudnorm=I=-14:LRA=11:TP=-1.5` (single-pass, sub-second cost on typical Discord voice durations).
- **Output format invariant**: `-ar 24000 -ac 1 -sample_fmt s16 -f wav` (canonical PCM WAV 16-bit / 24kHz / mono — already what Mistral returns; explicit invariant survives provider changes).
- **Placement**: `TTSStep.process()` direct call, post-synthesis, pre-Redis-write. Provider-agnostic (works for ElevenLabs, Mistral, NeuTTS Air, anything we plug in later); centralizes the loudness invariant in one place; no Redis I/O round-trip.

### Implementation sketch

New file `services/ai-worker/src/services/voice/audioNormalizer.ts`:

```ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface NormalizeOptions {
  /** Integrated loudness target in LUFS. Default -14 (Spotify standard). */
  targetLufs?: number;
  /** Loudness range in LU. Default 11. */
  lra?: number;
  /** True peak ceiling in dBTP. Default -1.5. */
  truePeak?: number;
}

export async function normalizeLoudness(
  audioBuffer: Buffer,
  options: NormalizeOptions = {}
): Promise<Buffer> {
  const { targetLufs = -14, lra = 11, truePeak = -1.5 } = options;
  const filter = `loudnorm=I=${targetLufs}:LRA=${lra}:TP=${truePeak}`;
  // execFile with array args: shell-injection-safe per .claude/rules/00-critical.md
  const args = [
    '-i',
    'pipe:0',
    '-af',
    filter,
    '-ar',
    '24000',
    '-ac',
    '1',
    '-sample_fmt',
    's16',
    '-f',
    'wav',
    'pipe:1',
  ];
  const { stdout } = await execFileAsync('ffmpeg', args, {
    input: audioBuffer,
    maxBuffer: 50 * 1024 * 1024,
  });
  return Buffer.from(stdout, 'binary');
}
```

Called from `TTSStep` between provider synthesis and Redis storage:

```ts
const rawAudio = await dispatcher.synthesize(text, prepared);
const normalized = await normalizeLoudness(rawAudio);
const ttsAudioKey = await redisService.storeTTSAudio(normalized, 'audio/wav');
```

### Gateway-side audio normalization: SKIPPED

Original section 6 plan suggested verifying or adding gateway-side `normalizeAudio()`. Smoke test resolved this: Mistral accepts MP3 stereo at 44.1/48kHz directly with no input normalization. **Gate-3 conclusion**: gateway stays pass-through. If a future provider rejects raw user-uploaded audio, that provider's `prepare()` does its own normalization — the abstraction supports per-provider input handling.

### ffmpeg dependency note

Verify ffmpeg is available in the ai-worker container image. If not present, the existing TTS chunker in `services/ai-worker/src/services/voice/ttsSynthesizer.ts` may already shell out to it (the beta.113 CRLF fix touched the multipart pipeline) — check before assuming a new container dependency is needed. If ffmpeg is missing from the image, adding it is a Dockerfile one-liner.

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

## 7a. Auth shape: `audioProviderKeys` map (NEW — supplementary-council 2026-05-02)

The existing `ResolvedAuth.elevenlabsApiKey?: string` named field was a v1 expedient. Adding Mistral surfaces the question: parallel field (`mistralApiKey?: string`) or generalize?

**Locked decision: `audioProviderKeys: Map<AudioProviderId, string>` covering BOTH TTS and STT.**

Rationale: a single Mistral API key authorizes ALL Mistral audio endpoints (`/v1/audio/speech`, `/v1/audio/voices`, `/v1/audio/transcriptions`). Same for ElevenLabs (cloning + TTS + Scribe STT all use one key). The natural domain unit is "audio-provider credentials," not "TTS credentials."

```ts
// packages/common-types/src/types/audio-provider.ts (new)
export type AudioProviderId = 'elevenlabs' | 'mistral';

// services/ai-worker/src/jobs/handlers/pipeline/types.ts — modify ResolvedAuth
export interface ResolvedAuth {
  apiKey: string | undefined; // LLM key (unchanged)
  provider: AIProvider | undefined;
  isGuestMode: boolean;
  // NEW: replaces `elevenlabsApiKey?: string`
  audioProviderKeys: ReadonlyMap<AudioProviderId, string>;
  wasAutoPromoted?: boolean;
  fallback?: FallbackRoute;
}
```

`AuthStep.process()` populates the map by iterating known audio providers and calling `apiKeyResolver.resolveApiKey(userId, AIProvider.<X>)` for each (existing pattern used for ElevenLabs today). Empty map = no audio-provider keys configured = guest path.

**Migration of existing consumers**:

- `TTSStep.ts:138`: `const elevenlabsApiKey = context.auth?.elevenlabsApiKey;` → resolved via dispatcher from map.
- `MultimodalProcessor.ts`, `ConversationInputProcessor.ts`, `AttachmentProcessor.ts`, `ConversationalRAGTypes.ts`, `ConversationalRAGService.ts` (all currently consume `elevenlabsApiKey`) → swap to `auth.audioProviderKeys.get('elevenlabs')` or accept the map and let downstream pick. STT consumer (`AudioProcessor.transcribeAudio`) reads from the map but stays pinned to ElevenLabs as the active STT engine until the deferred cutover decision (section 7b).

This consolidates ~6 files' worth of named-field plumbing into one consistent shape. The diff is bigger than mirroring ElevenLabs would be, but it pays for itself the moment we add the second consumer (STT cutover, future provider, anything).

`ApiKeyResolver` already keys by `AIProvider` enum — no change needed there. `AIProvider.Mistral = 'mistral'` enum entry is added in PR 1 for the resolver's benefit; the audio-provider map and the LLM-provider enum are independent namespaces (audio-provider IDs are stable DB strings; LLM-provider enum is internal routing).

## 7b. STT cutover scope: Phase 1 plumbs only; flip happens in epic Phase 3 (NEW — supplementary-council 2026-05-02; revised 2026-05-02 by user to in-epic framing)

**Locked decision: PR 1 ships the auth plumbing for both TTS and STT (via `audioProviderKeys` map per section 7a) but only the TTS consumer is migrated. The STT consumer (`AudioProcessor.transcribeAudio`) stays pointed at ElevenLabs Scribe. The actual STT cutover happens in Phase 3 of the epic, gated on a quality benchmark.**

Rationale: Mistral STT (Voxtral Mini Transcribe / Realtime) quality on multilingual content is unmeasured. Bundling an unmeasured STT swap into Phase 1's PR 1 risks a UX regression that blocks the TTS deployment for unrelated reasons. By using the `audioProviderKeys` map shape now, the auth plumbing is in place when Phase 3 fires — Phase 3's actual code change is a one-line consumer swap.

**Why in-epic, not "deferred until renewal"**: the user's framing (2026-05-02) is that the epic-complete bar requires the FULL ElevenLabs cutover — both subscription line items. Punting STT to "renewal time" turns the epic into a half-victory and risks the cutover never actually shipping. Pulling STT inside as Phase 3 makes the completion criteria explicit: ElevenLabs subscription gone entirely.

**Phase 3 work** (lives in `backlog/active-epic.md`, not this build-process doc):

- Capture ~20 representative real voice messages (English + Hebrew/multilingual mix).
- Run benchmark: WER + qualitative accuracy comparison Mistral Voxtral Transcribe vs ElevenLabs Scribe on the sample.
- If pass: flip the consumer (one-line change in `AudioProcessor`), add STT cost telemetry log line parallel to TTS, document benchmark methodology + result, cancel ElevenLabs subscription.
- If fail: escalate. Alternatives include keeping ElevenLabs Scribe but downgrading plan, evaluating other STT providers, or accepting partial cutover (TTS cost reduction without STT). Phase 3 ships either way — even a "stay on ElevenLabs Scribe" outcome is documented as the gate's verdict.

## 8. `TTSStep` refactor

**Current** (`TTSStep.ts:137-159`): hardcoded "if BYOK ElevenLabs key, use that, else self-hosted."

**Future**:

1. Resolve `ResolvedTtsConfig` from `TtsConfigResolver.resolve(userId, personalityId)`.
2. Build the **fallback chain**: ordered list of available providers based on resolved config + `isAvailable(ctx)`. Provider availability uses `auth.audioProviderKeys.has(providerId)` for BYOK providers.
3. Walk the chain via `TtsDispatcher`: for each provider, check `canHandle(config, ctx)`; if yes, call `prepare()` (cached at resolver level), then `synthesize()`. On any error where `isFallbackEligible: true`, try next. On `isFallbackEligible: false`, propagate immediately.
4. **Output-side loudness normalization** (section 6): `await normalizeLoudness(rawAudio)` before Redis write. One call site, applies regardless of which provider produced the audio. Keep inside the outer timeout race so a stuck normalizer doesn't deadlock the pipeline.
5. Outer `Promise.race` with `TTS_MAX_TOTAL_MS` (240s) preserved but applied to the **entire lifecycle** (prepare + synthesize + normalize), not just synthesis (Gemini's gotcha caught the budget-scope issue).

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
- `packages/common-types/src/types/audio-provider.ts`: `AudioProviderId` type alias (`'elevenlabs' | 'mistral'`). Add `AIProvider.Mistral` enum entry.
- **Auth shape change**: `ResolvedAuth.elevenlabsApiKey?: string` → `audioProviderKeys: ReadonlyMap<AudioProviderId, string>`. Update `AuthStep` to populate map; migrate ~6 consumer files (TTSStep, MultimodalProcessor, ConversationInputProcessor, AttachmentProcessor, ConversationalRAGTypes, ConversationalRAGService). STT consumer reads from map but stays pinned to ElevenLabs (per section 7b).
- `services/ai-worker/src/services/voice/providers/SelfHostedTtsProvider.ts` wrapping `VoiceRegistrationService` (kept as internal).
- `services/ai-worker/src/services/voice/providers/ElevenLabsTtsProvider.ts` wrapping `ElevenLabsVoiceService` (kept as internal). Adds `evictionLock` mutex.
- Provider registry module.
- Resolver-level `PreparedTts` cache.
- Cost telemetry log line in both providers.
- **Output-side loudness normalizer** (section 6): `services/ai-worker/src/services/voice/audioNormalizer.ts` with `normalizeLoudness()`. Called from `TTSStep.process()` post-synthesis. Verify ffmpeg availability in ai-worker container.
- Tests for everything new (`structure.test.ts` colocation enforced).

**PR 2 — Mistral provider + dispatch refactor** _(new BYOK provider)_

Pre-PR-2 gate: ✅ smoke test cleared 2026-05-02. Endpoint paths, request/response shapes, model name, latencies all empirically confirmed.

- `services/ai-worker/src/services/voice/MistralTtsClient.ts` — stateless HTTP functions parallel to `ElevenLabsClient.ts`. Includes `buildVoxtralSpeechBody()` and `buildVoxtralVoiceCreateBody()` as isolated named functions. Decodes JSON-wrapped base64 `audio_data` → Buffer at the boundary.
- `services/ai-worker/src/services/voice/providers/MistralTtsProvider.ts` — clone-and-cache lifecycle keyed by `name: \`tzurot-${slug}\``, page_size=50 list-and-find on cache miss, eviction mutex if Mistral has slot quotas (defensive; quota behavior TBD).
- `services/ai-worker/src/services/voice/TtsDispatcher.ts` — the fallback chain walker, respects `isFallbackEligible`. Reads `auth.audioProviderKeys` for BYOK availability checks.
- `TTSStep.ts` refactor: replace hardcoded branching with `TtsConfigResolver` + dispatcher. Output normalizer call sits between dispatch and Redis write.
- API key for Mistral is plumbed via the `audioProviderKeys` map already established in PR 1 — PR 2 just adds Mistral as an `AudioProviderId` enum value the map populates.
- Wire `TtsConfigCacheInvalidationService` Redis subscription in ai-worker bootstrap.

**PR 3 — Settings UX + admin routes** _(opt-in user-facing feature)_

- Gateway routes: `routes/user/tts-config.ts`, `routes/admin/tts-config.ts`, `TtsConfigService`.
- Bot-client: `/settings tts ...` subcommand group + handlers + autocomplete + tests.
- Delete `/settings voices model` dashboard (already orphaned post-migration).

Each PR ships green tests, no behavioral regression. PR 1 invisible to users. PR 3 is opt-in.

---

## 11. Identified gotchas

**(a) Outer timeout budget covers full lifecycle, not just synthesis**: Gemini's catch. `prepare()` (cloning) might take 10s; `synthesize()` 2s; budget must wrap both. Move the `Promise.race(TTS_MAX_TOTAL_MS)` outside the dispatcher's per-attempt loop.

**(b) Mistral slot quota — still TBD**: smoke test (4 clones + deletes) was insufficient to probe quota limits. Mistral docs don't mention an account-level limit. PR 2 keeps the eviction code defensively, but it may never fire in practice. The mutex is kept regardless to defend against concurrent first-time-create races (two simultaneous prepare() calls for different slugs at fresh-account state could otherwise both POST and produce duplicate `tzurot-X` voices).

**(c) Migration ordering & rollback safety**: `tts_configs` rows referenced by `User.defaultTtsConfigId` mean a rollback that drops the table also nulls the FK. Mitigation: `onDelete: SetNull` on user/personality FK references.

**(d) Voice-engine cold-start**: `waitForVoiceEngine` (`voiceEngineWarmup.ts`) currently called inside `TTSStep.performVoiceEngineTTS:357`. Move into `SelfHostedTtsProvider.prepare()`. Other providers' `prepare()` is fast — dispatcher should NOT pre-warm voice-engine if chosen provider is Mistral/ElevenLabs UNLESS voice-engine is in the fallback chain. The existing "proactive parallel warmup" backlog item folds in cleanly: dispatcher fires `client.getHealth()` fire-and-forget against voice-engine when a non-self-hosted provider is primary.

**(e) Concurrent slot-eviction races**: existing logic in `ElevenLabsVoiceService.evictAndClone:187-254` handles 404-on-double-delete but NOT "both clone over each other" race per GLM trace. Eviction mutex closes this gap. Test: explicit concurrent prepare() calls for two different slugs at max-capacity.

**(f) Smoke test gates PR 2**: ✅ CLOSED 2026-05-02. Empirical confirmation of endpoints, request bodies, response shapes, model name, latencies, input format tolerance. Findings folded into section 5 + the top-of-doc "Smoke-test confirmed empirical shapes" block. Real-voice round-trip (Emily, Emberlynn, Charlie, Speaker of God) validated cloning quality as comparable to ElevenLabs per user listening test.

**(g) Test infrastructure**: existing voice tests are mock-heavy. New providers follow same pattern. `structure.test.ts` enforces colocation — every new `.ts` needs `.test.ts`. Estimated 12-15 new test files across PRs.

**(h) Provider id stability as DB contract**: `'self-hosted' | 'elevenlabs' | 'mistral'` strings are stored in DB. Renaming any is a migration. Document loudly in `TtsProviderId` constant.

**(i) ESLint max-lines on TTSStep**: currently 407 lines. PR 1 may temporarily add lines before PR 2's dispatcher extraction reduces it. Watch for it.

**(j) `fallback eligible` taxonomy gotcha**: Kimi's catch. Get it wrong and falling back on a 400 burns credits failing again. Test: synthesize with text >maxCharacters (should NOT fall back), with bogus voice slug (should NOT fall back), with rate-limit injection (should fall back).

**(k) Output normalizer in the timeout race** (NEW 2026-05-02): `normalizeLoudness()` shells out to ffmpeg and could in theory hang. Keep it inside the outer `Promise.race(TTS_MAX_TOTAL_MS)` so a stuck ffmpeg child process doesn't deadlock the pipeline. ffmpeg has its own internal limits but a `child_process.execFile` with `maxBuffer` and external `signal: AbortSignal.timeout()` gives belt-and-suspenders. Test: inject a misbehaving normalizer mock and verify outer timeout still fires.

**(l) Empirical-verified pagination assumption** (NEW 2026-05-02): smoke-tested `?page_size=50` works. Phase 1 assumes a single page is sufficient for typical usage (one voice per personality; bot's persona count is well under 50). If a user accumulates >50 cloned voices, list-and-find could miss the target on cache miss → re-clone → duplicate `tzurot-X` voice. Mitigation: PR 2 logs a warning when the boundary is hit; a follow-up backlog item adds a proper pagination loop only if the warning ever fires.

**(m) Output-normalization is provider-policy in PR 1** (NEW 2026-05-02): hardcoded -14 LUFS / LRA=11 / TP=-1.5 in the helper. Per `02-code-standards.md` "no premature abstraction": don't add a knob nobody asked for. If a future per-personality "soft voice" preference emerges, lifting the constants to a `TtsConfigResolver`-derived value is straightforward — the call site already has the resolved config. Don't pre-design for it now.

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

## 13. Pre-implementation checklist — ✅ ALL CLOSED 2026-05-02

- [x] Mistral account setup. Free tier validated.
- [x] Empirical smoke test: clone (`POST /v1/audio/voices`) + synthesize (`POST /v1/audio/speech`) + delete (`DELETE /v1/audio/voices/{id}`) round-trip with real persona references (Emily, Emberlynn, Charlie, Speaker of God). User confirmed cloning quality comparable to ElevenLabs.
- [x] Findings documented in `docs/research/voice-cloning-2026.md` "2026-05-02 Mistral smoke test" section.
- [x] Gateway audio format question settled: Mistral accepts MP3 stereo at 44.1/48kHz directly. **No `normalizeAudio()` gateway helper needed.** Output-side EBU R128 loudnorm at -14 LUFS in TTSStep is the actual normalization layer (section 6).
- [x] Auth plumbing decision: `audioProviderKeys: ReadonlyMap<AudioProviderId, string>` covering both TTS and STT for both providers (section 7a).
- [x] Supplementary council pass on Q1 (LUFS target), Q2 (normalizer placement), Q3 (auth shape), Q4 (STT scope), Q5 (ref_audio): all 5 decisions locked.

**PR 1 cleared to start.**

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
