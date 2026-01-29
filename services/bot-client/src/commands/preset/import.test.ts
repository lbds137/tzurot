/**
 * Tests for Preset Import Command
 *
 * Tests the /preset import functionality:
 * - JSON file validation
 * - Required field validation
 * - Preset creation via API
 * - Advanced parameter handling
 * - Error handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleImport, REQUIRED_IMPORT_FIELDS, PRESET_JSON_TEMPLATE } from './import.js';
import * as userGatewayClient from '../../utils/userGatewayClient.js';
import * as jsonFileUtils from '../../utils/jsonFileUtils.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import type { Attachment } from 'discord.js';

// Mock dependencies
vi.mock('../../utils/userGatewayClient.js', () => ({
  callGatewayApi: vi.fn(),
}));

vi.mock('../../utils/jsonFileUtils.js', () => ({
  validateAndParseJsonFile: vi.fn(),
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
    presetImportOptions: (interaction: unknown) => ({
      file: () =>
        (interaction as { options: { getAttachment: () => Attachment } }).options.getAttachment(
          'file'
        ),
    }),
    DISCORD_COLORS: {
      SUCCESS: 0x00ff00,
    },
  };
});

describe('Preset Import', () => {
  const createMockAttachment = (): Attachment =>
    ({
      contentType: 'application/json',
      name: 'preset.json',
      size: 1000,
      url: 'https://example.com/preset.json',
    }) as Attachment;

  const createMockContext = () =>
    ({
      user: { id: 'user-123', username: 'testuser' },
      interaction: {
        options: {
          getAttachment: vi.fn().mockReturnValue(createMockAttachment()),
        },
      },
      editReply: vi.fn(),
    }) as unknown as DeferredCommandContext;

  const createValidPresetData = (overrides = {}) => ({
    name: 'Test Preset',
    model: 'anthropic/claude-sonnet-4',
    description: 'A test preset',
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constants', () => {
    it('should have correct required fields', () => {
      expect(REQUIRED_IMPORT_FIELDS).toContain('name');
      expect(REQUIRED_IMPORT_FIELDS).toContain('model');
    });

    it('should have valid JSON template', () => {
      expect(() => JSON.parse(PRESET_JSON_TEMPLATE)).not.toThrow();
      const template = JSON.parse(PRESET_JSON_TEMPLATE);
      expect(template).toHaveProperty('name');
      expect(template).toHaveProperty('model');
    });
  });

  describe('handleImport', () => {
    it('should import valid preset successfully', async () => {
      vi.mocked(jsonFileUtils.validateAndParseJsonFile).mockResolvedValue({
        data: createValidPresetData(),
      });
      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue({
        ok: true,
        data: { id: 'new-preset-id' },
      });

      const mockContext = createMockContext();

      await handleImport(mockContext);

      expect(mockContext.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              data: expect.objectContaining({
                title: 'Preset Imported Successfully',
              }),
            }),
          ]),
        })
      );
    });

    it('should reject invalid JSON file', async () => {
      vi.mocked(jsonFileUtils.validateAndParseJsonFile).mockResolvedValue({
        error: '❌ File must be a JSON file (.json)',
      });

      const mockContext = createMockContext();

      await handleImport(mockContext);

      expect(mockContext.editReply).toHaveBeenCalledWith(
        expect.stringContaining('must be a JSON file')
      );
    });

    it('should reject preset missing required name field', async () => {
      vi.mocked(jsonFileUtils.validateAndParseJsonFile).mockResolvedValue({
        data: { model: 'anthropic/claude-sonnet-4' },
      });

      const mockContext = createMockContext();

      await handleImport(mockContext);

      expect(mockContext.editReply).toHaveBeenCalledWith(expect.stringContaining('name'));
    });

    it('should reject preset missing required model field', async () => {
      vi.mocked(jsonFileUtils.validateAndParseJsonFile).mockResolvedValue({
        data: { name: 'Test Preset' },
      });

      const mockContext = createMockContext();

      await handleImport(mockContext);

      expect(mockContext.editReply).toHaveBeenCalledWith(expect.stringContaining('model'));
    });

    it('should reject invalid model format (no provider prefix)', async () => {
      vi.mocked(jsonFileUtils.validateAndParseJsonFile).mockResolvedValue({
        data: { name: 'Test Preset', model: 'claude-sonnet-4' },
      });

      const mockContext = createMockContext();

      await handleImport(mockContext);

      expect(mockContext.editReply).toHaveBeenCalledWith(
        expect.stringContaining('provider/model-name')
      );
    });

    it('should import preset with optional fields', async () => {
      vi.mocked(jsonFileUtils.validateAndParseJsonFile).mockResolvedValue({
        data: createValidPresetData({
          description: 'A description',
          provider: 'anthropic',
          visionModel: 'anthropic/claude-sonnet-4',
          maxReferencedMessages: 20,
        }),
      });
      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue({
        ok: true,
        data: { id: 'new-preset-id' },
      });

      const mockContext = createMockContext();

      await handleImport(mockContext);

      expect(userGatewayClient.callGatewayApi).toHaveBeenCalledWith(
        '/user/llm-config',
        expect.objectContaining({
          body: expect.objectContaining({
            description: 'A description',
            visionModel: 'anthropic/claude-sonnet-4',
            maxReferencedMessages: 20,
          }),
        })
      );
    });

    it('should import preset with advanced parameters', async () => {
      vi.mocked(jsonFileUtils.validateAndParseJsonFile).mockResolvedValue({
        data: createValidPresetData({
          advancedParameters: {
            temperature: 0.8,
            max_tokens: 4096,
            reasoning: {
              effort: 'high',
              enabled: true,
            },
          },
        }),
      });
      vi.mocked(userGatewayClient.callGatewayApi)
        .mockResolvedValueOnce({
          ok: true,
          data: { id: 'new-preset-id' },
        })
        .mockResolvedValueOnce({
          ok: true,
          data: { id: 'new-preset-id' },
        });

      const mockContext = createMockContext();

      await handleImport(mockContext);

      // Should make two API calls: create then update with advanced params
      expect(userGatewayClient.callGatewayApi).toHaveBeenCalledTimes(2);
      expect(userGatewayClient.callGatewayApi).toHaveBeenCalledWith(
        '/user/llm-config/new-preset-id',
        expect.objectContaining({
          method: 'PUT',
          body: expect.objectContaining({
            advancedParameters: expect.objectContaining({
              temperature: 0.8,
            }),
          }),
        })
      );
    });

    it('should handle API create failure', async () => {
      vi.mocked(jsonFileUtils.validateAndParseJsonFile).mockResolvedValue({
        data: createValidPresetData(),
      });
      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue({
        ok: false,
        error: 'Duplicate name',
      });

      const mockContext = createMockContext();

      await handleImport(mockContext);

      expect(mockContext.editReply).toHaveBeenCalledWith(
        expect.stringContaining('Failed to import')
      );
    });

    it('should still succeed if advanced parameter update fails', async () => {
      vi.mocked(jsonFileUtils.validateAndParseJsonFile).mockResolvedValue({
        data: createValidPresetData({
          advancedParameters: { temperature: 0.8 },
        }),
      });
      vi.mocked(userGatewayClient.callGatewayApi)
        .mockResolvedValueOnce({
          ok: true,
          data: { id: 'new-preset-id' },
        })
        .mockResolvedValueOnce({
          ok: false,
          error: 'Update failed',
        });

      const mockContext = createMockContext();

      await handleImport(mockContext);

      // Should still show success (advanced params failure is logged but not fatal)
      expect(mockContext.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              data: expect.objectContaining({
                title: 'Preset Imported Successfully',
              }),
            }),
          ]),
        })
      );
    });

    it('should handle unexpected errors gracefully', async () => {
      vi.mocked(jsonFileUtils.validateAndParseJsonFile).mockRejectedValue(
        new Error('Unexpected error')
      );

      const mockContext = createMockContext();

      await handleImport(mockContext);

      expect(mockContext.editReply).toHaveBeenCalledWith(
        expect.stringContaining('unexpected error')
      );
    });

    it('should show template tip in error messages', async () => {
      vi.mocked(jsonFileUtils.validateAndParseJsonFile).mockResolvedValue({
        data: { name: 'Test' }, // Missing model
      });

      const mockContext = createMockContext();

      await handleImport(mockContext);

      expect(mockContext.editReply).toHaveBeenCalledWith(
        expect.stringContaining('/preset template')
      );
    });
  });
});
