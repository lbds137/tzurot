/**
 * Conformance fixtures: user-audience memory routes
 * (CRUD, batch-delete/purge token handshakes, focus mode, incognito).
 *
 * Memories have no create API (the ai-worker writes them), so rows are
 * inserted directly via Prisma. The embedding column is nullable, and
 * search uses `preferTextSearch` to stay off the embedding model.
 * Token handshakes run against the harness's mock Redis — the real
 * MemoryActionTokenService path.
 */

import type { ConformanceEntry, SeedContext } from './types.js';
import { createPersonality } from './seedHelpers.js';

/**
 * Insert a memory row owned by the actor's CURRENT default persona.
 *
 * Resolved at seed time (not from ctx.actorPersonaId) because the memory
 * handlers scope lookups to the user's current defaultPersonaId — and the
 * ownership-family setPersonaDefault fixture changes it mid-run.
 */
async function seedMemory(
  ctx: SeedContext,
  id: string,
  personalityId: string,
  content: string
): Promise<{ id: string }> {
  const user = await ctx.prisma.user.findUnique({
    where: { id: ctx.actorUserId },
    select: { defaultPersonaId: true },
  });
  if (user?.defaultPersonaId === undefined || user.defaultPersonaId === null) {
    throw new Error('seedMemory: actor has no default persona');
  }
  await ctx.prisma.memory.create({
    data: {
      id,
      personalityId,
      personaId: user.defaultPersonaId,
      content,
    },
  });
  return { id };
}

export const userMemoryFixtures: Record<string, ConformanceEntry> = {
  // ---- Stats / list ----------------------------------------------------------

  getStats: {
    seed: async ctx => {
      const personality = await createPersonality(ctx, 'conf-memory-stats');
      await seedMemory(
        ctx,
        '3e300000-0000-4000-8000-000000000001',
        personality.id,
        'Stats memory.'
      );
      return { query: { personalityId: personality.id } };
    },
  },

  list: {
    seed: async ctx => {
      const personality = await createPersonality(ctx, 'conf-memory-list');
      await seedMemory(ctx, '3e300000-0000-4000-8000-000000000002', personality.id, 'List memory.');
      return { query: { personalityId: personality.id } };
    },
  },

  search: {
    seed: async ctx => {
      const personality = await createPersonality(ctx, 'conf-memory-search');
      await seedMemory(
        ctx,
        '3e300000-0000-4000-8000-000000000003',
        personality.id,
        'Searchable conformance memory content.'
      );
      return {
        body: {
          query: 'conformance memory',
          personalityId: personality.id,
          preferTextSearch: true,
        },
      };
    },
  },

  // ---- Destructive batch (token handshakes) ----------------------------------

  batchDeletePreview: {
    seed: async ctx => {
      const personality = await createPersonality(ctx, 'conf-memory-preview');
      await seedMemory(
        ctx,
        '3e300000-0000-4000-8000-000000000004',
        personality.id,
        'Preview memory.'
      );
      return { body: { personalityId: personality.id } };
    },
  },

  batchDelete: {
    seed: async ctx => {
      const personality = await createPersonality(ctx, 'conf-memory-batch-del');
      await seedMemory(
        ctx,
        '3e300000-0000-4000-8000-000000000005',
        personality.id,
        'Batch-delete memory.'
      );
      const preview = (await ctx.call('post', '/api/user/memory/delete/preview', {
        personalityId: personality.id,
      })) as { previewToken: string };
      return { body: { previewToken: preview.previewToken } };
    },
  },

  issuePurgeToken: {
    seed: async ctx => {
      const personality = await createPersonality(ctx, 'conf-memory-purge-token');
      await seedMemory(
        ctx,
        '3e300000-0000-4000-8000-000000000006',
        personality.id,
        'Purge-token memory.'
      );
      return {
        body: {
          personalityId: personality.id,
          confirmationPhrase: 'DELETE CONFORMANCE CONF-MEMORY-PURGE-TOKEN MEMORIES',
        },
      };
    },
  },

  purge: {
    seed: async ctx => {
      const personality = await createPersonality(ctx, 'conf-memory-purge');
      await seedMemory(
        ctx,
        '3e300000-0000-4000-8000-000000000007',
        personality.id,
        'Purge memory.'
      );
      const issued = (await ctx.call('post', '/api/user/memory/purge/token', {
        personalityId: personality.id,
        confirmationPhrase: 'DELETE CONFORMANCE CONF-MEMORY-PURGE MEMORIES',
      })) as { purgeToken: string };
      return { body: { purgeToken: issued.purgeToken } };
    },
  },

  // ---- Single memory --------------------------------------------------------

  getMemory: {
    seed: async ctx => {
      const personality = await createPersonality(ctx, 'conf-memory-get');
      const memory = await seedMemory(
        ctx,
        '3e300000-0000-4000-8000-000000000008',
        personality.id,
        'Get memory.'
      );
      return { params: { id: memory.id } };
    },
  },

  updateMemory: {
    seed: async ctx => {
      const personality = await createPersonality(ctx, 'conf-memory-update');
      const memory = await seedMemory(
        ctx,
        '3e300000-0000-4000-8000-000000000009',
        personality.id,
        'Update memory.'
      );
      return { params: { id: memory.id } };
    },
    body: { content: 'Updated by the conformance harness.' },
  },

  deleteMemory: {
    seed: async ctx => {
      const personality = await createPersonality(ctx, 'conf-memory-delete');
      const memory = await seedMemory(
        ctx,
        '3e300000-0000-4000-8000-000000000010',
        personality.id,
        'Delete memory.'
      );
      return { params: { id: memory.id } };
    },
  },

  setMemoryLock: {
    seed: async ctx => {
      const personality = await createPersonality(ctx, 'conf-memory-lock');
      const memory = await seedMemory(
        ctx,
        '3e300000-0000-4000-8000-000000000011',
        personality.id,
        'Lock memory.'
      );
      return { params: { id: memory.id } };
    },
    body: { locked: true },
  },

  // ---- Incognito --------------------------------------------------------------

  getIncognitoStatus: {},

  enableIncognito: {
    seed: async ctx => {
      const personality = await createPersonality(ctx, 'conf-incognito-enable');
      return { body: { personalityId: personality.id, duration: '30m' } };
    },
  },

  disableIncognito: {
    seed: async ctx => {
      const personality = await createPersonality(ctx, 'conf-incognito-disable');
      await ctx.call('post', '/api/user/memory/incognito', {
        personalityId: personality.id,
        duration: '30m',
      });
      return { body: { personalityId: personality.id } };
    },
  },

  incognitoForget: {
    seed: async ctx => {
      const personality = await createPersonality(ctx, 'conf-incognito-forget');
      await seedMemory(
        ctx,
        '3e300000-0000-4000-8000-000000000012',
        personality.id,
        'Forget memory.'
      );
      return { body: { personalityId: personality.id, timeframe: '15m' } };
    },
  },

  // ---- Fresh ------------------------------------------------------------------

  getFreshStatus: {},

  enableFresh: {
    seed: async ctx => {
      const personality = await createPersonality(ctx, 'conf-fresh-enable');
      return { body: { personalityId: personality.id, duration: '30m' } };
    },
  },

  disableFresh: {
    seed: async ctx => {
      const personality = await createPersonality(ctx, 'conf-fresh-disable');
      await ctx.call('post', '/api/user/memory/fresh', {
        personalityId: personality.id,
        duration: '30m',
      });
      return { body: { personalityId: personality.id } };
    },
  },
};
