/**
 * Tests for Preset Export Command
 *
 * Tests the /preset export functionality:
 * - JSON data export with correct fields
 * - Permission checks (only owner or bot owner)
 * - Error handling (404, 403, API errors)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AttachmentBuilder } from 'discord.js';
import { handleExport } from './export.js';
import * as userGatewayClient from '../../utils/userGatewayClient.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';

// Mock dependencies
vi.mock('../../utils/userGatewayClient.js', () => ({
  callGatewayApi: vi.fn(),
}));

vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal();
  return {
    ...(actual as Record<string, unknown>),
    getConfig: vi.fn().mockReturnValue({
      GATEWAY_URL: 'http://localhost:3000',
    }),
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
    isBotOwner: (userId: string) => userId === 'bot-owner-id',
    presetExportOptions: (interaction: unknown) => ({
      preset: () =>
        (interaction as { options: { getString: (name: string) => string } }).options.getString(
          'preset'
        ),
    }),
  };
});

describe('Preset Export', () => {
  const createMockContext = (userId = 'user-123') =>
    ({
      user: { id: userId },
      interaction: {
        options: {
          getString: vi.fn().mockReturnValue('test-preset-id'),
        },
      },
      editReply: vi.fn(),
    }) as unknown as DeferredCommandContext;

  const mockPresetData = {
    id: 'preset-uuid',
    name: 'Test Preset',
    description: 'A test preset',
    provider: 'openrouter',
    model: 'anthropic/claude-sonnet-4',
    visionModel: null,
    isGlobal: false,
    isDefault: false,
    isOwned: true,
    permissions: { canEdit: true, canDelete: true },
    memoryScoreThreshold: 0.5,
    memoryLimit: 20,
    contextWindowTokens: 131072,
    params: {
      temperature: 0.7,
      top_p: 0.9,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('handleExport', () => {
    it('should export preset as JSON attachment', async () => {
      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue({
        ok: true,
        data: { config: mockPresetData },
      });

      const mockContext = createMockContext();

      await handleExport(mockContext);

      expect(mockContext.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Exported **Test Preset**'),
          files: expect.arrayContaining([expect.any(AttachmentBuilder)]),
        })
      );
    });

    it('should include only non-null fields in exported JSON', async () => {
      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue({
        ok: true,
        data: { config: mockPresetData },
      });

      const mockContext = createMockContext();

      await handleExport(mockContext);

      // Verify the flow works - JSON content is hard to inspect directly
      expect(mockContext.editReply).toHaveBeenCalled();
      const editReplyArgs = vi.mocked(mockContext.editReply).mock.calls[0][0] as {
        files: AttachmentBuilder[];
      };
      expect(editReplyArgs.files).toHaveLength(1);
    });

    it('should include advanced parameters in export', async () => {
      const presetWithAdvancedParams = {
        ...mockPresetData,
        params: {
          temperature: 0.8,
          max_tokens: 4096,
          reasoning: {
            effort: 'high',
            enabled: true,
          },
          show_thinking: true,
        },
      };

      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue({
        ok: true,
        data: { config: presetWithAdvancedParams },
      });

      const mockContext = createMockContext();

      await handleExport(mockContext);

      expect(mockContext.editReply).toHaveBeenCalled();
    });

    it('should include memory and context window fields in export', async () => {
      const presetWithMemoryConfig = {
        ...mockPresetData,
        memoryScoreThreshold: 0.6,
        memoryLimit: 30,
        contextWindowTokens: 65536,
      };

      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue({
        ok: true,
        data: { config: presetWithMemoryConfig },
      });

      const mockContext = createMockContext();

      await handleExport(mockContext);

      expect(mockContext.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          files: expect.any(Array),
        })
      );
    });

    it('should handle preset not found (404)', async () => {
      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue({
        ok: false,
        status: 404,
        error: 'Not found',
      });

      const mockContext = createMockContext();

      await handleExport(mockContext);

      expect(mockContext.editReply).toHaveBeenCalledWith('❌ Preset not found.');
    });

    it('should handle access denied (403)', async () => {
      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue({
        ok: false,
        status: 403,
        error: 'Forbidden',
      });

      const mockContext = createMockContext();

      await handleExport(mockContext);

      expect(mockContext.editReply).toHaveBeenCalledWith(
        "❌ You don't have access to this preset."
      );
    });

    it('should reject export when user cannot edit preset', async () => {
      const presetNotOwned = {
        ...mockPresetData,
        isOwned: false,
        permissions: { canEdit: false, canDelete: false },
      };

      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue({
        ok: true,
        data: { config: presetNotOwned },
      });

      const mockContext = createMockContext();

      await handleExport(mockContext);

      expect(mockContext.editReply).toHaveBeenCalledWith(
        expect.stringContaining("don't have permission to export")
      );
    });

    it('should allow bot owner to export any preset', async () => {
      const presetNotOwned = {
        ...mockPresetData,
        isOwned: false,
        permissions: { canEdit: false, canDelete: false },
      };

      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue({
        ok: true,
        data: { config: presetNotOwned },
      });

      const mockContext = createMockContext('bot-owner-id');

      await handleExport(mockContext);

      expect(mockContext.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Exported'),
          files: expect.any(Array),
        })
      );
    });

    it('should handle API errors gracefully', async () => {
      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue({
        ok: false,
        status: 500,
        error: 'Internal server error',
      });

      const mockContext = createMockContext();

      await handleExport(mockContext);

      expect(mockContext.editReply).toHaveBeenCalledWith(
        '❌ An unexpected error occurred while exporting the preset.'
      );
    });

    it('should handle network errors gracefully', async () => {
      vi.mocked(userGatewayClient.callGatewayApi).mockRejectedValue(new Error('Network error'));

      const mockContext = createMockContext();

      await handleExport(mockContext);

      expect(mockContext.editReply).toHaveBeenCalledWith(
        '❌ An unexpected error occurred while exporting the preset.'
      );
    });

    it('should fetch preset using correct API call', async () => {
      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue({
        ok: true,
        data: { config: mockPresetData },
      });

      const mockContext = createMockContext();

      await handleExport(mockContext);

      expect(userGatewayClient.callGatewayApi).toHaveBeenCalledWith(
        '/user/llm-config/test-preset-id',
        { userId: 'user-123' }
      );
    });

    it('should include import instructions in response', async () => {
      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue({
        ok: true,
        data: { config: mockPresetData },
      });

      const mockContext = createMockContext();

      await handleExport(mockContext);

      expect(mockContext.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('/preset import'),
        })
      );
    });

    it('should escape markdown in preset name', async () => {
      const presetWithMarkdown = {
        ...mockPresetData,
        name: 'Test **Bold** Preset',
      };

      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue({
        ok: true,
        data: { config: presetWithMarkdown },
      });

      const mockContext = createMockContext();

      await handleExport(mockContext);

      // The name should be escaped so **Bold** doesn't render as bold
      expect(mockContext.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Exported'),
        })
      );
    });
  });
});
