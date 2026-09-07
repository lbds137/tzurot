import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { AIProvider } from '@tzurot/common-types/constants/ai';
import type { SystemModelResult } from '../systemModel/systemModelCall.js';
import { writeArchiveSummaryUsageLog } from './archiveSummaryUsageLog.js';

const PERSONALITY_ID = '4f9b0f66-7777-4000-8000-00000000000a';
const OWNER_ID = '4f9b0f66-7777-4000-8000-00000000000c';

const USAGE: SystemModelResult = {
  content: '{}',
  tokensIn: 10,
  tokensOut: 5,
  provider: AIProvider.ZaiCoding,
  model: 'z-ai/glm-5.2',
};

function makePrisma(): PrismaClient {
  return {
    usageLog: {
      create: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as PrismaClient;
}

describe('writeArchiveSummaryUsageLog', () => {
  it('writes a usage_logs row attributed to the persona owner', async () => {
    const prisma = makePrisma();

    await writeArchiveSummaryUsageLog(
      prisma,
      USAGE,
      { personalityId: PERSONALITY_ID, ownerId: OWNER_ID },
      123
    );

    expect(prisma.usageLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: OWNER_ID,
          provider: AIProvider.ZaiCoding,
          model: 'z-ai/glm-5.2',
          tokensIn: 10,
          tokensOut: 5,
          requestType: 'archive_summary',
          personalityId: PERSONALITY_ID,
          latencyMs: 123,
        }),
      })
    );
  });

  it('skips the write when the row carries no owner (no persona joined)', async () => {
    const prisma = makePrisma();

    await writeArchiveSummaryUsageLog(
      prisma,
      USAGE,
      { personalityId: PERSONALITY_ID, ownerId: null },
      50
    );

    expect(prisma.usageLog.create).not.toHaveBeenCalled();
  });

  it('swallows a write failure (fail-soft)', async () => {
    const prisma = makePrisma();
    (prisma.usageLog.create as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('db down'));

    await expect(
      writeArchiveSummaryUsageLog(
        prisma,
        USAGE,
        { personalityId: PERSONALITY_ID, ownerId: OWNER_ID },
        50
      )
    ).resolves.toBeUndefined();
  });
});
