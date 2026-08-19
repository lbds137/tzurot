/**
 * PGLite component test: `PrismaContextDataSource.getRosterBlurbsByIds`.
 *
 * The unit test drives a mocked `findMany`, so it can prove the query SHAPE is
 * what we intended and nothing about what that shape actually selects. The
 * question here is a SQL one: `rosterBlurb: { not: null }` is a real predicate
 * against a real column, and the empty string — which the generator stores
 * deliberately, to mean "this card had nothing describable" — is a value that
 * passes it. That interaction is exactly what a mock cannot answer, and getting
 * it wrong renders an empty description rather than falling back to name-only.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@tzurot/common-types/services/prisma';
import type { PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { createTestPGlite, loadPGliteSchema, seedUserWithPersona } from '@tzurot/test-utils';
import {
  generateUserUuid,
  generatePersonaUuid,
  generatePersonalityUuid,
  generateSystemPromptUuid,
} from '@tzurot/common-types/utils/deterministicUuid';
import { PrismaContextDataSource } from './PrismaContextDataSource.js';

const DISCORD_USER_ID = '123456789012345670';

/** id → the blurb value seeded on that personality. */
const SEEDED = {
  prose: 'Kai is a dry-witted archivist who answers in short sentences.',
  empty: '',
  never: null,
} as const;

describe('getRosterBlurbsByIds — PGLite component', () => {
  let prisma: PrismaClient;
  let pglite: PGlite;
  let source: PrismaContextDataSource;
  const ids: Record<keyof typeof SEEDED, string> = {
    prose: generatePersonalityUuid('roster-blurb-prose'),
    empty: generatePersonalityUuid('roster-blurb-empty'),
    never: generatePersonalityUuid('roster-blurb-never'),
  };

  beforeAll(async () => {
    pglite = createTestPGlite();
    await pglite.exec(loadPGliteSchema());
    prisma = new PrismaClient({ adapter: new PrismaPGlite(pglite) }) as PrismaClient;
    source = new PrismaContextDataSource(prisma);

    const userId = generateUserUuid(DISCORD_USER_ID);
    await seedUserWithPersona(prisma, {
      userId,
      personaId: generatePersonaUuid('roster-blurb-user', userId),
      discordId: DISCORD_USER_ID,
      username: 'roster-blurb-user',
      personaName: 'roster-blurb-user',
    });
    const systemPrompt = await prisma.systemPrompt.create({
      data: {
        id: generateSystemPromptUuid('roster-blurb-prompt'),
        name: 'roster-blurb-prompt',
        content: 'You are a test assistant.',
      },
    });

    for (const key of ['prose', 'empty', 'never'] as const) {
      await prisma.personality.create({
        data: {
          id: ids[key],
          name: `RosterBlurb_${key}`,
          slug: `roster-blurb-${key}`,
          displayName: `Roster Blurb ${key}`,
          systemPromptId: systemPrompt.id,
          ownerId: userId,
          characterInfo: 'A test bot',
          personalityTraits: 'Helpful and deterministic',
          rosterBlurb: SEEDED[key],
        },
      });
    }
  });

  afterAll(async () => {
    await pglite.close();
  });

  it('returns the blurb for a character that has one', async () => {
    const result = await source.getRosterBlurbsByIds([ids.prose]);

    expect(result.get(ids.prose)).toBe(SEEDED.prose);
  });

  it('omits a character whose stored blurb is the empty string', async () => {
    // The empty string SURVIVES `not: null` in real SQL — it is a value, not an
    // absence. This is the assertion the mocked unit test structurally cannot
    // make, and the one standing between a blank <about> body and name-only.
    const result = await source.getRosterBlurbsByIds([ids.empty]);

    expect(result.has(ids.empty)).toBe(false);
  });

  it('omits a character that has never been generated', async () => {
    const result = await source.getRosterBlurbsByIds([ids.never]);

    expect(result.has(ids.never)).toBe(false);
  });

  it('returns only the renderable subset when the roster mixes all three states', async () => {
    // The realistic tick: one generated sibling, one blank-card sibling, one the
    // sweep has not reached. Only the first renders a description.
    const result = await source.getRosterBlurbsByIds([ids.prose, ids.empty, ids.never]);

    expect([...result.keys()]).toEqual([ids.prose]);
  });

  it('returns an empty map for ids that match no personality', async () => {
    const result = await source.getRosterBlurbsByIds([generatePersonalityUuid('absent')]);

    expect(result.size).toBe(0);
  });
});
