import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { assembleAccountExport } from './AccountExportAssembler.js';

function emptyModel(): { findMany: ReturnType<typeof vi.fn> } {
  return { findMany: vi.fn().mockResolvedValue([]) };
}

function makePrisma(): Record<string, { findMany?: ReturnType<typeof vi.fn> }> {
  return {
    user: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ username: 'alice', discordId: '1' }),
    } as never,
    persona: emptyModel(),
    personalityOwner: emptyModel(),
    personality: emptyModel(),
    conversationHistory: emptyModel(),
    memory: emptyModel(),
    memoryFact: emptyModel(),
    userPersonalityConfig: emptyModel(),
    userPersonaHistoryConfig: emptyModel(),
    llmConfig: emptyModel(),
    ttsConfig: emptyModel(),
    userApiKey: emptyModel(),
    userCredential: emptyModel(),
    usageLog: { groupBy: vi.fn().mockResolvedValue([]) } as never,
    userFeedback: emptyModel(),
    importJob: emptyModel(),
    exportJob: emptyModel(),
    releaseDeliveryLog: emptyModel(),
  };
}

describe('assembleAccountExport', () => {
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(() => {
    prisma = makePrisma();
  });

  it('assembles every section with the disclosure notes', async () => {
    const payload = await assembleAccountExport(prisma as unknown as PrismaClient, 'user-1');

    expect(payload.profile).toEqual({ username: 'alice', discordId: '1' });
    for (const section of [
      'personas',
      'characters',
      'conversationHistory',
      'memories',
      'facts',
      'usageSummary',
      'feedback',
      'apiKeyMetadata',
      'credentialMetadata',
    ] as const) {
      expect(payload[section]).toEqual([]);
    }
    expect(payload.meta.formatVersion).toBe(1);
    expect(payload.meta.notes.join(' ')).toContain('secret material is never exported');
  });

  it('selects only metadata columns for keys and credentials (never secret columns)', async () => {
    await assembleAccountExport(prisma as unknown as PrismaClient, 'user-1');

    const keySelect = prisma.userApiKey.findMany?.mock.calls[0][0].select;
    expect(keySelect).toEqual({ id: true, provider: true, createdAt: true, updatedAt: true });
    const credSelect = prisma.userCredential.findMany?.mock.calls[0][0].select;
    expect(credSelect).toEqual({
      id: true,
      service: true,
      credentialType: true,
      createdAt: true,
      expiresAt: true,
    });
  });

  it('sweeps the small sections too — feedback past the page boundary is not clipped', async () => {
    const pageOne = Array.from({ length: 1000 }, (_, i) => ({ id: `fb-${i}` }));
    prisma.userFeedback.findMany
      ?.mockResolvedValueOnce(pageOne)
      .mockResolvedValueOnce([{ id: 'fb-1000' }]);

    const payload = await assembleAccountExport(prisma as unknown as PrismaClient, 'user-1');

    expect(payload.feedback).toHaveLength(1001);
  });

  it('cursor-sweeps big tables past the page boundary without clipping', async () => {
    // Personas drive the sweep filters; one persona is enough.
    prisma.persona.findMany?.mockResolvedValue([{ id: 'persona-1' }]);
    const pageOne = Array.from({ length: 1000 }, (_, i) => ({ id: `row-${i}` }));
    const pageTwo = [{ id: 'row-1000' }];
    prisma.conversationHistory.findMany
      ?.mockResolvedValueOnce(pageOne)
      .mockResolvedValueOnce(pageTwo);

    const payload = await assembleAccountExport(prisma as unknown as PrismaClient, 'user-1');

    expect(payload.conversationHistory).toHaveLength(1001);
    const secondCall = prisma.conversationHistory.findMany?.mock.calls[1][0];
    expect(secondCall.cursor).toEqual({ id: 'row-999' });
    expect(secondCall.skip).toBe(1);
  });
});
