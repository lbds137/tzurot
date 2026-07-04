import { describe, it, expect, vi } from 'vitest';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { generateClonedName } from '@tzurot/common-types/utils/presetCloneName';
import { resolveNonCollidingName, MAX_CLONE_NAME_ATTEMPTS } from './llmConfigNameCollision.js';
import { CloneNameExhaustedError } from './LlmConfigErrors.js';

/** Prisma stub whose llmConfig.findMany returns the given taken names as rows. */
function mockPrisma(takenNames: string[]) {
  return {
    llmConfig: {
      findMany: vi.fn().mockResolvedValue(takenNames.map(name => ({ name }))),
    },
  } as unknown as PrismaClient & { llmConfig: { findMany: ReturnType<typeof vi.fn> } };
}

describe('resolveNonCollidingName', () => {
  it('returns the base name when nothing collides', async () => {
    const prisma = mockPrisma([]);
    expect(await resolveNonCollidingName(prisma, 'Preset', 'owner-1', 'text')).toBe('Preset');
  });

  it('bumps a (Copy) suffix when the base name is taken', async () => {
    const prisma = mockPrisma(['Preset']);
    expect(await resolveNonCollidingName(prisma, 'Preset', 'owner-1', 'text')).toBe(
      'Preset (Copy)'
    );
  });

  it('matches case-insensitively (lowercased legacy rows still collide)', async () => {
    const prisma = mockPrisma(['preset']); // lowercase legacy row
    expect(await resolveNonCollidingName(prisma, 'Preset', 'owner-1', 'text')).toBe(
      'Preset (Copy)'
    );
  });

  it('scopes the lookup to the given owner and kind', async () => {
    const prisma = mockPrisma([]);
    await resolveNonCollidingName(prisma, 'Preset', 'owner-1', 'vision');
    expect(prisma.llmConfig.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ ownerId: 'owner-1', kind: 'vision' }),
      })
    );
  });

  it('throws CloneNameExhaustedError when the walk is exhausted', async () => {
    // Pre-take every candidate the walk will generate.
    const taken: string[] = [];
    let candidate = 'Preset';
    for (let i = 0; i < MAX_CLONE_NAME_ATTEMPTS; i++) {
      taken.push(candidate);
      candidate = generateClonedName(candidate);
    }
    const prisma = mockPrisma(taken);
    await expect(resolveNonCollidingName(prisma, 'Preset', 'owner-1', 'text')).rejects.toThrow(
      CloneNameExhaustedError
    );
  });
});
