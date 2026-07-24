/**
 * Conformance fixtures: admin-audience routes (bot-owner only).
 *
 * The harness actor IS the bot owner (BOT_OWNER_ID is set to it), so the
 * real requireOwnerAuth chain authenticates these. Global config CRUD
 * mirrors the user families; operational routes that shell out to the
 * migration engine are skipped.
 */

import type { ConformanceEntry, SeedContext } from './types.js';
import { createPersonality } from './seedHelpers.js';

/** Create a GLOBAL LLM config via the admin API; returns its UUID. */
async function createGlobalLlmConfig(ctx: SeedContext, name: string): Promise<{ id: string }> {
  const res = (await ctx.call('post', '/api/admin/llm-config', {
    name,
    model: 'anthropic/claude-sonnet-4',
  })) as { config: { id: string } };
  return { id: res.config.id };
}

/** Create a GLOBAL TTS config via the admin API; returns its UUID. */
async function createGlobalTtsConfig(ctx: SeedContext, name: string): Promise<{ id: string }> {
  const res = (await ctx.call('post', '/api/admin/tts-config', {
    name,
    provider: 'self-hosted',
  })) as { config: { id: string } };
  return { id: res.config.id };
}

export const adminFixtures: Record<string, ConformanceEntry> = {
  // ---- Operational maintenance ----------------------------------------------

  dbSync: {
    skip: 'Runs prisma migrate deploy against the real migration engine — not exercisable over PGLite.',
  },

  broadcast: {
    // Real run: the provisioned actor is opted-in by default, so the blast
    // creates the announcement + a delivery row and enqueues one batch
    // against the harness's fake queue.
    body: { message: 'conformance broadcast', label: 'conf-broadcast-1', confirm: true },
  },

  cleanup: {
    body: {},
  },

  invalidateCache: {
    seed: async ctx => {
      const personality = await createPersonality(ctx, 'conf-admin-invalidate');
      return { body: { personalityId: personality.id } };
    },
  },

  // ---- Personality management -------------------------------------------------

  createGlobalPersonality: {
    body: {
      name: 'Conformance Global Personality',
      slug: 'conf-admin-personality-create',
      characterInfo: 'Character info seeded by the conformance harness.',
      personalityTraits: 'Global, methodical.',
    },
  },

  updateGlobalPersonality: {
    seed: async ctx => {
      await createPersonality(ctx, 'conf-admin-personality-update');
    },
    params: { slug: 'conf-admin-personality-update' },
    body: { characterInfo: 'Updated by the conformance harness (admin path).' },
  },

  // ---- Denylist ------------------------------------------------------------------

  addDenylistEntry: {
    body: { type: 'USER', discordId: '820000000000000001', reason: 'Conformance harness.' },
  },

  listDenylistEntries: {
    seed: async ctx => {
      await ctx.call('post', '/api/admin/denylist', {
        type: 'USER',
        discordId: '820000000000000002',
        reason: 'Conformance harness (list).',
      });
    },
  },

  removeDenylistEntry: {
    seed: async ctx => {
      await ctx.call('post', '/api/admin/denylist', {
        type: 'USER',
        discordId: '820000000000000003',
        reason: 'Conformance harness (remove).',
      });
    },
    params: { type: 'USER', discordId: '820000000000000003', scope: 'BOT', scopeId: '*' },
  },

  // ---- Global LLM config CRUD -------------------------------------------------------

  listGlobalLlmConfigs: {
    seed: async ctx => {
      await createGlobalLlmConfig(ctx, 'Conf Global LLM List');
    },
  },

  getGlobalLlmConfig: {
    seed: async ctx => {
      const config = await createGlobalLlmConfig(ctx, 'Conf Global LLM Get');
      return { params: { id: config.id } };
    },
  },

  createGlobalLlmConfig: {
    body: { name: 'Conf Global LLM Create', model: 'anthropic/claude-sonnet-4' },
  },

  updateGlobalLlmConfig: {
    seed: async ctx => {
      const config = await createGlobalLlmConfig(ctx, 'Conf Global LLM Update');
      return { params: { id: config.id } };
    },
    body: { description: 'Updated by the conformance harness.' },
  },

  setGlobalLlmConfigDefault: {
    seed: async ctx => {
      const config = await createGlobalLlmConfig(ctx, 'Conf Global LLM Default');
      return { params: { id: config.id } };
    },
  },

  setGlobalLlmConfigFreeDefault: {
    seed: async ctx => {
      // Free-tier defaults are restricted to :free models — the handler 400s
      // on anything else.
      const res = (await ctx.call('post', '/api/admin/llm-config', {
        name: 'Conf Global LLM Free Default',
        model: 'meta-llama/llama-3.3-70b-instruct:free',
      })) as { config: { id: string } };
      return { params: { id: res.config.id } };
    },
  },

  deleteGlobalLlmConfig: {
    seed: async ctx => {
      const config = await createGlobalLlmConfig(ctx, 'Conf Global LLM Delete');
      return { params: { id: config.id } };
    },
  },

  // ---- Global TTS config CRUD --------------------------------------------------------

  listGlobalTtsConfigs: {
    seed: async ctx => {
      await createGlobalTtsConfig(ctx, 'Conf Global TTS List');
    },
  },

  getGlobalTtsConfig: {
    seed: async ctx => {
      const config = await createGlobalTtsConfig(ctx, 'Conf Global TTS Get');
      return { params: { id: config.id } };
    },
  },

  createGlobalTtsConfig: {
    body: { name: 'Conf Global TTS Create', provider: 'self-hosted' },
  },

  updateGlobalTtsConfig: {
    seed: async ctx => {
      const config = await createGlobalTtsConfig(ctx, 'Conf Global TTS Update');
      return { params: { id: config.id } };
    },
    body: { description: 'Updated by the conformance harness.' },
  },

  setGlobalTtsConfigDefault: {
    seed: async ctx => {
      const config = await createGlobalTtsConfig(ctx, 'Conf Global TTS Default');
      return { params: { id: config.id } };
    },
  },

  setGlobalTtsConfigFreeDefault: {
    seed: async ctx => {
      const config = await createGlobalTtsConfig(ctx, 'Conf Global TTS Free Default');
      return { params: { id: config.id } };
    },
  },

  deleteGlobalTtsConfig: {
    seed: async ctx => {
      const config = await createGlobalTtsConfig(ctx, 'Conf Global TTS Delete');
      return { params: { id: config.id } };
    },
  },

  // ---- Admin singletons + observability -------------------------------------------------

  getAdminSettings: {},

  updateAdminSettings: {
    body: { maxMessages: 30 },
  },

  clearAdminSettings: {
    seed: async ctx => {
      await ctx.call('patch', '/api/admin/settings/config-defaults', { maxMessages: 25 });
    },
  },

  getAdminUsageStats: {
    query: { timeframe: '7d' },
  },

  // ---- Admin system settings (non-cascading operational bag) ----------------------------

  getSystemSettings: {},

  updateSystemSettings: {
    // The write carries an optimistic-concurrency token, so the fixture reads
    // the live row first. An integer setting avoids the model-catalog
    // validators (no OpenRouter cache in the harness).
    seed: async ctx => {
      const current = (await ctx.call('get', '/api/admin/settings/system')) as {
        updatedAt: string;
      };
      return {
        body: {
          expectedUpdatedAt: current.updatedAt,
          patch: { zaiHeadroomPercent: 60 },
        },
      };
    },
  },
};
