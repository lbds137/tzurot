import { describe, it, expect, vi } from 'vitest';
import type { Prisma } from '@tzurot/common-types/services/prisma';
import { reHomeCrossUserCharacters } from './reHome.js';

const SENTINEL = 'sentinel-uuid';

const SHARED = { id: 'x1', name: 'Shared', slug: 'shared' };
const SOLO = { id: 'z1', name: 'Solo', slug: 'solo' };

function makeTx(reach: { personalityId: string }[]) {
  const updateMany = vi.fn().mockResolvedValue({ count: reach.length });
  return {
    tx: {
      $queryRaw: vi.fn().mockResolvedValue(reach),
      personality: { updateMany },
    } as unknown as Prisma.TransactionClient,
    updateMany,
  };
}

const ARGS = {
  userId: 'departed-uuid',
  discordUserId: '900000000000000001',
  sentinelId: SENTINEL,
};

describe('reHomeCrossUserCharacters', () => {
  it('re-points only the reach-holding characters and stamps provenance', async () => {
    const { tx, updateMany } = makeTx([{ personalityId: 'x1' }]);

    const result = await reHomeCrossUserCharacters(tx, {
      ...ARGS,
      ownedCharacters: [SHARED, SOLO],
    });

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['x1'] } },
      data: { ownerId: SENTINEL, originalOwnerDiscordId: '900000000000000001' },
    });
    // The re-homed one is EXCLUDED from the delete set — otherwise the cascade
    // would take it (and every other user's data on it) anyway, making the
    // ownership change pointless.
    expect(result.deletedCharacters).toEqual([SOLO]);
    expect(result.charactersReHomed).toBe(1);
  });

  it('deletes everything and writes nothing when no character has reach', async () => {
    const { tx, updateMany } = makeTx([]);

    const result = await reHomeCrossUserCharacters(tx, {
      ...ARGS,
      ownedCharacters: [SOLO],
    });

    expect(updateMany).not.toHaveBeenCalled();
    expect(result.deletedCharacters).toEqual([SOLO]);
    expect(result.charactersReHomed).toBe(0);
  });

  it('short-circuits for a user who owns no characters', async () => {
    const { tx } = makeTx([]);

    const result = await reHomeCrossUserCharacters(tx, { ...ARGS, ownedCharacters: [] });

    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(result).toEqual({ deletedCharacters: [], charactersReHomed: 0 });
  });

  it('deletes nothing when EVERY owned character has reach', async () => {
    const { tx } = makeTx([{ personalityId: 'x1' }, { personalityId: 'z1' }]);

    const result = await reHomeCrossUserCharacters(tx, {
      ...ARGS,
      ownedCharacters: [SHARED, SOLO],
    });

    expect(result.deletedCharacters).toEqual([]);
    expect(result.charactersReHomed).toBe(2);
  });
});
