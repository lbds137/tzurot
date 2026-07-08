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
import * as jsonFileUtils from '../../utils/jsonFileUtils.js';
import { makeOk, makeErr, asUserClient } from '../../test/gatewayClientStubs.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import type { Attachment } from 'discord.js';

vi.mock('../../utils/jsonFileUtils.js', () => ({
  validateAndParseJsonFile: vi.fn(),
}));

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

vi.mock('@tzurot/common-types/constants/discord', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/constants/discord')>(
    '@tzurot/common-types/constants/discord'
  );
  return {
    ...actual,
    DISCORD_COLORS: {
      SUCCESS: 0x00ff00,
    },
  };
});

vi.mock('@tzurot/common-types/generated/commandOptions', async () => {
  const actual = await vi.importActual<
    typeof import('@tzurot/common-types/generated/commandOptions')
  >('@tzurot/common-types/generated/commandOptions');
  return {
    ...actual,
    presetImportOptions: (interaction: unknown) => ({
      file: () =>
        (
          interaction as { options: { getAttachment: (name: string) => Attachment } }
        ).options.getAttachment('file'),
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

const clientsForMock = vi.hoisted(() => vi.fn());
vi.mock('../../utils/gatewayClients.js', () => ({
  clientsFor: clientsForMock,
}));

const { handleImport, REQUIRED_IMPORT_FIELDS, PRESET_JSON_TEMPLATE } = await import('./import.js');

interface UserClientStub {
  createUserLlmConfig: ReturnType<typeof vi.fn>;
  updateUserLlmConfig: ReturnType<typeof vi.fn>;
}

function createStub(): UserClientStub {
  return { createUserLlmConfig: vi.fn(), updateUserLlmConfig: vi.fn() };
}

describe('Preset Import', () => {
  let stub: UserClientStub;

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
    provider: 'openrouter',
    description: 'A test preset',
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    stub = createStub();
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });
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
      stub.createUserLlmConfig.mockResolvedValue(makeOk({ config: { id: 'new-preset-id' } }));

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

    it('applies isGlobal:true post-create via the update seam and reports Global', async () => {
      vi.mocked(jsonFileUtils.validateAndParseJsonFile).mockResolvedValue({
        data: createValidPresetData({ isGlobal: true }),
      });
      stub.createUserLlmConfig.mockResolvedValue(makeOk({ config: { id: 'new-preset-id' } }));
      stub.updateUserLlmConfig.mockResolvedValue(
        makeOk({ config: { id: 'new-preset-id', name: 'Test Preset', isGlobal: true, params: {} } })
      );

      const mockContext = createMockContext();
      await handleImport(mockContext);

      // The seam assertion: the flag must actually cross into the update call —
      // create alone always lands private, so this call IS the round-trip.
      expect(stub.updateUserLlmConfig).toHaveBeenCalledWith('new-preset-id', { isGlobal: true });
      const embeds = vi.mocked(mockContext.editReply).mock.calls[0][0] as {
        embeds: { data: { fields?: { name: string; value: string }[] } }[];
      };
      const visibility = embeds.embeds[0].data.fields?.find(f => f.name === 'Visibility');
      expect(visibility?.value).toContain('Global');
    });

    it('keeps the import successful (private + warning) when applying isGlobal fails', async () => {
      vi.mocked(jsonFileUtils.validateAndParseJsonFile).mockResolvedValue({
        data: createValidPresetData({ isGlobal: true }),
      });
      stub.createUserLlmConfig.mockResolvedValue(makeOk({ config: { id: 'new-preset-id' } }));
      stub.updateUserLlmConfig.mockResolvedValue(makeErr(403, 'Forbidden'));

      const mockContext = createMockContext();
      await handleImport(mockContext);

      // Import must still succeed — the preset exists, just private.
      const embeds = vi.mocked(mockContext.editReply).mock.calls[0][0] as {
        embeds: { data: { title?: string; fields?: { name: string; value: string }[] } }[];
      };
      expect(embeds.embeds[0].data.title).toBe('Preset Imported Successfully');
      const visibility = embeds.embeds[0].data.fields?.find(f => f.name === 'Visibility');
      expect(visibility?.value).toContain('private');
    });

    it('does NOT touch the update seam when the file has no isGlobal', async () => {
      vi.mocked(jsonFileUtils.validateAndParseJsonFile).mockResolvedValue({
        data: createValidPresetData(),
      });
      stub.createUserLlmConfig.mockResolvedValue(makeOk({ config: { id: 'new-preset-id' } }));

      await handleImport(createMockContext());

      expect(stub.updateUserLlmConfig).not.toHaveBeenCalled();
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
        }),
      });
      stub.createUserLlmConfig.mockResolvedValue(makeOk({ config: { id: 'new-preset-id' } }));

      const mockContext = createMockContext();

      await handleImport(mockContext);

      expect(stub.createUserLlmConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'A description',
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
      stub.createUserLlmConfig.mockResolvedValue(makeOk({ config: { id: 'new-preset-id' } }));

      const mockContext = createMockContext();

      await handleImport(mockContext);

      // Should make single API call with all fields including advancedParameters
      expect(stub.createUserLlmConfig).toHaveBeenCalledTimes(1);
      expect(stub.createUserLlmConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          advancedParameters: expect.objectContaining({
            temperature: 0.8,
            max_tokens: 4096,
            reasoning: expect.objectContaining({
              effort: 'high',
              enabled: true,
            }),
          }),
        })
      );
    });

    it('should handle API create failure', async () => {
      vi.mocked(jsonFileUtils.validateAndParseJsonFile).mockResolvedValue({
        data: createValidPresetData(),
      });
      stub.createUserLlmConfig.mockResolvedValue(makeErr(400, 'Duplicate name'));

      const mockContext = createMockContext();

      await handleImport(mockContext);

      // Pin the SURFACED gateway message — a loose 'Failed to import' match
      // also matched the generic fallback and hid a kind-dropping regression.
      expect(mockContext.editReply).toHaveBeenCalledWith(expect.stringContaining('Duplicate name'));
    });

    it('should import preset with context window field', async () => {
      vi.mocked(jsonFileUtils.validateAndParseJsonFile).mockResolvedValue({
        data: createValidPresetData({
          contextWindowTokens: 65536,
        }),
      });
      stub.createUserLlmConfig.mockResolvedValue(makeOk({ config: { id: 'new-preset-id' } }));

      const mockContext = createMockContext();

      await handleImport(mockContext);

      expect(stub.createUserLlmConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          contextWindowTokens: 65536,
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
        expect.stringContaining('Failed to import the preset')
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
