/**
 * Conformance fixtures: user-audience configuration routes
 * (timezone, LLM/TTS config CRUD, TTS/STT/model overrides + defaults).
 *
 * LLM model-field validation skips gracefully when no OpenRouter model
 * cache is wired (deps.modelCache is undefined in the harness), so the
 * create/update paths run fully locally. TTS configs use the self-hosted
 * provider, which has no third-party round-trip.
 */

import type { ConformanceEntry } from './types.js';
import { createLlmConfig, createPersonality, createTtsConfig } from './seedHelpers.js';

export const userConfigFixtures: Record<string, ConformanceEntry> = {
  // ---- Timezone -------------------------------------------------------------

  getTimezone: {},

  setTimezone: {
    body: { timezone: 'America/New_York' },
  },

  // ---- Notification preferences ----------------------------------------------

  getNotificationPrefs: {},

  updateNotificationPrefs: {
    body: { enabled: false, level: 'patch' },
  },

  listReleaseDms: {
    // Real success path over PGLite: a sent-with-messageId ledger row for the
    // actor must come back as a standing release DM.
    seed: async ctx => {
      await ctx.prisma.releaseAnnouncement.create({
        data: {
          id: 'aa3e4567-e89b-42d3-a456-426614174101',
          version: 'conf-release-list',
          level: 'minor',
          githubReleaseId: 'conf-gh-1',
          body: 'conformance notes',
        },
      });
      await ctx.prisma.releaseDeliveryLog.create({
        data: {
          id: 'aa3e4567-e89b-42d3-a456-426614174102',
          releaseId: 'aa3e4567-e89b-42d3-a456-426614174101',
          userId: ctx.actorUserId,
          status: 'sent',
          sentMessageId: '111222333444555666',
          attemptedAt: new Date(),
        },
      });
    },
  },

  markReleaseDmsDeleted: {
    seed: async ctx => {
      await ctx.prisma.releaseAnnouncement.create({
        data: {
          id: 'ab3e4567-e89b-42d3-a456-426614174201',
          version: 'conf-release-mark',
          level: 'minor',
          githubReleaseId: 'conf-gh-2',
          body: 'conformance notes',
        },
      });
      await ctx.prisma.releaseDeliveryLog.create({
        data: {
          id: 'ab3e4567-e89b-42d3-a456-426614174202',
          releaseId: 'ab3e4567-e89b-42d3-a456-426614174201',
          userId: ctx.actorUserId,
          status: 'sent',
          sentMessageId: '222333444555666777',
          attemptedAt: new Date(),
        },
      });
      return { body: { deliveryLogIds: ['ab3e4567-e89b-42d3-a456-426614174202'] } };
    },
  },

  // ---- LLM config CRUD -------------------------------------------------------

  listUserLlmConfigs: {
    seed: async ctx => {
      await createLlmConfig(ctx, 'Conf LLM List');
    },
  },

  getUserLlmConfig: {
    seed: async ctx => {
      const config = await createLlmConfig(ctx, 'Conf LLM Get');
      return { params: { id: config.id } };
    },
  },

  createUserLlmConfig: {
    body: { name: 'Conf LLM Create', model: 'anthropic/claude-sonnet-4' },
  },

  updateUserLlmConfig: {
    seed: async ctx => {
      const config = await createLlmConfig(ctx, 'Conf LLM Update');
      return { params: { id: config.id } };
    },
    body: { description: 'Updated by the conformance harness.' },
  },

  deleteUserLlmConfig: {
    seed: async ctx => {
      const config = await createLlmConfig(ctx, 'Conf LLM Delete');
      return { params: { id: config.id } };
    },
  },

  resolveUserLlmConfig: {
    seed: async ctx => {
      const personality = await createPersonality(ctx, 'conf-llm-resolve');
      return {
        body: {
          personalityId: personality.id,
          personalityConfig: {
            id: personality.id,
            name: 'Conformance conf-llm-resolve',
            model: 'anthropic/claude-sonnet-4',
          },
        },
      };
    },
  },

  // ---- TTS config CRUD --------------------------------------------------------

  listUserTtsConfigs: {
    seed: async ctx => {
      await createTtsConfig(ctx, 'Conf TTS List');
    },
  },

  getUserTtsConfig: {
    seed: async ctx => {
      const config = await createTtsConfig(ctx, 'Conf TTS Get');
      return { params: { id: config.id } };
    },
  },

  createUserTtsConfig: {
    body: { name: 'Conf TTS Create', provider: 'self-hosted' },
  },

  updateUserTtsConfig: {
    seed: async ctx => {
      const config = await createTtsConfig(ctx, 'Conf TTS Update');
      return { params: { id: config.id } };
    },
    body: { description: 'Updated by the conformance harness.' },
  },

  deleteUserTtsConfig: {
    seed: async ctx => {
      const config = await createTtsConfig(ctx, 'Conf TTS Delete');
      return { params: { id: config.id } };
    },
  },

  // ---- TTS override (per-personality + user default) ---------------------------

  listTtsOverrides: {
    seed: async ctx => {
      const personality = await createPersonality(ctx, 'conf-tts-override-list');
      const config = await createTtsConfig(ctx, 'Conf TTS Override List');
      await ctx.call('put', '/api/user/tts-override', {
        personalityId: personality.id,
        configId: config.id,
      });
    },
  },

  setTtsOverride: {
    seed: async ctx => {
      const personality = await createPersonality(ctx, 'conf-tts-override-set');
      const config = await createTtsConfig(ctx, 'Conf TTS Override Set');
      return { body: { personalityId: personality.id, configId: config.id } };
    },
  },

  deleteTtsOverride: {
    seed: async ctx => {
      const personality = await createPersonality(ctx, 'conf-tts-override-del');
      const config = await createTtsConfig(ctx, 'Conf TTS Override Del');
      await ctx.call('put', '/api/user/tts-override', {
        personalityId: personality.id,
        configId: config.id,
      });
      return { params: { personalityId: personality.id } };
    },
  },

  getTtsDefaultConfig: {
    seed: async ctx => {
      const config = await createTtsConfig(ctx, 'Conf TTS Default Get');
      await ctx.call('put', '/api/user/tts-override/default', { configId: config.id });
    },
  },

  setTtsDefaultConfig: {
    seed: async ctx => {
      const config = await createTtsConfig(ctx, 'Conf TTS Default Set');
      return { body: { configId: config.id } };
    },
  },

  clearTtsDefaultConfig: {
    seed: async ctx => {
      const config = await createTtsConfig(ctx, 'Conf TTS Default Clear');
      await ctx.call('put', '/api/user/tts-override/default', { configId: config.id });
    },
  },

  // ---- STT default provider -----------------------------------------------------

  getSttDefaultProvider: {},

  setSttDefaultProvider: {
    body: { providerId: 'mistral' },
  },

  clearSttDefaultProvider: {
    seed: async ctx => {
      await ctx.call('put', '/api/user/stt-override', { providerId: 'mistral' });
    },
  },

  // ---- Model override (per-personality + user default) ----------------------------

  listModelOverrides: {
    seed: async ctx => {
      const personality = await createPersonality(ctx, 'conf-model-override-list');
      const config = await createLlmConfig(ctx, 'Conf Model Override List');
      await ctx.call('put', '/api/user/model-override', {
        personalityId: personality.id,
        configId: config.id,
      });
    },
  },

  setModelOverride: {
    seed: async ctx => {
      const personality = await createPersonality(ctx, 'conf-model-override-set');
      const config = await createLlmConfig(ctx, 'Conf Model Override Set');
      return { body: { personalityId: personality.id, configId: config.id } };
    },
  },

  deleteModelOverride: {
    seed: async ctx => {
      const personality = await createPersonality(ctx, 'conf-model-override-del');
      const config = await createLlmConfig(ctx, 'Conf Model Override Del');
      await ctx.call('put', '/api/user/model-override', {
        personalityId: personality.id,
        configId: config.id,
      });
      return { params: { personalityId: personality.id } };
    },
  },

  getDefaultModelConfig: {
    seed: async ctx => {
      const config = await createLlmConfig(ctx, 'Conf Model Default Get');
      await ctx.call('put', '/api/user/model-override/default', { configId: config.id });
    },
  },

  setDefaultModelConfig: {
    seed: async ctx => {
      const config = await createLlmConfig(ctx, 'Conf Model Default Set');
      return { body: { configId: config.id } };
    },
  },

  clearDefaultModelConfig: {
    seed: async ctx => {
      const config = await createLlmConfig(ctx, 'Conf Model Default Clear');
      await ctx.call('put', '/api/user/model-override/default', { configId: config.id });
    },
  },
};
