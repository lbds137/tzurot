/**
 * Component test: DescriptionPromptService against a real schema.
 *
 * The unit test mocks Prisma entirely, so it proves the caching contract but
 * NOT the query — `findFirst({ where: { isDefault: true } })` could name a
 * column that doesn't exist, or select the wrong row among several, and the
 * mock would happily agree. That matters more than usual here because the
 * value this query returns frames every image description the instance ever
 * writes, and those descriptions are cached (permanently, for a
 * snowflake-keyed sticker).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { PrismaClient } from '@tzurot/common-types/services/prisma';
import { generateSystemPromptUuid } from '@tzurot/common-types/utils/deterministicUuid';
import { createTestPGlite, loadPGliteSchema } from '@tzurot/test-utils';
import { DescriptionPromptService } from './DescriptionPromptService.js';

describe('DescriptionPromptService (component)', () => {
  let pglite: PGlite;
  let prisma: PrismaClient;

  const defaultId = generateSystemPromptUuid('description-prompt-default');
  const otherId = generateSystemPromptUuid('description-prompt-other');

  beforeAll(async () => {
    pglite = createTestPGlite();
    await pglite.exec(loadPGliteSchema());
    const adapter = new PrismaPGlite(pglite);
    prisma = new PrismaClient({ adapter }) as PrismaClient;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await pglite.close();
  });

  beforeEach(async () => {
    await prisma.systemPrompt.deleteMany({});
  });

  it('reads the content of the isDefault row', async () => {
    await prisma.systemPrompt.create({
      data: { id: defaultId, name: 'Default', content: 'Instance framing.', isDefault: true },
    });

    const service = new DescriptionPromptService(prisma);
    await service.refresh();

    expect(service.get()).toBe('Instance framing.');
  });

  it('ignores non-default rows even when they are the only ones present', async () => {
    // A personality-linked row must never become the description framing just
    // because it exists — that IS the bug this service was built to fix.
    await prisma.systemPrompt.create({
      data: { id: otherId, name: 'Character prompt', content: 'You are Lila.', isDefault: false },
    });

    const service = new DescriptionPromptService(prisma);
    await service.refresh();

    expect(service.get()).toBeUndefined();
  });

  it('selects the default row when several prompts coexist', async () => {
    await prisma.systemPrompt.create({
      data: { id: otherId, name: 'Character prompt', content: 'You are Lila.', isDefault: false },
    });
    await prisma.systemPrompt.create({
      data: { id: defaultId, name: 'Default', content: 'Instance framing.', isDefault: true },
    });

    const service = new DescriptionPromptService(prisma);
    await service.refresh();

    expect(service.get()).toBe('Instance framing.');
  });

  it('picks deterministically when two rows are both marked default', async () => {
    // Nothing constrains the table to one default (TASK-362), and an unordered
    // findFirst would let Postgres return either row — and change its mind —
    // making the framing of every description non-deterministic.
    await prisma.systemPrompt.create({
      data: {
        id: defaultId,
        name: 'Older default',
        content: 'Older framing.',
        isDefault: true,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    await prisma.systemPrompt.create({
      data: {
        id: otherId,
        name: 'Newer default',
        content: 'Newer framing.',
        isDefault: true,
        createdAt: new Date('2026-06-01T00:00:00.000Z'),
      },
    });

    const first = new DescriptionPromptService(prisma);
    const second = new DescriptionPromptService(prisma);
    await first.refresh();
    await second.refresh();

    expect(first.get()).toBe('Older framing.');
    // Same answer twice — stability is the property under test, not which row.
    expect(second.get()).toBe(first.get());
  });

  it('is undefined when the table is empty', async () => {
    const service = new DescriptionPromptService(prisma);
    await service.refresh();

    expect(service.get()).toBeUndefined();
  });
});
