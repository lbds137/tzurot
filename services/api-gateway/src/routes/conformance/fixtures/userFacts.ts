/**
 * Conformance fixtures: user-audience memory-fact routes (correction slice).
 *
 * Facts have no create API (the ai-worker's extraction worker writes them), so
 * rows are inserted directly via Prisma with a NULL embedding — the list/get/
 * forget/lock handlers don't touch the vector, so no embedding model is needed.
 * `correctFact` is skipped: it must embed the corrected statement, and the
 * harness deliberately stays off the embedding model (that path is covered by
 * the unit + PGLite component tests).
 */

import type { ConformanceEntry, SeedContext } from './types.js';
import { createPersonality } from './seedHelpers.js';

/** Insert an active fact owned by the actor's CURRENT default persona. */
async function seedFact(
  ctx: SeedContext,
  id: string,
  personalityId: string,
  statement: string
): Promise<{ id: string }> {
  const user = await ctx.prisma.user.findUnique({
    where: { id: ctx.actorUserId },
    select: { defaultPersonaId: true },
  });
  if (user?.defaultPersonaId === undefined || user.defaultPersonaId === null) {
    throw new Error('seedFact: actor has no default persona');
  }
  await ctx.prisma.memoryFact.create({
    data: { id, personalityId, personaId: user.defaultPersonaId, statement, entityTags: ['user'] },
  });
  return { id };
}

export const userFactFixtures: Record<string, ConformanceEntry> = {
  listFacts: {
    seed: async ctx => {
      const personality = await createPersonality(ctx, 'conf-fact-list');
      await seedFact(
        ctx,
        '3e300000-0000-4000-8000-000000000020',
        personality.id,
        'The user lives in Seattle.'
      );
      return { query: { personalityId: personality.id } };
    },
  },

  getFact: {
    seed: async ctx => {
      const personality = await createPersonality(ctx, 'conf-fact-get');
      const fact = await seedFact(
        ctx,
        '3e300000-0000-4000-8000-000000000021',
        personality.id,
        'The user has a cat named Miso.'
      );
      return { params: { id: fact.id } };
    },
  },

  forgetFact: {
    seed: async ctx => {
      const personality = await createPersonality(ctx, 'conf-fact-forget');
      const fact = await seedFact(
        ctx,
        '3e300000-0000-4000-8000-000000000022',
        personality.id,
        'The user works as a nurse.'
      );
      return { params: { id: fact.id } };
    },
  },

  setFactLock: {
    seed: async ctx => {
      const personality = await createPersonality(ctx, 'conf-fact-lock');
      const fact = await seedFact(
        ctx,
        '3e300000-0000-4000-8000-000000000023',
        personality.id,
        'The user prefers tea over coffee.'
      );
      return { params: { id: fact.id } };
    },
    body: { locked: true },
  },

  correctFact: {
    skip: 'Correcting embeds the new statement to write its vector; the harness stays off the embedding model. Covered by memoryFacts.test.ts + memoryFacts.component.test.ts (real PGLite INSERT/supersede).',
  },
};
