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
import {
  AiGenerateResponseSchema,
  AiTranscribeResponseSchema,
  AiJobStatusResponseSchema,
  AiConfirmDeliveryResponseSchema,
  DmSessionSetRequestSchema,
  DmSessionSetResponseSchema,
  MessagePersonalityResponseSchema,
  RecentUsersResponseSchema,
  DenylistCacheResponseSchema,
  DiagnosticUpdateSchema,
  DiagnosticUpdateResponseSchema,
  GetChannelSettingsResponseSchema,
  TranscribeRequestSchema,
} from '../schemas/api/index.js';
// generateRequestSchema lives under the `types/schemas/` module rather than
// the `schemas/api/` barrel (it predates the API-schema reorganization). The
// route-manifest treats them uniformly via the import below.
import { generateRequestSchema } from '../types/schemas/generation.js';
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
  },
} as const satisfies Record<string, RouteDef>;

/** Internal-route ID union — used as a manifest key by generated clients. */
export type InternalRouteId = keyof typeof internalRoutes;
