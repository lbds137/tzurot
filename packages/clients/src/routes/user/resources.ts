/**
 * User-audience resource routes.
 *
 * Covers channel activation, wallet (BYOK), voice resolution, voices CRUD,
 * usage stats, NSFW verification, and conversation history. Ownership CRUD
 * (personality/persona) and diagnostic GETs live in sibling sub-files.
 *
 * Every entry here requires provisioning — these routes always operate on
 * the caller's own row.
 */

import { z } from 'zod';
import { GATEWAY_TIMEOUTS } from '@tzurot/common-types/constants/discord';
import { VALIDATION_TIMEOUTS } from '@tzurot/common-types/constants/timing';
import {
  ActivateChannelRequestSchema,
  ActivateChannelResponseSchema,
  DeactivateChannelRequestSchema,
  DeactivateChannelResponseSchema,
  GetChannelSettingsResponseSchema,
  ListChannelSettingsResponseSchema,
  UpdateChannelGuildRequestSchema,
  UpdateChannelGuildResponseSchema,
} from '@tzurot/common-types/schemas/api/channel';
import {
  ClearChannelConfigOverridesResponseSchema,
  GetChannelConfigOverridesResponseSchema,
  UpdateChannelConfigOverridesRequestSchema,
  UpdateChannelConfigOverridesResponseSchema,
} from '@tzurot/common-types/schemas/api/configOverrides';
import {
  ClearHistoryResponseSchema,
  ClearHistorySchema,
  HardDeleteHistoryResponseSchema,
  HardDeleteHistorySchema,
  HistoryStatsQuerySchema,
  HistoryStatsResponseSchema,
  UndoHistoryResponseSchema,
  UndoHistorySchema,
} from '@tzurot/common-types/schemas/api/history';
import {
  GetNsfwStatusResponseSchema,
  VerifyNsfwResponseSchema,
} from '@tzurot/common-types/schemas/api/nsfw';
import { UsageStatsSchema } from '@tzurot/common-types/schemas/api/usage';
import { GetVoiceResolutionResponseSchema } from '@tzurot/common-types/schemas/api/voice-resolution';
import {
  ClearVoicesResponseSchema,
  DeleteVoiceResponseSchema,
  ListVoiceModelsResponseSchema,
  ListVoicesResponseSchema,
} from '@tzurot/common-types/schemas/api/voices';
import {
  ListWalletKeysResponseSchema,
  RemoveWalletKeyResponseSchema,
  SetWalletKeyResponseSchema,
  SetWalletKeySchema,
  TestWalletKeyResponseSchema,
  TestWalletKeySchema,
} from '@tzurot/common-types/schemas/api/wallet';
import type { RouteDef } from '../types.js';

const CHANNEL_CONFIG_OVERRIDES_PATH = '/channel/:channelId/config-overrides';

export const userResourceRoutes = {
  // ============================================================================
  // Channel activation
  // ============================================================================

  activateChannel: {
    audience: 'user',
    method: 'post',
    path: '/channel/activate',
    id: 'activateChannel',
    input: ActivateChannelRequestSchema,
    output: ActivateChannelResponseSchema,
    requiresProvisionedUser: true,
  },

  deactivateChannel: {
    audience: 'user',
    method: 'delete',
    path: '/channel/deactivate',
    id: 'deactivateChannel',
    input: DeactivateChannelRequestSchema,
    output: DeactivateChannelResponseSchema,
    requiresProvisionedUser: true,
  },

  listUserChannels: {
    audience: 'user',
    method: 'get',
    path: '/channel/list',
    id: 'listUserChannels',
    query: { guildId: z.string().optional() },
    output: ListChannelSettingsResponseSchema,
    requiresProvisionedUser: true,
    meta: { safeRead: true },
  },

  getUserChannel: {
    audience: 'user',
    method: 'get',
    path: '/channel/:channelId',
    id: 'getUserChannel',
    params: { channelId: z.string() },
    // Shares handleGetUserChannel with the internal getChannelSettings route —
    // both emit the { hasSettings, settings } envelope, so both declare the
    // same schema. (The deprecated { isActivated, activation } shape this
    // entry used to declare was never what the handler emitted.)
    output: GetChannelSettingsResponseSchema,
    requiresProvisionedUser: true,
    meta: { safeRead: true },
  },

  updateChannelGuild: {
    audience: 'user',
    method: 'patch',
    path: '/channel/update-guild',
    id: 'updateChannelGuild',
    input: UpdateChannelGuildRequestSchema,
    output: UpdateChannelGuildResponseSchema,
    requiresProvisionedUser: true,
  },

  getChannelConfigOverrides: {
    audience: 'user',
    method: 'get',
    path: CHANNEL_CONFIG_OVERRIDES_PATH,
    id: 'getChannelConfigOverrides',
    params: { channelId: z.string() },
    output: GetChannelConfigOverridesResponseSchema,
    requiresProvisionedUser: true,
    meta: { safeRead: true },
  },

  updateChannelConfigOverrides: {
    audience: 'user',
    method: 'patch',
    path: CHANNEL_CONFIG_OVERRIDES_PATH,
    id: 'updateChannelConfigOverrides',
    params: { channelId: z.string() },
    input: UpdateChannelConfigOverridesRequestSchema,
    output: UpdateChannelConfigOverridesResponseSchema,
    requiresProvisionedUser: true,
    meta: { idempotent: true },
  },

  clearChannelConfigOverrides: {
    audience: 'user',
    method: 'delete',
    path: CHANNEL_CONFIG_OVERRIDES_PATH,
    id: 'clearChannelConfigOverrides',
    params: { channelId: z.string() },
    output: ClearChannelConfigOverridesResponseSchema,
    requiresProvisionedUser: true,
    meta: { idempotent: true },
  },

  // ============================================================================
  // Usage stats (per-user token usage)
  // ============================================================================

  getUserUsage: {
    audience: 'user',
    method: 'get',
    path: '/usage',
    id: 'getUserUsage',
    output: UsageStatsSchema,
    requiresProvisionedUser: true,
    meta: { safeRead: true },
  },

  // ============================================================================
  // Conversation history (per-personality / per-channel)
  // ============================================================================

  clearHistory: {
    audience: 'user',
    method: 'post',
    path: '/history/clear',
    id: 'clearHistory',
    input: ClearHistorySchema,
    output: ClearHistoryResponseSchema,
    requiresProvisionedUser: true,
  },

  undoHistory: {
    audience: 'user',
    method: 'post',
    path: '/history/undo',
    id: 'undoHistory',
    input: UndoHistorySchema,
    output: UndoHistoryResponseSchema,
    requiresProvisionedUser: true,
  },

  getHistoryStats: {
    audience: 'user',
    method: 'get',
    path: '/history/stats',
    id: 'getHistoryStats',
    // Reuse the server-side schema's shape directly so manifest and handler
    // can't drift on validation constraints. `.shape` exposes the per-field
    // Zod schemas in the `Record<string, ZodTypeAny>` shape the codegen needs.
    query: HistoryStatsQuerySchema.shape,
    output: HistoryStatsResponseSchema,
    requiresProvisionedUser: true,
    meta: { safeRead: true },
  },

  // DELETE with a request body is RFC 7231 §4.3.5 valid, but some reverse
  // proxies, CDNs, and older HTTP clients strip DELETE bodies — meaning the
  // `{ personalitySlug, channelId, personaId? }` payload may not reach the
  // server in deployments behind such middleboxes. The current bot-client
  // calls this via the in-process transport so this isn't a problem today,
  // but a future SDK or CLI caller may need POST /history/hard-delete (with
  // body) as an alternative shape.
  hardDeleteHistory: {
    audience: 'user',
    method: 'delete',
    path: '/history/hard-delete',
    id: 'hardDeleteHistory',
    input: HardDeleteHistorySchema,
    output: HardDeleteHistoryResponseSchema,
    requiresProvisionedUser: true,
  },

  // ============================================================================
  // NSFW verification
  // ============================================================================

  getNsfwStatus: {
    audience: 'user',
    method: 'get',
    path: '/nsfw',
    id: 'getNsfwStatus',
    output: GetNsfwStatusResponseSchema,
    requiresProvisionedUser: true,
    meta: { safeRead: true },
  },

  verifyNsfw: {
    audience: 'user',
    method: 'post',
    path: '/nsfw/verify',
    id: 'verifyNsfw',
    output: VerifyNsfwResponseSchema,
    requiresProvisionedUser: true,
  },

  // ============================================================================
  // Wallet (BYOK key management)
  // ============================================================================

  listWalletKeys: {
    audience: 'user',
    method: 'get',
    path: '/wallet/list',
    id: 'listWalletKeys',
    output: ListWalletKeysResponseSchema,
    requiresProvisionedUser: true,
    meta: { safeRead: true },
    timeoutMs: GATEWAY_TIMEOUTS.DEFERRED,
  },

  setWalletKey: {
    audience: 'user',
    method: 'post',
    path: '/wallet/set',
    id: 'setWalletKey',
    input: SetWalletKeySchema,
    output: SetWalletKeyResponseSchema,
    requiresProvisionedUser: true,
    externalCallBudgetMs: VALIDATION_TIMEOUTS.API_KEY_VALIDATION,
    timeoutMs: GATEWAY_TIMEOUTS.EXTERNAL_PROVIDER,
  },

  removeWalletKey: {
    audience: 'user',
    method: 'delete',
    path: '/wallet/:provider',
    id: 'removeWalletKey',
    params: { provider: z.string() },
    output: RemoveWalletKeyResponseSchema,
    requiresProvisionedUser: true,
  },

  testWalletKey: {
    audience: 'user',
    method: 'post',
    path: '/wallet/test',
    id: 'testWalletKey',
    input: TestWalletKeySchema,
    output: TestWalletKeyResponseSchema,
    requiresProvisionedUser: true,
    externalCallBudgetMs: VALIDATION_TIMEOUTS.API_KEY_VALIDATION,
    // The gateway handler synchronously probes the provider's auth/credits
    // endpoint (up to API_KEY_VALIDATION = 30s) before responding, so the
    // bot→gateway hop must outwait that probe. DEFERRED (10s) aborted mid-probe
    // while the gateway was still succeeding; EXTERNAL_PROVIDER gives the headroom.
    timeoutMs: GATEWAY_TIMEOUTS.EXTERNAL_PROVIDER,
  },

  // ============================================================================
  // Voice resolution (aggregate read backing /voice view)
  // ============================================================================

  getVoiceResolution: {
    audience: 'user',
    method: 'get',
    path: '/voice-resolution',
    id: 'getVoiceResolution',
    // `.uuid()` mirrors the server-side `GetVoiceResolutionQuerySchema` in
    // schemas/api/voice-resolution.ts — server rejects non-UUID with 400.
    query: { personalityId: z.string().uuid() },
    output: GetVoiceResolutionResponseSchema,
    requiresProvisionedUser: true,
    meta: { safeRead: true },
    // Cascade resolution can chain multiple Prisma reads — the autocomplete
    // default isn't enough headroom for the slowest legs.
    timeoutMs: GATEWAY_TIMEOUTS.DEFERRED,
  },

  // ============================================================================
  // Voices (BYOK cloned voice management — ElevenLabs / Mistral)
  // ============================================================================

  listVoices: {
    audience: 'user',
    method: 'get',
    path: '/voices',
    id: 'listVoices',
    output: ListVoicesResponseSchema,
    requiresProvisionedUser: true,
    meta: { safeRead: true },
    externalCallBudgetMs: VALIDATION_TIMEOUTS.EXTERNAL_AUDIO_API_CALL,
    // The handler fans out to the ElevenLabs/Mistral voices endpoints (parallel,
    // up to EXTERNAL_AUDIO_API_CALL = 30s worst case), so the client must outwait
    // it. Autocomplete callers are bounded by Discord's own 3s deadline
    // regardless; this budget serves the deferred-handler path.
    timeoutMs: GATEWAY_TIMEOUTS.EXTERNAL_PROVIDER,
  },

  listVoiceModels: {
    audience: 'user',
    method: 'get',
    path: '/voices/models',
    id: 'listVoiceModels',
    output: ListVoiceModelsResponseSchema,
    requiresProvisionedUser: true,
    meta: { safeRead: true },
    externalCallBudgetMs: VALIDATION_TIMEOUTS.EXTERNAL_AUDIO_API_CALL,
    // Fetches the provider's available-models catalog (third-party round-trip,
    // up to EXTERNAL_AUDIO_API_CALL = 30s). Cached (5-min TTL) so hits are cheap,
    // but a cache miss runs the full call — the client must outwait it, not abort
    // at the 10s DEFERRED budget.
    timeoutMs: GATEWAY_TIMEOUTS.EXTERNAL_PROVIDER,
  },

  clearVoices: {
    audience: 'user',
    method: 'post',
    path: '/voices/clear',
    id: 'clearVoices',
    output: ClearVoicesResponseSchema,
    requiresProvisionedUser: true,
    // Iterates per-voice DELETEs against the third-party audio provider;
    // a user with many cloned voices can exceed the DEFERRED budget.
    timeoutMs: GATEWAY_TIMEOUTS.BULK_OPERATION,
  },

  deleteVoice: {
    audience: 'user',
    method: 'delete',
    path: '/voices/:provider/:voiceId',
    id: 'deleteVoice',
    params: { provider: z.string(), voiceId: z.string() },
    output: DeleteVoiceResponseSchema,
    requiresProvisionedUser: true,
  },
} as const satisfies Record<string, RouteDef>;
