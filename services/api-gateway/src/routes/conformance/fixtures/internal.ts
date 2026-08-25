/**
 * Conformance fixtures: internal (service-to-service) routes.
 *
 * The generated internal mounts carry no audience middleware (service-auth
 * is applied globally in index.ts), so these replay without auth headers
 * doing any work. BullMQ-backed routes run over the harness's fake queue
 * (see harness.ts) and the runner's queue.js module mock — the response
 * shaping is what's under test, not the queue.
 */

import { ACCOUNT_EXPORT_SOURCE } from '@tzurot/common-types/types/account-export';
import { ensureOrphanSentinel } from '../../../services/OrphanSentinelBootstrap.js';
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
          context: {
            kind: 'envelope',
            userId: ctx.actorDiscordId,
            rawAssemblyInputs: { rawMessageContent: 'Conformance harness trigger message.' },
          },
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

  recordGuildMemberInfo: {
    // The actor already has a user row, so this drives the `recorded: true`
    // arm — the one that actually writes. The Discord id has to come from the
    // seed because the harness generates the actor.
    seed: ctx =>
      Promise.resolve({
        body: {
          guildId: '830000000000000002',
          discordUserId: ctx.actorDiscordId,
          info: { roles: ['Conformance'], displayColor: '#FF00FF' },
        },
      }),
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

  patchForwardedOrigin: {
    seed: async ctx => {
      const personality = await createPersonality(ctx, 'conf-forwarded-origin');
      const personaId = await currentDefaultPersonaId(ctx);
      return {
        body: {
          channelId: '830000000000000020',
          personalityId: personality.id,
          personaId,
          // No row is seeded on purpose: the endpoint answers 200 with
          // updated:false for a row that does not exist, and that IS its
          // contract — a fire-and-forget back-fill must not 404 at a caller
          // who has nothing to do about it.
          messageTime: new Date().toISOString(),
          forwardedFrom: {
            authorName: 'Conformance Character',
            authorId: '830000000000000021',
            timestamp: new Date().toISOString(),
          },
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

  stampUserActivity: {
    // The provisioned actor row is the stamp target — no extra DB seed. Passing
    // the actor's own discordId exercises the success path (stamped: true).
    seed: ctx => Promise.resolve({ body: { discordId: ctx.actorDiscordId } }),
  },

  recordCommandEvent: {
    // command_events has no user FK by design (it keys on the loose Discord
    // snowflake), so the insert needs no seeded row at all — the actor's own
    // id just keeps the written row attributable to this run. The `context`
    // bag carries one allowlisted key so the replay exercises the strip
    // rather than only the undefined-context path.
    seed: ctx =>
      Promise.resolve({
        body: {
          userId: ctx.actorDiscordId,
          channelKind: 'guild',
          command: 'conformance.record',
          outcome: 'ok',
          latencyMs: 12,
          context: { model_family: 'conformance' },
        },
      }),
  },

  secretRotationStatus: {
    // Empty ledger is a valid (pre-seed) state; the route returns
    // entries: [] + overdueCount: 0 — zero seed needed.
  },

  retentionPreview: {
    // An empty cohort is the healthy steady state (and the conformance actor is
    // recent + reachable, so it can't be eligible): the route returns
    // users: [] with zeroed totals — zero seed needed.
  },

  retentionPurge: {
    // Targets a Discord id no user row has, so the route takes its idempotent
    // branch and returns 200 { status: 'skipped', reason: 'already_gone' } —
    // which is the shape conformance is checking. Deliberately NOT seeding a
    // purgeable user: this harness replays every route against a shared
    // database, and a fixture that erases an account would be reaching outside
    // its own state. The real erasure is proven in
    // RetentionPurgeService.component.test.ts against an isolated PGLite DB.
    body: { discordId: '829999999999999999', runContext: 'conformance' },
  },

  retentionNotify: {
    // Dry run against the empty steady state (the conformance actor is recent
    // and reachable, so the notify cohort is empty): resolves, enqueues
    // nothing, needs no queue and no seed.
    body: { dryRun: true },
  },

  retentionNotifyFilter: {
    // No user row carries this id, so the still-eligible subset is empty —
    // the shape conformance checks, with zero seed and zero writes.
    body: { userIds: ['829e4567-e89b-42d3-a456-426614174999'] },
  },

  retentionNotifyReport: {
    // A transient outcome stamps NOTHING by design (the queue retries it), so
    // this exercises the route's happy path without writing shared state.
    body: {
      outcomes: [{ userId: '829e4567-e89b-42d3-a456-426614174999', status: 'failed_transient' }],
    },
  },

  retentionReconcileOffDb: {
    // An empty audit ledger is the steady state: the sweep finds nothing owed
    // and returns { settled: 0, stillFailing: 0, remaining: 0 } — zero seed needed.
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

  // Both export-smoke routes operate on locally-stored rows (export_jobs +
  // a BullMQ enqueue the harness's fake queue absorbs) — no external round
  // trip, so they run for real like the user-tier account/shapes export
  // routes. `startExportSmoke` self-heals the Orphaned-Characters sentinel
  // via `ensureOrphanSentinel`, so no seed is needed for it to reach its
  // success path.
  startExportSmoke: {},

  getExportSmokeStatus: {
    // Seeds its OWN row directly (rather than calling the real start route)
    // so it never contends with `startExportSmoke`'s fixture over the
    // sentinel account's single deterministic export-job id — both fixtures
    // target the same sentinel, and the active-job conflict check in
    // `createExportJobOrConflict` is never bypassed, so a real start call
    // here would 409 whichever fixture runs second.
    seed: async ctx => {
      const id = '14b00000-0000-4000-8000-000000000010';
      // Under the SENTINEL, not the actor: the status route scopes its query
      // to the sentinel's own userId (id-only lookup would resolve arbitrary
      // users' export download URLs), so an actor-owned row would 404.
      const sentinelId = await ensureOrphanSentinel(ctx.prisma);
      await ctx.prisma.exportJob.create({
        data: {
          id,
          userId: sentinelId,
          sourceSlug: 'conf-export-smoke',
          sourceService: ACCOUNT_EXPORT_SOURCE,
          status: 'completed',
          format: 'zip',
          fileName: 'conf-export-smoke.zip',
          fileSizeBytes: 42,
          // download_token is UNIQUE and conformance fixtures share one
          // database — 'e'.repeat(64) and 'f'.repeat(64) are already taken
          // (listShapesExportJobs, getAccountExportStatus).
          downloadToken: 'd'.repeat(64),
          completedAt: new Date(),
          expiresAt: new Date(Date.now() + 3600 * 1000),
        },
      });
      return { query: { jobId: id } };
    },
  },
};
