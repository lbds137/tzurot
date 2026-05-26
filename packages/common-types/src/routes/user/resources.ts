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
  ListChannelActivationsResponseSchema,
  GetChannelActivationResponseSchema,
  UpdateChannelGuildResponseSchema,
  ChannelSettingsSchema,
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
import type { RouteDef } from '../types.js';

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
    output: ListChannelActivationsResponseSchema,
    requiresProvisionedUser: true,
  },

  getUserChannel: {
    audience: 'user',
    method: 'get',
    path: '/channel/:channelId',
    id: 'getUserChannel',
    params: { channelId: z.string() },
    output: GetChannelActivationResponseSchema,
    requiresProvisionedUser: true,
  },

  updateChannelGuild: {
    audience: 'user',
    method: 'patch',
    path: '/channel/update-guild',
    id: 'updateChannelGuild',
    output: UpdateChannelGuildResponseSchema,
    requiresProvisionedUser: true,
  },

  getChannelConfigOverrides: {
    audience: 'user',
    method: 'get',
    path: '/channel/:channelId/config-overrides',
    id: 'getChannelConfigOverrides',
    params: { channelId: z.string() },
    output: ChannelSettingsSchema,
    requiresProvisionedUser: true,
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
    // `.min(1)` mirrors the server-side `HistoryStatsQuerySchema` in
    // schemas/api/history.ts — the handler returns 400 on empty values
    // and the generated client should refuse to send them.
    query: {
      personalitySlug: z.string().min(1),
      channelId: z.string().min(1),
      personaId: z.string().optional(),
    },
    output: HistoryStatsResponseSchema,
    requiresProvisionedUser: true,
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
  },

  setWalletKey: {
    audience: 'user',
    method: 'post',
    path: '/wallet/set',
    id: 'setWalletKey',
    input: SetWalletKeySchema,
    output: SetWalletKeyResponseSchema,
    requiresProvisionedUser: true,
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
  },

  // ============================================================================
  // Voice resolution (aggregate read backing /voice view)
  // ============================================================================

  getVoiceResolution: {
    audience: 'user',
    method: 'get',
    path: '/voice-resolution',
    id: 'getVoiceResolution',
    query: { personalityId: z.string() },
    output: GetVoiceResolutionResponseSchema,
    requiresProvisionedUser: true,
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
  },

  listVoiceModels: {
    audience: 'user',
    method: 'get',
    path: '/voices/models',
    id: 'listVoiceModels',
    output: ListVoiceModelsResponseSchema,
    requiresProvisionedUser: true,
  },

  clearVoices: {
    audience: 'user',
    method: 'post',
    path: '/voices/clear',
    id: 'clearVoices',
    output: ClearVoicesResponseSchema,
    requiresProvisionedUser: true,
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
