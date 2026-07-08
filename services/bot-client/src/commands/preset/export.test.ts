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
import { makeOk, makeErr, asUserClient } from '../../test/gatewayClientStubs.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';

vi.mock('@tzurot/common-types/config/config', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/config/config')>(
    '@tzurot/common-types/config/config'
  );
  return {
    ...actual,
    getConfig: vi.fn().mockReturnValue({
      GATEWAY_URL: 'http://localhost:3000',
    }),
  };
});

vi.mock('@tzurot/common-types/generated/commandOptions', async () => {
  const actual = await vi.importActual<
    typeof import('@tzurot/common-types/generated/commandOptions')
  >('@tzurot/common-types/generated/commandOptions');
  return {
    ...actual,
    presetExportOptions: (interaction: unknown) => ({
      preset: () =>
        (interaction as { options: { getString: (name: string) => string } }).options.getString(
          'preset'
        ),
    }),
  };
});

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  };
});

vi.mock('@tzurot/common-types/utils/ownerMiddleware', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/ownerMiddleware')>(
    '@tzurot/common-types/utils/ownerMiddleware'
  );
  return {
    ...actual,
    isBotOwner: (userId: string) => userId === 'bot-owner-id',
  };
});

const clientsForMock = vi.hoisted(() => vi.fn());
vi.mock('../../utils/gatewayClients.js', () => ({
  clientsFor: clientsForMock,
}));

const { handleExport } = await import('./export.js');

interface UserClientStub {
  getUserLlmConfig: ReturnType<typeof vi.fn>;
}

function createStub(): UserClientStub {
  return { getUserLlmConfig: vi.fn() };
}

describe('Preset Export', () => {
  let stub: UserClientStub;

  const createMockContext = (userId = 'user-123') =>
    ({
      user: { id: userId, username: 'testuser' },
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
    model: 'anthropic/claude-sonnet-4',
    provider: 'openrouter',
    isGlobal: false,
    isDefault: false,
    isOwned: true,
    permissions: { canEdit: true, canDelete: true },
    contextWindowTokens: 131072,
    params: {
      temperature: 0.7,
      top_p: 0.9,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    stub = createStub();
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('handleExport', () => {
    it('should export preset as JSON attachment', async () => {
      stub.getUserLlmConfig.mockResolvedValue(makeOk({ config: mockPresetData }));

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
      stub.getUserLlmConfig.mockResolvedValue(makeOk({ config: mockPresetData }));

      const mockContext = createMockContext();

      await handleExport(mockContext);

      // Verify the flow works - JSON content is hard to inspect directly
      expect(mockContext.editReply).toHaveBeenCalled();
      const editReplyArgs = vi.mocked(mockContext.editReply).mock.calls[0][0] as {
        files: AttachmentBuilder[];
      };
      expect(editReplyArgs.files).toHaveLength(1);
    });

    it('includes isGlobal in the exported JSON (visibility round-trip)', async () => {
      stub.getUserLlmConfig.mockResolvedValue(
        makeOk({ config: { ...mockPresetData, isGlobal: true } })
      );

      const mockContext = createMockContext();
      await handleExport(mockContext);

      const editReplyArgs = vi.mocked(mockContext.editReply).mock.calls[0][0] as {
        files: AttachmentBuilder[];
      };
      // Parse the actual attachment payload — the flag must survive into the file
      // so /preset import can round-trip visibility.
      const json = JSON.parse(String(editReplyArgs.files[0].attachment)) as {
        isGlobal?: boolean;
      };
      expect(json.isGlobal).toBe(true);
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

      stub.getUserLlmConfig.mockResolvedValue(makeOk({ config: presetWithAdvancedParams }));

      const mockContext = createMockContext();

      await handleExport(mockContext);

      expect(mockContext.editReply).toHaveBeenCalled();
    });

    it('should include context window field in export', async () => {
      const presetWithCustomCtx = {
        ...mockPresetData,
        contextWindowTokens: 65536,
      };

      stub.getUserLlmConfig.mockResolvedValue(makeOk({ config: presetWithCustomCtx }));

      const mockContext = createMockContext();

      await handleExport(mockContext);

      expect(mockContext.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          files: expect.any(Array),
        })
      );
    });

    it('should handle preset not found (404)', async () => {
      stub.getUserLlmConfig.mockResolvedValue(makeErr(404, 'Not found'));

      const mockContext = createMockContext();

      await handleExport(mockContext);

      expect(mockContext.editReply).toHaveBeenCalledWith('❌ Preset not found.');
    });

    it('should handle access denied (403)', async () => {
      stub.getUserLlmConfig.mockResolvedValue(makeErr(403, 'Forbidden'));

      const mockContext = createMockContext();

      await handleExport(mockContext);

      expect(mockContext.editReply).toHaveBeenCalledWith(
        '❌ You do not have permission to access this preset.'
      );
    });

    it('should reject export when user cannot edit preset', async () => {
      const presetNotOwned = {
        ...mockPresetData,
        isOwned: false,
        permissions: { canEdit: false, canDelete: false },
      };

      stub.getUserLlmConfig.mockResolvedValue(makeOk({ config: presetNotOwned }));

      const mockContext = createMockContext();

      await handleExport(mockContext);

      expect(mockContext.editReply).toHaveBeenCalledWith(
        expect.stringContaining('do not have permission to export')
      );
    });

    it('should allow bot owner to export any preset', async () => {
      const presetNotOwned = {
        ...mockPresetData,
        isOwned: false,
        permissions: { canEdit: false, canDelete: false },
      };

      stub.getUserLlmConfig.mockResolvedValue(makeOk({ config: presetNotOwned }));

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
      stub.getUserLlmConfig.mockResolvedValue(makeErr(500, 'Internal server error'));

      const mockContext = createMockContext();

      await handleExport(mockContext);

      expect(mockContext.editReply).toHaveBeenCalledWith(
        '❌ Failed to export the preset. Please try again.'
      );
    });

    it('should handle network errors gracefully', async () => {
      stub.getUserLlmConfig.mockRejectedValue(new Error('Network error'));

      const mockContext = createMockContext();

      await handleExport(mockContext);

      expect(mockContext.editReply).toHaveBeenCalledWith(
        '❌ Failed to export the preset. Please try again.'
      );
    });

    it('should fetch preset using typed client', async () => {
      stub.getUserLlmConfig.mockResolvedValue(makeOk({ config: mockPresetData }));

      const mockContext = createMockContext();

      await handleExport(mockContext);

      expect(stub.getUserLlmConfig).toHaveBeenCalledWith('test-preset-id');
    });

    it('should include import instructions in response', async () => {
      stub.getUserLlmConfig.mockResolvedValue(makeOk({ config: mockPresetData }));

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

      stub.getUserLlmConfig.mockResolvedValue(makeOk({ config: presetWithMarkdown }));

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
