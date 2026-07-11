import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import type { DiagnosticCollector } from '../../../../services/DiagnosticCollector.js';
import { storeDiagnosticLog } from './diagnosticStorage.js';

vi.mock('@tzurot/common-types/utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

function collectorWith(payload: object): DiagnosticCollector {
  return { finalize: vi.fn().mockReturnValue(payload) } as unknown as DiagnosticCollector;
}

const PAYLOAD = {
  meta: {
    requestId: 'req-1',
    triggerMessageId: 'msg-1',
    personalityId: 'pers-1',
    userId: 'user-1',
    guildId: 'guild-1',
    channelId: 'chan-1',
  },
  timing: { totalDurationMs: 1234 },
};

describe('storeDiagnosticLog', () => {
  it('writes the finalized payload with meta fields as columns (fire-and-forget)', async () => {
    const create = vi.fn().mockResolvedValue({});
    const prisma = { llmDiagnosticLog: { create } } as unknown as PrismaClient;

    storeDiagnosticLog(prisma, collectorWith(PAYLOAD), 'glm-4.5-air', 'zai-coding');
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        requestId: 'req-1',
        personalityId: 'pers-1',
        model: 'glm-4.5-air',
        provider: 'zai-coding',
        durationMs: 1234,
      }),
    });
  });

  it('swallows a DB failure without throwing (the response must not be blocked)', async () => {
    const create = vi.fn().mockRejectedValue(new Error('db down'));
    const prisma = { llmDiagnosticLog: { create } } as unknown as PrismaClient;

    expect(() =>
      storeDiagnosticLog(prisma, collectorWith(PAYLOAD), 'model', 'openrouter')
    ).not.toThrow();
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  });
});
