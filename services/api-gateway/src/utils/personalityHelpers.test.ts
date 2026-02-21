import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupDefaultLlmConfig } from './personalityHelpers.js';

describe('setupDefaultLlmConfig', () => {
  const mockPrisma = {
    llmConfig: { findFirst: vi.fn() },
    personalityDefaultConfig: { create: vi.fn() },
  };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('creates personality default config when global default exists', async () => {
    mockPrisma.llmConfig.findFirst.mockResolvedValue({ id: 'config-1', name: 'Default Model' });

    await setupDefaultLlmConfig(mockPrisma as never, 'personality-1', 'test-slug');

    expect(mockPrisma.personalityDefaultConfig.create).toHaveBeenCalledWith({
      data: {
        personalityId: 'personality-1',
        llmConfigId: 'config-1',
      },
    });
  });

  it('skips config creation when no global default exists', async () => {
    mockPrisma.llmConfig.findFirst.mockResolvedValue(null);

    await setupDefaultLlmConfig(mockPrisma as never, 'personality-1');

    expect(mockPrisma.personalityDefaultConfig.create).not.toHaveBeenCalled();
  });

  it('does not throw when database error occurs', async () => {
    mockPrisma.llmConfig.findFirst.mockRejectedValue(new Error('DB connection failed'));

    await expect(
      setupDefaultLlmConfig(mockPrisma as never, 'personality-1')
    ).resolves.toBeUndefined();
  });
});
