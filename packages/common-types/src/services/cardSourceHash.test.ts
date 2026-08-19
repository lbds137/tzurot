import { describe, expect, it, vi } from 'vitest';

import { stampCardSourceHash } from './cardSourceHash.js';
import {
  hashRosterBlurbCard,
  ROSTER_BLURB_CARD_FIELDS,
  type RosterBlurbCard,
} from '../utils/rosterBlurbCard.js';
import type { PrismaClient } from './prisma.js';

function card(overrides: Partial<RosterBlurbCard> = {}): RosterBlurbCard {
  return {
    ...(Object.fromEntries(ROSTER_BLURB_CARD_FIELDS.map(k => [k, null])) as RosterBlurbCard),
    name: 'Ilana',
    characterInfo: 'A dry-witted archivist.',
    ...overrides,
  };
}

describe('stampCardSourceHash', () => {
  it('writes the digest of the card it was handed', async () => {
    const executeRaw = vi.fn().mockResolvedValue(1);

    await stampCardSourceHash(
      { $executeRaw: executeRaw } as unknown as PrismaClient,
      '4f9b0f66-0000-4000-8000-0000000000aa',
      card()
    );

    const args = executeRaw.mock.calls[0] as unknown[];
    expect(args).toContain(hashRosterBlurbCard(card()));
    expect(args).toContain('4f9b0f66-0000-4000-8000-0000000000aa');
  });

  it('stamps a different digest once a card field changes', async () => {
    const executeRaw = vi.fn().mockResolvedValue(1);
    const client = { $executeRaw: executeRaw } as unknown as PrismaClient;

    await stampCardSourceHash(client, 'id-a', card());
    await stampCardSourceHash(client, 'id-a', card({ personalityTone: 'warm' }));

    const first = executeRaw.mock.calls[0] as unknown[];
    const second = executeRaw.mock.calls[1] as unknown[];
    expect(first).not.toEqual(second);
  });

  it('ignores columns outside the card when computing the digest', async () => {
    const executeRaw = vi.fn().mockResolvedValue(1);
    const client = { $executeRaw: executeRaw } as unknown as PrismaClient;

    await stampCardSourceHash(client, 'id-a', card());
    await stampCardSourceHash(client, 'id-a', {
      ...card(),
      errorMessage: 'changed',
    } as RosterBlurbCard);

    expect(executeRaw.mock.calls[0]).toEqual(executeRaw.mock.calls[1]);
  });
});
