import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EmbedBuilder } from 'discord.js';
import * as adminApiClient from '../../../utils/adminApiClient.js';
import { handleGlobalPresetUpdate, type GlobalPresetUpdateConfig } from './globalPresetHelpers.js';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';

vi.mock('../../../utils/adminApiClient.js', () => ({
  adminPutJson: vi.fn(),
}));

vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal();
  return {
    ...(actual as Record<string, unknown>),
    createLogger: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

const testConfig: GlobalPresetUpdateConfig = {
  apiPath: '/admin/llm-config/config-1/set-default',
  embedTitle: 'Default Set',
  embedDescription: (name: string) => `Set **${name}** as default`,
  logMessage: 'Set default',
  errorLogMessage: 'Failed to set default',
};

describe('globalPresetHelpers', () => {
  const mockEditReply = vi.fn();

  function createMockContext(): DeferredCommandContext {
    return {
      editReply: mockEditReply,
      user: { id: 'user-123' },
    } as unknown as DeferredCommandContext;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleGlobalPresetUpdate', () => {
    it('should show success embed on successful API call', async () => {
      vi.mocked(adminApiClient.adminPutJson).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ configName: 'Claude Sonnet' }),
      } as unknown as Response);

      await handleGlobalPresetUpdate(createMockContext(), 'config-1', testConfig);

      expect(adminApiClient.adminPutJson).toHaveBeenCalledWith(testConfig.apiPath, {});
      expect(mockEditReply).toHaveBeenCalledWith({
        embeds: expect.arrayContaining([expect.any(EmbedBuilder)]),
      });
    });

    it('should show error message on API failure', async () => {
      vi.mocked(adminApiClient.adminPutJson).mockResolvedValue({
        ok: false,
        status: 500,
        json: vi.fn().mockResolvedValue({ error: 'Server error' }),
      } as unknown as Response);

      await handleGlobalPresetUpdate(createMockContext(), 'config-1', testConfig);

      expect(mockEditReply).toHaveBeenCalledWith({ content: '❌ Server error' });
    });

    it('should show HTTP status when no error message returned', async () => {
      vi.mocked(adminApiClient.adminPutJson).mockResolvedValue({
        ok: false,
        status: 404,
        json: vi.fn().mockResolvedValue({}),
      } as unknown as Response);

      await handleGlobalPresetUpdate(createMockContext(), 'config-1', testConfig);

      expect(mockEditReply).toHaveBeenCalledWith({ content: '❌ HTTP 404' });
    });

    it('should show generic error on exception', async () => {
      vi.mocked(adminApiClient.adminPutJson).mockRejectedValue(new Error('Network error'));

      await handleGlobalPresetUpdate(createMockContext(), 'config-1', testConfig);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: '❌ An error occurred. Please try again later.',
      });
    });
  });
});
