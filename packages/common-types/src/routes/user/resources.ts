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
import {
  // Channel activation
  ActivateChannelRequestSchema,
  DeactivateChannelRequestSchema,
  ActivateChannelResponseSchema,
  DeactivateChannelResponseSchema,
  ListChannelSettingsResponseSchema,
  GetChannelActivationResponseSchema,
  UpdateChannelGuildRequestSchema,
  UpdateChannelGuildResponseSchema,
  // Channel config-overrides (PATCH/DELETE wire the dashboard)
  GetChannelConfigOverridesResponseSchema,
  UpdateChannelConfigOverridesRequestSchema,
  UpdateChannelConfigOverridesResponseSchema,
  ClearChannelConfigOverridesResponseSchema,
  // Wallet
  ListWalletKeysResponseSchema,
  RemoveWalletKeyResponseSchema,
  SetWalletKeySchema,
  SetWalletKeyResponseSchema,
  TestWalletKeySchema,
  TestWalletKeyResponseSchema,
  // Voice resolution
  GetVoiceResolutionResponseSchema,
  // Usage
  UsageStatsSchema,
  // NSFW verification
  GetNsfwStatusResponseSchema,
  VerifyNsfwResponseSchema,
  // History
  ClearHistorySchema,
  UndoHistorySchema,
  HardDeleteHistorySchema,
  HistoryStatsQuerySchema,
  ClearHistoryResponseSchema,
  UndoHistoryResponseSchema,
  HistoryStatsResponseSchema,
  HardDeleteHistoryResponseSchema,
  // Voices (cloned voice management)
  ListVoicesResponseSchema,
  ListVoiceModelsResponseSchema,
  ClearVoicesResponseSchema,
  DeleteVoiceResponseSchema,
} from '../../schemas/api/index.js';
import { GATEWAY_TIMEOUTS } from '../../constants/discord.js';
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
    output: GetChannelActivationResponseSchema,
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
    timeoutMs: GATEWAY_TIMEOUTS.DEFERRED,
  },

  removeWalletKey: {
    audience: 'user',
    method: 'delete',
    path: '/wallet/:provider',
    id: 'removeWalletKey',
    params: { provider: z.string() },
    output: RemoveWalletKeyResponseSchema,
    requiresProvisionedUser: true,
    timeoutMs: GATEWAY_TIMEOUTS.DEFERRED,
  },

  testWalletKey: {
    audience: 'user',
    method: 'post',
    path: '/wallet/test',
    id: 'testWalletKey',
    input: TestWalletKeySchema,
    output: TestWalletKeyResponseSchema,
    requiresProvisionedUser: true,
    // Post-defer dashboard action (not a slash-command hot path), and the
    // gateway handler synchronously probes the provider's auth/credits
    // endpoint before responding — so the gateway's own response is slow.
    // DEFERRED gives the bot→gateway hop enough headroom for that probe.
    timeoutMs: GATEWAY_TIMEOUTS.DEFERRED,
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
    // Dual-context route: autocomplete callers are bounded by Discord's
    // own 3s deadline, so the longer budget exists for the deferred-handler
    // paths where a list fetch may run alongside other Prisma work.
    timeoutMs: GATEWAY_TIMEOUTS.DEFERRED,
  },

  listVoiceModels: {
    audience: 'user',
    method: 'get',
    path: '/voices/models',
    id: 'listVoiceModels',
    output: ListVoiceModelsResponseSchema,
    requiresProvisionedUser: true,
    meta: { safeRead: true },
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
    timeoutMs: GATEWAY_TIMEOUTS.DEFERRED,
  },
} as const satisfies Record<string, RouteDef>;
