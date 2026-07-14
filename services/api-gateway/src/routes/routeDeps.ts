/**
 * Shared deps object for all route handlers.
 *
 * Every named handler export (`handleXxx`) accepts a `RouteDeps`
 * parameter and dot-accesses the specific dependencies it needs. This
 * keeps the codegen-generated `mounts.ts` uniform — every route is
 * mounted as `handleXxx(deps)` regardless of which specific deps the
 * handler uses.
 *
 * Alternative shape considered: per-handler dep signatures (e.g.,
 * `handleCreatePersonality(prisma, cacheInvalidation)`). Rejected
 * because the codegen would need per-route metadata about which deps
 * each handler needs — a maintenance surface that drifts silently. The
 * uniform shape costs a slightly larger interface but eliminates a
 * class of mounting bugs.
 *
 * Required fields (`prisma`) are non-optional. Optional fields are
 * marked `?` and the handler short-circuits with a 503 (or similar) if
 * a required-at-runtime dep is missing — same semantics as the legacy
 * aggregator-router pattern where `if (denylistInvalidation !==
 * undefined)` gated whole router blocks.
 *
 * Adding a new dep: add the field here (optional unless every handler
 * needs it), then any handler that needs it dot-accesses
 * `deps.theNewDep`. Generator emission and mount composition are
 * unchanged.
 */

import type { Queue, QueueEvents } from 'bullmq';
import type { Redis } from 'ioredis';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import type {
  ApiKeyCacheInvalidationService,
  CacheInvalidationService,
  ConfigCascadeCacheInvalidationService,
  DenylistCacheInvalidationService,
  LlmConfigCacheInvalidationService,
  SttResolverCacheInvalidationService,
  SystemSettingsCacheInvalidationService,
  TtsConfigCacheInvalidationService,
} from '@tzurot/cache-invalidation';
import type {
  ConfigCascadeResolver,
  LlmConfigResolver,
  VisionConfigResolver,
} from '@tzurot/config-resolver';
import type { ConversationRetentionService } from '@tzurot/conversation-history';
import type { OpenRouterModelCache } from '../services/OpenRouterModelCache.js';

export interface RouteDeps {
  // Always required — every handler needs DB access.
  readonly prisma: PrismaClient;

  /**
   * Dedicated fast-pool client for the latency-sensitive conversation-event
   * persist writes (user/assistant message). Tight, staggered finite timeouts
   * so a stuck single-row write fails fast + LOUD instead of hanging to
   * bot-client's ~20s abort. Optional: only the two persist handlers use it
   * (`deps.fastPrisma ?? deps.prisma`), and it degrades to the main pool if the
   * gateway didn't build one. See `fastPoolConnectionOptions` + `verifyPoolTimeouts`.
   */
  readonly fastPrisma?: PrismaClient;

  // ---- Cache-invalidation services (route-specific) ----------------------

  /** Generic invalidation orchestrator — used by /admin/invalidate-cache. */
  readonly cacheInvalidationService?: CacheInvalidationService;
  /** LLM config cache pub/sub — used by user+admin LLM config CRUD. */
  readonly llmConfigCacheInvalidation?: LlmConfigCacheInvalidationService;
  /** TTS config cache pub/sub — used by user+admin TTS config CRUD. */
  readonly ttsConfigCacheInvalidation?: TtsConfigCacheInvalidationService;
  /** Denylist cache pub/sub — used by admin denylist CRUD. */
  readonly denylistInvalidation?: DenylistCacheInvalidationService;
  /** Cascade-overrides cache pub/sub — admin settings + user channel config. */
  readonly cascadeInvalidation?: ConfigCascadeCacheInvalidationService;
  /** STT-resolver cache pub/sub — user STT-override CRUD. */
  readonly sttResolverCacheInvalidation?: SttResolverCacheInvalidationService;
  /** BYOK key cache pub/sub — user wallet routes. */
  readonly apiKeyCacheInvalidation?: ApiKeyCacheInvalidationService;
  /** System-settings cache pub/sub — the admin system-settings write route. */
  readonly systemSettingsInvalidation?: SystemSettingsCacheInvalidationService;

  // ---- Cross-cutting services -------------------------------------------

  /** Conversation retention sweep — used by admin cleanup. */
  readonly retentionService?: ConversationRetentionService;
  /** Cascade-overrides resolver — the pub/sub-invalidated singleton. Required
   * at the type level: a locally-constructed fallback would never hear
   * invalidation events and serve stale config, so a miswiring (production or
   * test) must surface at compile time, not mount time. */
  readonly cascadeResolver: ConfigCascadeResolver;
  /**
   * LLM model-config cascade resolver — used by the /ai/generate handler to
   * resolve the text `model` once at job-chain build and stamp it onto both the
   * conversation job and the image-description child job. Keeps the seed
   * (personality default) from leaking into the image-description path.
   */
  readonly llmConfigResolver: LlmConfigResolver;
  /**
   * Vision model-config cascade resolver (kind='vision'). Resolves the vision model
   * independently of the text model and stamps `personality.visionModel` at job-chain
   * build (the carrier `selectVisionModel` reads at priority 1).
   */
  readonly visionConfigResolver?: VisionConfigResolver;
  /** OpenRouter model catalog cache — used by LLM config endpoints. */
  readonly modelCache?: OpenRouterModelCache;

  // ---- Infrastructure singletons ---------------------------------------

  /** Redis client (general purpose). */
  readonly redis?: Redis;
  /** BullMQ queue for AI generation jobs. */
  readonly aiQueue?: Queue;
  /** BullMQ queue for release-broadcast DM batches (consumed by bot-client). */
  readonly releaseBroadcastQueue?: Queue;
  /** BullMQ queue events for sync-completion waiting. */
  readonly queueEvents?: QueueEvents;
}
