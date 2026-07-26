import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { stampDmPermanentFailure } from './dmFailureStamps.js';

function makePrisma() {
  const executeRaw = vi.fn().mockResolvedValue(1);
  return { prisma: { $executeRaw: executeRaw } as unknown as PrismaClient, executeRaw };
}

function sql(call: unknown[]): string {
  const [strings] = call as [TemplateStringsArray, ...unknown[]];
  return strings.join('');
}

describe('stampDmPermanentFailure', () => {
  it.each(['50278', '50007'])('stamps dm_undeliverable_since for %s', async code => {
    const { prisma, executeRaw } = makePrisma();

    await stampDmPermanentFailure(prisma, 'user-1', code);

    expect(executeRaw).toHaveBeenCalledTimes(1);
    const text = sql(executeRaw.mock.calls[0]);
    expect(text).toContain('dm_undeliverable_since = NOW()');
    // First-failure only — a live streak must never advance the stamp.
    expect(text).toContain('dm_undeliverable_since IS NULL');
    expect(text).not.toContain('updated_at');
  });

  it('stamps discord_account_gone_at for 10013', async () => {
    const { prisma, executeRaw } = makePrisma();

    await stampDmPermanentFailure(prisma, 'user-1', '10013');

    const text = sql(executeRaw.mock.calls[0]);
    expect(text).toContain('discord_account_gone_at = NOW()');
    expect(text).toContain('discord_account_gone_at IS NULL');
  });

  it('stamps NOTHING for 20026 — a quarantined bot says nothing about the user', async () => {
    const { prisma, executeRaw } = makePrisma();

    await stampDmPermanentFailure(prisma, 'user-1', '20026');

    expect(executeRaw).not.toHaveBeenCalled();
  });

  it('stamps nothing for an unknown or missing code', async () => {
    const { prisma, executeRaw } = makePrisma();

    await stampDmPermanentFailure(prisma, 'user-1', '99999');
    await stampDmPermanentFailure(prisma, 'user-1', undefined);

    expect(executeRaw).not.toHaveBeenCalled();
  });

  it('propagates database failures — swallow-vs-throw is the caller choice', async () => {
    const { prisma, executeRaw } = makePrisma();
    executeRaw.mockRejectedValueOnce(new Error('db down'));

    await expect(stampDmPermanentFailure(prisma, 'user-1', '50278')).rejects.toThrow('db down');
  });
});
