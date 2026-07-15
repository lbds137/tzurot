/**
 * Conformance fixtures: internal (service-to-service) routes.
 *
 * The generated internal mounts carry no audience middleware (service-auth
 * is applied globally in index.ts), so these replay without auth headers
 * doing any work. BullMQ-backed routes run over the harness's fake queue
 * (see harness.ts) and the runner's queue.js module mock — the response
 * shaping is what's under test, not the queue.
 */

import {
  generateReleaseAnnouncementUuid,
  generateReleaseDeliveryLogUuid,
} from '@tzurot/common-types/utils/deterministicUuid';
import type { ConformanceEntry, SeedContext } from './types.js';
import { createPersonality } from './seedHelpers.js';

/** Minimal valid loadedPersonalitySchema envelope for aiGenerate. */
function loadedPersonality(id: string, ownerId: string): Record<string, unknown> {
  return {
    id,
    name: 'Conformance Generate',
    displayName: 'Conformance Generate',
    slug: 'conf-ai-generate',
    ownerId,
    systemPrompt: 'You are a conformance-harness personality.',
    model: 'anthropic/claude-sonnet-4',
    temperature: 0.7,
    contextWindowTokens: 8000,
    characterInfo: 'Character info for the conformance generate envelope.',
    personalityTraits: 'Methodical, thorough.',
  };
}

/**
 * Resolve the actor's CURRENT default persona at seed time — the ownership
 * family's setPersonaDefault fixture changes it mid-run, so the value
 * captured at provisioning can be stale (same pattern as userMemory).
 */
async function currentDefaultPersonaId(ctx: SeedContext): Promise<string> {
  const user = await ctx.prisma.user.findUnique({
    where: { id: ctx.actorUserId },
    select: { defaultPersonaId: true },
  });
  if (user?.defaultPersonaId === undefined || user.defaultPersonaId === null) {
    throw new Error('conformance seed: actor has no default persona');
  }
  return user.defaultPersonaId;
}

/** Insert a diagnostic row for the response-ids PATCH. */
async function seedDiagnosticRow(ctx: SeedContext, requestId: string): Promise<void> {
  await ctx.prisma.llmDiagnosticLog.create({
    data: {
      requestId,
      userId: ctx.actorDiscordId,
      model: 'anthropic/claude-sonnet-4',
      provider: 'openrouter',
      durationMs: 1234,
      data: { meta: { source: 'conformance-harness' } },
    },
  });
}

export const internalFixtures: Record<string, ConformanceEntry> = {
  aiGenerate: {
    seed: async ctx => {
      const personality = await createPersonality(ctx, 'conf-ai-generate');
      return {
        body: {
          // ownerId matches the actor that created the personality so any
          // ownership-sensitive path in the pipeline sees consistent data.
          personality: loadedPersonality(personality.id, ctx.actorUserId),
          message: 'Conformance harness trigger message.',
          context: { userId: ctx.actorDiscordId },
        },
      };
    },
  },

  aiTranscribe: {
    // Async branch (no ?wait=true): enqueues via the fake queue and returns
    // the job envelope immediately — no voice-engine round-trip.
    seed: ctx =>
      Promise.resolve({
        body: {
          attachments: [
            {
              url: 'https://cdn.example.invalid/conf-voice-message.ogg',
              contentType: 'audio/ogg',
              name: 'conf-voice-message.ogg',
              size: 4096,
            },
          ],
          userId: ctx.actorDiscordId,
        },
      }),
  },

  aiJobStatus: {
    params: { jobId: 'conformance-job-1' },
  },

  releaseBroadcastPending: {
    seed: async ctx => {
      const releaseId = generateReleaseAnnouncementUuid('conf-pending-1');
      const logId = generateReleaseDeliveryLogUuid(releaseId, ctx.actorUserId);
      await ctx.prisma.releaseAnnouncement.create({
        data: {
          id: releaseId,
          version: 'conf-pending-1',
          level: 'major',
          githubReleaseId: 'adhoc',
          body: 'conformance',
        },
      });
      await ctx.prisma.releaseDeliveryLog.create({
        data: { id: logId, releaseId, userId: ctx.actorUserId },
      });
      return { params: { releaseId }, body: { deliveryLogIds: [logId] } };
    },
  },

  releaseBroadcastDeliveries: {
    seed: async ctx => {
      const releaseId = generateReleaseAnnouncementUuid('conf-deliveries-1');
      const logId = generateReleaseDeliveryLogUuid(releaseId, ctx.actorUserId);
      await ctx.prisma.releaseAnnouncement.create({
        data: {
          id: releaseId,
          version: 'conf-deliveries-1',
          level: 'major',
          githubReleaseId: 'adhoc',
          body: 'conformance',
        },
      });
      await ctx.prisma.releaseDeliveryLog.create({
        data: { id: logId, releaseId, userId: ctx.actorUserId },
      });
      return {
        params: { releaseId },
        body: { results: [{ deliveryLogId: logId, status: 'sent' }] },
      };
    },
  },

  releaseBroadcastReconcile: {
    skip: 'Fetches the GitHub releases list over the network — no success path without a live external API.',
  },

  aiConfirmDelivery: {
    seed: async ctx => {
      await ctx.prisma.jobResult.create({
        data: {
          jobId: 'conf-confirm-job',
          requestId: 'conf-confirm-request',
          result: { content: 'conformance result' },
          status: 'PENDING_DELIVERY',
        },
      });
    },
    params: { jobId: 'conf-confirm-job' },
  },

  setDmSession: {
    seed: async ctx => {
      await createPersonality(ctx, 'conf-dm-session');
    },
    body: { channelId: '830000000000000001', personalitySlug: 'conf-dm-session' },
  },

  lookupPersonalityFromMessage: {
    seed: async ctx => {
      const personality = await createPersonality(ctx, 'conf-message-lookup');
      const user = await ctx.prisma.user.findUnique({
        where: { id: ctx.actorUserId },
        select: { defaultPersonaId: true },
      });
      if (user?.defaultPersonaId === undefined || user.defaultPersonaId === null) {
        throw new Error('lookupPersonalityFromMessage seed: actor has no default persona');
      }
      await ctx.prisma.conversationHistory.create({
        data: {
          id: 'c0000000-0000-4000-8000-000000000001',
          channelId: '830000000000000002',
          personalityId: personality.id,
          personaId: user.defaultPersonaId,
          role: 'assistant',
          content: 'Conformance assistant reply.',
          discordMessageId: ['830000000000000003'],
        },
      });
    },
    query: { discordMessageId: '830000000000000003' },
  },

  persistUserMessage: {
    seed: async ctx => {
      const personality = await createPersonality(ctx, 'conf-persist-user-msg');
      const personaId = await currentDefaultPersonaId(ctx);
      return {
        body: {
          channelId: '830000000000000010',
          guildId: '830000000000000011',
          personalityId: personality.id,
          personaId,
          content: 'Conformance user message.',
          discordMessageId: '830000000000000012',
          messageTime: new Date().toISOString(),
        },
      };
    },
  },

  persistAssistantMessage: {
    seed: async ctx => {
      const personality = await createPersonality(ctx, 'conf-persist-assistant-msg');
      const personaId = await currentDefaultPersonaId(ctx);
      return {
        body: {
          channelId: '830000000000000013',
          guildId: '830000000000000014',
          personalityId: personality.id,
          personaId,
          content: 'Conformance assistant reply.',
          chunkMessageIds: ['830000000000000015'],
          userMessageTime: new Date().toISOString(),
        },
      };
    },
  },

  syncConversation: {
    seed: async ctx => {
      // Persist a user message via the real API, then sync an EDITED snapshot
      // of the same Discord message so the diff path (updated: 1) runs rather
      // than the trivial no-op branch.
      const personality = await createPersonality(ctx, 'conf-sync-conversation');
      const personaId = await currentDefaultPersonaId(ctx);
      await ctx.call('post', '/api/internal/conversation/user-message', {
        channelId: '830000000000000016',
        guildId: '830000000000000017',
        personalityId: personality.id,
        personaId,
        content: 'Original content before edit.',
        discordMessageId: '830000000000000018',
        messageTime: new Date().toISOString(),
      });
      return {
        body: {
          channelId: '830000000000000016',
          personalityId: personality.id,
          observedMessages: [
            {
              discordMessageId: '830000000000000018',
              content: 'Edited content after sync.',
              createdAt: new Date().toISOString(),
            },
          ],
        },
      };
    },
  },

  loadPersonalityInternal: {
    seed: async ctx => {
      await createPersonality(ctx, 'conf-load-personality');
    },
    query: { nameOrId: 'conf-load-personality' },
  },

  routingContextCreate: {
    // Uses the already-provisioned actor's discordId so getOrCreateUser hits
    // the existing-user path; the cascade resolves the actor's persona for the
    // freshly-created personality and the bundle (userId/persona/timezone/epoch)
    // is shaped against RoutingContextResponseSchema.
    seed: async ctx => {
      const personality = await createPersonality(ctx, 'conf-routing-context');
      return {
        body: {
          discordId: ctx.actorDiscordId,
          username: 'conf-routing-user',
          displayName: 'Conf Routing User',
          personalityId: personality.id,
        },
      };
    },
  },

  recentUsers: {
    // The provisioned actor row itself is the "recent user" — zero extra seed.
  },

  getModels: {
    // No DB seed: the catalog comes from the harness's fake modelCache.
    query: { search: 'claude', limit: '10' },
  },

  getDenylistCache: {
    seed: async ctx => {
      await ctx.call('post', '/api/admin/denylist', {
        type: 'USER',
        discordId: '820000000000000004',
        reason: 'Conformance harness (cache).',
      });
    },
  },

  updateDiagnosticResponseIds: {
    seed: async ctx => {
      await seedDiagnosticRow(ctx, 'conf-diag-update-ids');
    },
    params: { requestId: 'conf-diag-update-ids' },
    body: { responseMessageIds: ['830000000000000004'] },
  },

  getChannelSettings: {
    seed: async ctx => {
      await createPersonality(ctx, 'conf-internal-channel');
      await ctx.call('post', '/api/user/channel/activate', {
        channelId: '830000000000000005',
        personalitySlug: 'conf-internal-channel',
        guildId: '830000000000000006',
      });
    },
    params: { channelId: '830000000000000005' },
  },

  getAdminSettingsInternal: {},
};
