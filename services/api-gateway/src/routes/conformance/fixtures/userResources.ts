/**
 * Conformance fixtures: user-audience resource routes
 * (channel activation, channel config overrides, usage, history, NSFW,
 * wallet/BYOK, voice resolution, voices).
 *
 * External-provider routes (voice CRUD against ElevenLabs/Mistral, wallet
 * key probing) can't reach their success path without a third-party
 * round-trip; those are skipped with reasons. Empty-state reads still
 * exercise the full schema envelope.
 */

import { encryptApiKey } from '@tzurot/common-types/utils/encryption';

import type { ConformanceEntry, SeedContext } from './types.js';
import { createPersonality } from './seedHelpers.js';

const CHANNEL_SNOWFLAKE = '800000000000000001';
const GUILD_SNOWFLAKE = '800000000000000002';
const HISTORY_UNDO_SLUG = 'conf-history-undo';

/**
 * Insert a BYOK wallet row directly. The set route validates keys against
 * the live provider before storing, so API-level seeding isn't possible —
 * but list/remove only read the stored row, and their handlers are fully
 * exercisable over a directly-inserted one.
 */
async function seedWalletKey(ctx: SeedContext, id: string, provider: string): Promise<void> {
  const encrypted = encryptApiKey(`conf-harness-${provider}-key`);
  await ctx.prisma.userApiKey.create({
    data: {
      id,
      userId: ctx.actorUserId,
      provider,
      iv: encrypted.iv,
      content: encrypted.content,
      tag: encrypted.tag,
    },
  });
}

/** Activate a personality in a channel so channel reads have a row. */
async function activateChannel(ctx: SeedContext, slug: string, channelId: string): Promise<void> {
  await createPersonality(ctx, slug);
  await ctx.call('post', '/api/user/channel/activate', {
    channelId,
    personalitySlug: slug,
    guildId: GUILD_SNOWFLAKE,
  });
}

export const userResourceFixtures: Record<string, ConformanceEntry> = {
  // ---- Channel activation -------------------------------------------------

  activateChannel: {
    seed: async ctx => {
      await createPersonality(ctx, 'conf-channel-activate');
    },
    body: {
      channelId: CHANNEL_SNOWFLAKE,
      personalitySlug: 'conf-channel-activate',
      guildId: GUILD_SNOWFLAKE,
    },
  },

  deactivateChannel: {
    seed: async ctx => {
      await activateChannel(ctx, 'conf-channel-deactivate', '800000000000000011');
    },
    body: { channelId: '800000000000000011' },
  },

  listUserChannels: {
    seed: async ctx => {
      await activateChannel(ctx, 'conf-channel-list', '800000000000000012');
    },
  },

  getUserChannel: {
    seed: async ctx => {
      await activateChannel(ctx, 'conf-channel-get', '800000000000000013');
    },
    params: { channelId: '800000000000000013' },
  },

  updateChannelGuild: {
    seed: async ctx => {
      await activateChannel(ctx, 'conf-channel-guild', '800000000000000014');
    },
    body: { channelId: '800000000000000014', guildId: '800000000000000015' },
  },

  // ---- Channel config overrides -------------------------------------------

  getChannelConfigOverrides: {
    seed: async ctx => {
      await activateChannel(ctx, 'conf-channel-cfg-get', '800000000000000016');
      await ctx.call('patch', '/api/user/channel/800000000000000016/config-overrides', {
        maxMessages: 25,
      });
    },
    params: { channelId: '800000000000000016' },
  },

  updateChannelConfigOverrides: {
    seed: async ctx => {
      await activateChannel(ctx, 'conf-channel-cfg-update', '800000000000000017');
    },
    params: { channelId: '800000000000000017' },
    body: { maxMessages: 30 },
  },

  clearChannelConfigOverrides: {
    seed: async ctx => {
      await activateChannel(ctx, 'conf-channel-cfg-clear', '800000000000000018');
      await ctx.call('patch', '/api/user/channel/800000000000000018/config-overrides', {
        maxMessages: 25,
      });
    },
    params: { channelId: '800000000000000018' },
  },

  // ---- Usage ----------------------------------------------------------------

  getUserUsage: {
    // Zero-state read: no usage rows exist for the actor. The full envelope
    // (totals + empty breakdowns) still parses through UsageStatsSchema.
  },

  // ---- Conversation history -------------------------------------------------

  clearHistory: {
    seed: async ctx => {
      await createPersonality(ctx, 'conf-history-clear');
    },
    body: { personalitySlug: 'conf-history-clear' },
  },

  undoHistory: {
    seed: async ctx => {
      // Undo requires a restorable checkpoint, which only a prior clear
      // operation creates.
      await createPersonality(ctx, HISTORY_UNDO_SLUG);
      await ctx.call('post', '/api/user/history/clear', {
        personalitySlug: HISTORY_UNDO_SLUG,
      });
    },
    body: { personalitySlug: HISTORY_UNDO_SLUG },
  },

  getHistoryStats: {
    seed: async ctx => {
      await createPersonality(ctx, 'conf-history-stats');
    },
    query: { personalitySlug: 'conf-history-stats', channelId: CHANNEL_SNOWFLAKE },
  },

  hardDeleteHistory: {
    seed: async ctx => {
      await createPersonality(ctx, 'conf-history-hard-delete');
    },
    body: { personalitySlug: 'conf-history-hard-delete', channelId: CHANNEL_SNOWFLAKE },
  },

  // ---- NSFW verification ----------------------------------------------------

  getNsfwStatus: {},

  verifyNsfw: {},

  // ---- Wallet (BYOK) ---------------------------------------------------------

  listWalletKeys: {
    seed: async ctx => {
      await seedWalletKey(ctx, '4a110000-0000-4000-8000-000000000001', 'openrouter');
    },
  },

  setWalletKey: {
    skip: 'The set handler validates the key against the live provider before storing — no success path without a third-party API.',
  },

  removeWalletKey: {
    seed: async ctx => {
      await seedWalletKey(ctx, '4a110000-0000-4000-8000-000000000002', 'elevenlabs');
    },
    params: { provider: 'elevenlabs' },
  },

  testWalletKey: {
    skip: 'Probes the provider auth endpoint over the network — no success path without a live third-party API.',
  },

  // ---- Voice resolution -------------------------------------------------------

  getVoiceResolution: {
    seed: async ctx => {
      const personality = await createPersonality(ctx, 'conf-voice-resolution');
      return { query: { personalityId: personality.id } };
    },
  },

  // ---- Voices (BYOK cloned voices) ---------------------------------------------

  listVoices: {
    skip: 'Requires a BYOK audio key and a live provider voices fetch — 404s without a key, network round-trip with one.',
  },

  listVoiceModels: {
    skip: 'Fetches the provider model catalog over the network — no success path without a live third-party API.',
  },

  clearVoices: {
    skip: 'Iterates voice deletions against the live provider — no success path without a third-party API.',
  },

  deleteVoice: {
    skip: 'Deletes a cloned voice on the third-party provider — no success path without a live external API.',
  },
};
