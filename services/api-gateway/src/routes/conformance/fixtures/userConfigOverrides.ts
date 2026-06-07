/**
 * Conformance fixtures: user-audience config-overrides routes
 * (user-default tier, user-personality tier, personality tier, cascade
 * resolution).
 */

import type { ConformanceEntry } from './types.js';
import { createPersonality } from './seedHelpers.js';

const USER_DEFAULTS_URL = '/api/user/config-overrides/defaults';

export const userConfigOverrideFixtures: Record<string, ConformanceEntry> = {
  // ---- User cascade-tier --------------------------------------------------

  resolveUserDefaults: {
    seed: async ctx => {
      await ctx.call('patch', USER_DEFAULTS_URL, { maxMessages: 25 });
    },
  },

  getUserDefaults: {
    seed: async ctx => {
      await ctx.call('patch', USER_DEFAULTS_URL, { maxMessages: 25 });
    },
  },

  updateUserDefaults: {
    body: { maxMessages: 30 },
  },

  clearUserDefaults: {
    seed: async ctx => {
      await ctx.call('patch', USER_DEFAULTS_URL, { maxMessages: 25 });
    },
  },

  resolveCascade: {
    seed: async ctx => {
      const personality = await createPersonality(ctx, 'conf-cascade-resolve');
      await ctx.call('patch', `/api/user/config-overrides/${personality.id}`, {
        maxMessages: 25,
      });
      return { params: { personalityId: personality.id } };
    },
  },

  updatePersonalityOverrides: {
    seed: async ctx => {
      const personality = await createPersonality(ctx, 'conf-cascade-update');
      return { params: { personalityId: personality.id } };
    },
    body: { maxMessages: 30 },
  },

  clearPersonalityOverrides: {
    seed: async ctx => {
      const personality = await createPersonality(ctx, 'conf-cascade-clear');
      await ctx.call('patch', `/api/user/config-overrides/${personality.id}`, {
        maxMessages: 25,
      });
      return { params: { personalityId: personality.id } };
    },
  },

  // ---- Personality-tier (creator-only) -------------------------------------

  resolvePersonalityCascade: {
    seed: async ctx => {
      const personality = await createPersonality(ctx, 'conf-ptier-resolve');
      await ctx.call('patch', `/api/user/config-overrides/personality/${personality.id}`, {
        maxMessages: 25,
      });
      return { params: { personalityId: personality.id } };
    },
  },

  updatePersonalityConfigDefaults: {
    seed: async ctx => {
      const personality = await createPersonality(ctx, 'conf-ptier-update');
      return { params: { personalityId: personality.id } };
    },
    body: { maxMessages: 30 },
  },
};
