/**
 * Internal route manifest — service-to-service endpoints.
 *
 * Mounted at `/api/internal/*` after the route-prefix cutover (currently the
 * legacy URLs at `/ai/*`, `/internal/*`, and a few `/user/*` and `/admin/*`
 * paths still serve traffic; the manifest declares the post-cutover URLs).
 *
 * No human actor — these routes are called by bot-client (or another tzurot
 * service) using only `X-Service-Auth`. The generated `ServiceClient` methods
 * never accept an `actor` argument.
 *
 * Audience invariant: every entry below has `audience: 'internal'` and
 * `serviceOnly: true`. The manifest-invariant test enforces.
 */

import { z } from 'zod';
import { TIMEOUTS, VALIDATION_TIMEOUTS } from '@tzurot/common-types/constants/timing';
import { DiagnosticUpdateSchema } from '@tzurot/common-types/schemas/api/admin';
import {
  ReleaseBroadcastDeliveriesInputSchema,
  ReleaseBroadcastDeliveriesResponseSchema,
  ReleaseBroadcastPendingInputSchema,
  ReleaseBroadcastPendingResponseSchema,
  ReleaseReconcileInputSchema,
  ReleaseReconcileResponseSchema,
} from '@tzurot/common-types/schemas/api/broadcast';
import { AdminSettingsSchema } from '@tzurot/common-types/schemas/api/adminSettings';
import {
  AiConfirmDeliveryResponseSchema,
  AiGenerateResponseSchema,
  AiJobStatusResponseSchema,
  AiTranscribeResponseSchema,
} from '@tzurot/common-types/schemas/api/ai';
import { GetChannelSettingsResponseSchema } from '@tzurot/common-types/schemas/api/channel';
import { DenylistCacheResponseSchema } from '@tzurot/common-types/schemas/api/denylist';
import { DiagnosticUpdateResponseSchema } from '@tzurot/common-types/schemas/api/diagnostic';
import {
  ConversationSyncRequestSchema,
  ConversationSyncResponseSchema,
  DmSessionSetRequestSchema,
  DmSessionSetResponseSchema,
  LoadPersonalityInternalResponseSchema,
  MessagePersonalityResponseSchema,
  PersistAssistantMessageRequestSchema,
  PersistAssistantMessageResponseSchema,
  PersistUserMessageRequestSchema,
  PersistUserMessageResponseSchema,
  RecentUsersResponseSchema,
  RoutingContextRequestSchema,
  RoutingContextResponseSchema,
} from '@tzurot/common-types/schemas/api/internal';
import { ModelsListResponseSchema } from '@tzurot/common-types/schemas/api/models';
import { TranscribeRequestSchema } from '@tzurot/common-types/schemas/api/transcribe';
import { generateRequestSchema } from '@tzurot/common-types/types/schemas/generation';

// generateRequestSchema lives under the `types/schemas/` module rather than
// the `schemas/api/` barrel (it predates the API-schema reorganization). The
// route-manifest treats them uniformly via the import below.

import type { RouteDef } from './types.js';

/**
 * The internal route registry. Each entry is declared `as const satisfies RouteDef`
 * so TypeScript preserves literal types (id, audience, method, path) for the
 * manifest-invariant tests AND the generator's string-template emission.
 */
export const internalRoutes = {
  /**
   * POST /api/internal/ai/generate
   * Submits an async AI generation job. Currently mounted at `/ai/generate`;
   * the cutover relocates it under `/api/internal/`.
   */
  aiGenerate: {
    audience: 'internal',
    method: 'post',
    path: '/ai/generate',
    id: 'aiGenerate',
    input: generateRequestSchema,
    output: AiGenerateResponseSchema,
    serviceOnly: true,
    // api-gateway downloads extended-context attachments synchronously inside
    // the handler before responding, so submit time scales with payload size
    // and can exceed 10s on large attachment payloads. 60s accommodates that.
    timeoutMs: TIMEOUTS.AI_GENERATE_SUBMIT,
  },

  /**
   * POST /api/internal/ai/transcribe
   * Submits an audio transcription job (sync via `?wait=true` or async otherwise).
   */
  aiTranscribe: {
    audience: 'internal',
    method: 'post',
    path: '/ai/transcribe',
    id: 'aiTranscribe',
    input: TranscribeRequestSchema,
    output: AiTranscribeResponseSchema,
    serviceOnly: true,
  },

  /**
   * GET /api/internal/ai/job/:jobId
   * BullMQ job introspection — debugging endpoint.
   */
  aiJobStatus: {
    audience: 'internal',
    method: 'get',
    path: '/ai/job/:jobId',
    id: 'aiJobStatus',
    params: { jobId: z.string() },
    output: AiJobStatusResponseSchema,
    serviceOnly: true,
    meta: { safeRead: true },
  },

  /**
   * POST /api/internal/ai/job/:jobId/confirm-delivery
   * Bot-client acknowledges the job result was delivered to Discord. Idempotent.
   */
  aiConfirmDelivery: {
    audience: 'internal',
    method: 'post',
    path: '/ai/job/:jobId/confirm-delivery',
    id: 'aiConfirmDelivery',
    params: { jobId: z.string() },
    output: AiConfirmDeliveryResponseSchema,
    serviceOnly: true,
  },

  /**
   * DM worker's stall-rerun guard: returns the subset of a batch's delivery
   * rows still pending, so a re-run batch never double-DMs.
   */
  releaseBroadcastPending: {
    audience: 'internal',
    method: 'post',
    path: '/release-broadcast/:releaseId/pending',
    id: 'releaseBroadcastPending',
    params: { releaseId: z.string().uuid() },
    input: ReleaseBroadcastPendingInputSchema,
    output: ReleaseBroadcastPendingResponseSchema,
    serviceOnly: true,
  },

  /**
   * DM worker reports per-recipient delivery outcomes. Idempotent
   * (pending→terminal transitions only); auto-disables notifyEnabled on a
   * user's second consecutive permanent failure.
   */
  releaseBroadcastDeliveries: {
    audience: 'internal',
    method: 'post',
    path: '/release-broadcast/:releaseId/deliveries',
    id: 'releaseBroadcastDeliveries',
    params: { releaseId: z.string().uuid() },
    input: ReleaseBroadcastDeliveriesInputSchema,
    output: ReleaseBroadcastDeliveriesResponseSchema,
    serviceOnly: true,
  },

  /**
   * Release reconcile sweep: compares the GitHub releases API against
   * release_announcements and announces anything missing (bounded lookback).
   * Called hourly by ai-worker's scheduled job; doubles as the manual
   * catch-up lever for a release the hourly window aged out.
   */
  releaseBroadcastReconcile: {
    audience: 'internal',
    method: 'post',
    path: '/release-broadcast/reconcile',
    id: 'releaseBroadcastReconcile',
    input: ReleaseReconcileInputSchema,
    output: ReleaseReconcileResponseSchema,
    serviceOnly: true,
    timeoutMs: 30_000,
    externalCallBudgetMs: VALIDATION_TIMEOUTS.EXTERNAL_GITHUB_API_CALL,
  },

  /**
   * POST /api/internal/channel/dm-session/set
   * Bot-client records the active personality for a DM channel after
   * multi-tag selection.
   */
  setDmSession: {
    audience: 'internal',
    method: 'post',
    path: '/channel/dm-session/set',
    id: 'setDmSession',
    input: DmSessionSetRequestSchema,
    output: DmSessionSetResponseSchema,
    serviceOnly: true,
  },

  /**
   * GET /api/internal/conversation/message-personality
   * Looks up the personality that owns a given Discord message ID, by query
   * param. Used by bot-client's reply-resolution path.
   *
   * Currently mounted at /user/conversation/message-personality but has no
   * human-actor auth — the manifest reclassifies it as internal so the
   * audience matches what the auth contract actually is.
   */
  lookupPersonalityFromMessage: {
    audience: 'internal',
    method: 'get',
    path: '/conversation/message-personality',
    id: 'lookupPersonalityFromMessage',
    query: { discordMessageId: z.string() },
    output: MessagePersonalityResponseSchema,
    serviceOnly: true,
    meta: { safeRead: true },
    timeoutMs: TIMEOUTS.GATEWAY_RPC,
  },

  /**
   * POST /api/internal/conversation/assistant-message
   * Bot-client persists the assistant turn after Discord delivery succeeds
   * (the gateway derives the deterministic row id, +1ms timestamp, and token
   * count). Idempotent upsert-with-compare — during the dual-write window an
   * existing row is compared, not overwritten, and `matched: false` is the
   * divergence signal.
   */
  persistAssistantMessage: {
    audience: 'internal',
    method: 'post',
    path: '/conversation/assistant-message',
    id: 'persistAssistantMessage',
    input: PersistAssistantMessageRequestSchema,
    output: PersistAssistantMessageResponseSchema,
    serviceOnly: true,
  },

  /**
   * POST /api/internal/conversation/user-message
   * Bot-client persists the trigger user message synchronously BEFORE job
   * submission (a user message is a Discord event — the gateway is the
   * Discord-event data authority; pre-submission ordering means the next
   * message's history query always sees this row). Idempotent
   * upsert-with-compare, mirroring the assistant-message endpoint.
   */
  persistUserMessage: {
    audience: 'internal',
    method: 'post',
    path: '/conversation/user-message',
    id: 'persistUserMessage',
    input: PersistUserMessageRequestSchema,
    output: PersistUserMessageResponseSchema,
    serviceOnly: true,
  },

  /**
   * POST /api/internal/conversation/sync
   * Opportunistic edit/delete sync: bot-client ships its fetched Discord
   * snapshot; the gateway diffs against DB state and applies content updates
   * + soft-deletes with tombstones. Idempotent — an already-applied snapshot
   * yields { updated: 0, deleted: 0 }.
   */
  syncConversation: {
    audience: 'internal',
    method: 'post',
    path: '/conversation/sync',
    id: 'syncConversation',
    input: ConversationSyncRequestSchema,
    output: ConversationSyncResponseSchema,
    serviceOnly: true,
  },

  /**
   * GET /api/internal/personality/load
   * Routing read: resolves a personality by name/slug/alias/UUID with
   * loadPersonality's access-control semantics. Pre-job routing paths
   * (mention parsing, reply resolution, activation) consume this once
   * bot-client stops reading the DB directly; misses return
   * { personality: null } with 200 because mention candidates routinely miss.
   */
  loadPersonalityInternal: {
    audience: 'internal',
    method: 'get',
    path: '/personality/load',
    id: 'loadPersonalityInternal',
    // Caps mirror the handler's enforced schema (varchar(255) name columns,
    // 32-char snowflake headroom) so the manifest documents the real contract.
    query: { nameOrId: z.string().min(1).max(255), userId: z.string().max(32).optional() },
    output: LoadPersonalityInternalResponseSchema,
    serviceOnly: true,
    meta: { safeRead: true },
    timeoutMs: TIMEOUTS.GATEWAY_RPC,
  },

  /**
   * POST /api/internal/v1/routing-context
   * Hot-path routing read: resolves the per-(user, personality) routing facts a
   * message needs before job dispatch — internal user UUID, active persona
   * (override → default cascade), persona display name, timezone, STM
   * context-epoch — and provisions the user + default persona on first contact
   * (idempotent upsert keyed on discordId, hence POST not GET). Consolidated
   * because the reads are sequentially dependent; one round-trip replaces the
   * ~4 serialized hops per-read routes would cost on the hottest path.
   */
  routingContextCreate: {
    audience: 'internal',
    method: 'post',
    path: '/v1/routing-context',
    id: 'routingContextCreate',
    input: RoutingContextRequestSchema,
    output: RoutingContextResponseSchema,
    serviceOnly: true,
  },

  /**
   * GET /api/internal/users/recent
   * Bot-client startup hydration: Discord IDs of users active in the last N days.
   * Used to pre-populate the Discord.js DM channel cache (Layer 1 of the
   * post-deploy DM-silence fix).
   */
  recentUsers: {
    audience: 'internal',
    method: 'get',
    path: '/users/recent',
    id: 'recentUsers',
    query: { sinceDays: z.coerce.number().int().positive().optional() },
    output: RecentUsersResponseSchema,
    serviceOnly: true,
    meta: { safeRead: true },
  },

  /**
   * GET /api/internal/models
   * The OpenRouter model catalog (cached in OpenRouterModelCache), powering the
   * bot-client `/models` command. Public re: user auth, but service-auth only
   * like every bot-client → gateway call. The single inputModality/outputModality
   * query pair covers the former /models/{text,vision,image-generation} sub-paths.
   */
  getModels: {
    audience: 'internal',
    method: 'get',
    path: '/models',
    id: 'getModels',
    query: {
      inputModality: z.string().optional(),
      outputModality: z.string().optional(),
      search: z.string().optional(),
      limit: z.coerce.number().int().positive().optional(),
    },
    output: ModelsListResponseSchema,
    serviceOnly: true,
    meta: { safeRead: true },
    // Bulk (~340 models) + a cold cache can trigger an external OpenRouter
    // fetch — larger budget than a single-row RPC, same as getDenylistCache.
    timeoutMs: TIMEOUTS.GATEWAY_BULK_FETCH,
  },

  /**
   * GET /api/internal/denylist/cache
   * Bot-client startup hydration: full denylist for the in-memory cache.
   *
   * Currently mounted at /admin/denylist/cache but is a pure service-to-service
   * bulk-fetch with no human-actor semantics; the manifest reclassifies it
   * under /api/internal/.
   */
  getDenylistCache: {
    audience: 'internal',
    method: 'get',
    path: '/denylist/cache',
    id: 'getDenylistCache',
    output: DenylistCacheResponseSchema,
    serviceOnly: true,
    meta: { safeRead: true },
    // Startup bulk hydration of the full denylist — larger budget than a
    // single-row RPC.
    timeoutMs: TIMEOUTS.GATEWAY_BULK_FETCH,
  },

  /**
   * PATCH /api/internal/diagnostic/:requestId/response-ids
   * Bot-client records the Discord message IDs of an AI response after
   * delivery, so future /inspect lookups by response-message-ID resolve.
   *
   * Currently mounted at /admin/diagnostic/:requestId/response-ids — the
   * route already uses requireServiceAuth (bot-client posts this internally
   * after AI response delivery, no human user is involved). The manifest
   * reclassifies it under /api/internal/* to make the audience contract
   * explicit at the URL level instead of implicit per-route middleware.
   */
  updateDiagnosticResponseIds: {
    audience: 'internal',
    method: 'patch',
    path: '/diagnostic/:requestId/response-ids',
    id: 'updateDiagnosticResponseIds',
    params: { requestId: z.string() },
    input: DiagnosticUpdateSchema,
    output: DiagnosticUpdateResponseSchema,
    serviceOnly: true,
  },

  /**
   * GET /api/internal/channel/:channelId
   * Bot-client looks up channel activation + override state. Called as a
   * service-to-service request without a human actor (no userId header sent
   * today, no user context needed) — the manifest moves it under internal/.
   */
  getChannelSettings: {
    audience: 'internal',
    method: 'get',
    path: '/channel/:channelId',
    id: 'getChannelSettings',
    params: { channelId: z.string() },
    output: GetChannelSettingsResponseSchema,
    serviceOnly: true,
    meta: { safeRead: true },
    timeoutMs: TIMEOUTS.GATEWAY_RPC,
  },

  /**
   * GET /api/internal/admin-settings
   * Service-to-service read of the AdminSettings singleton (e.g. bot-client
   * checking whether auto-transcription is enabled at runtime). The owner-
   * facing read/write of the same data lives at /api/admin/settings
   * (audience 'admin', owner-guarded). This internal alias exists because the
   * owner route's requireUserAuth mount hard-rejects service calls (no
   * X-User-Id) before the handler's service-or-owner check can run, so a
   * service caller has no way to read it via the admin route. Reuses the same
   * handleGetAdminSettings handler (service-safe via its isAuthorizedForRead
   * check) — wired through EXPORT_NAME_OVERRIDES in handler-paths.ts.
   */
  getAdminSettingsInternal: {
    audience: 'internal',
    method: 'get',
    path: '/admin-settings',
    id: 'getAdminSettingsInternal',
    output: AdminSettingsSchema,
    serviceOnly: true,
    meta: { safeRead: true },
    timeoutMs: TIMEOUTS.GATEWAY_RPC,
  },
} as const satisfies Record<string, RouteDef>;
