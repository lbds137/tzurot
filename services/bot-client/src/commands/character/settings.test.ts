/**
 * Tests for Character Settings Subcommand
 *
 * @see docs/standards/TRI_STATE_PATTERN.md
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EmbedBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { handleSettings } from './settings.js';

// Mock dependencies
vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

const mockCallGatewayApi = vi.fn();
vi.mock('../../utils/userGatewayClient.js', () => ({
  callGatewayApi: (...args: unknown[]) => mockCallGatewayApi(...args),
}));

// Use vi.hoisted to ensure mock functions are available before vi.mock hoisting
const { mockGetExtendedContextDefault, mockGetAdminSettings } = vi.hoisted(() => ({
  mockGetExtendedContextDefault: vi.fn(),
  mockGetAdminSettings: vi.fn(),
}));

vi.mock('../../utils/GatewayClient.js', () => ({
  GatewayClient: class MockGatewayClient {
    getExtendedContextDefault = mockGetExtendedContextDefault;
    getAdminSettings = mockGetAdminSettings;
  },
}));

describe('Character Settings Subcommand', () => {
  const mockConfig = {} as never;

  const createMockInteraction = (
    action: string,
    character: string,
    options: { value?: number | null; duration?: string | null } = {}
  ): ChatInputCommandInteraction & {
    reply: ReturnType<typeof vi.fn>;
    editReply: ReturnType<typeof vi.fn>;
    deferred: boolean;
    replied: boolean;
  } => {
    return {
      options: {
        getString: vi.fn((name: string) => {
          if (name === 'action') return action;
          if (name === 'character') return character;
          if (name === 'duration') return options.duration ?? null;
          return null;
        }),
        getInteger: vi.fn((name: string) => {
          if (name === 'value') return options.value ?? null;
          return null;
        }),
      },
      user: { id: 'user-456' },
      reply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
      // Top-level interactionCreate handler already defers
      deferred: true,
      replied: false,
    } as unknown as ChatInputCommandInteraction & {
      reply: ReturnType<typeof vi.fn>;
      editReply: ReturnType<typeof vi.fn>;
      deferred: boolean;
      replied: boolean;
    };
  };

  const createMockAdminSettings = (overrides = {}) => ({
    extendedContextDefault: true,
    extendedContextMaxMessages: 20,
    extendedContextMaxAge: 7200,
    extendedContextMaxImages: 5,
    ...overrides,
  });

  const createMockPersonality = (overrides = {}) => ({
    id: 'personality-123',
    name: 'Test Character',
    slug: 'test-char',
    extendedContext: null,
    extendedContextMaxMessages: null,
    extendedContextMaxAge: null,
    extendedContextMaxImages: null,
    ownerId: 'user-456',
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAdminSettings.mockResolvedValue(createMockAdminSettings());
  });

  describe('enable action (force ON)', () => {
    it('should enable extended context successfully', async () => {
      const interaction = createMockInteraction('enable', 'test-char');
      mockCallGatewayApi.mockResolvedValue({ ok: true, data: {} });

      await handleSettings(interaction, mockConfig);

      expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/personality/test-char', {
        method: 'PUT',
        body: { extendedContext: true },
        userId: 'user-456',
      });
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('set to On'),
      });
    });

    it('should handle 401 unauthorized error', async () => {
      const interaction = createMockInteraction('enable', 'test-char');
      mockCallGatewayApi.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' });

      await handleSettings(interaction, mockConfig);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: 'You do not have permission to edit this character.',
      });
    });

    it('should handle 404 not found error', async () => {
      const interaction = createMockInteraction('enable', 'nonexistent');
      mockCallGatewayApi.mockResolvedValue({ ok: false, status: 404, error: 'Not found' });

      await handleSettings(interaction, mockConfig);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: 'Character "nonexistent" not found.',
      });
    });

    it('should handle other API errors', async () => {
      const interaction = createMockInteraction('enable', 'test-char');
      mockCallGatewayApi.mockResolvedValue({ ok: false, status: 500, error: 'Server error' });

      await handleSettings(interaction, mockConfig);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: 'Failed to update setting: Server error',
      });
    });
  });

  describe('disable action (force OFF)', () => {
    it('should disable extended context successfully', async () => {
      const interaction = createMockInteraction('disable', 'test-char');
      mockCallGatewayApi.mockResolvedValue({ ok: true, data: {} });

      await handleSettings(interaction, mockConfig);

      expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/personality/test-char', {
        method: 'PUT',
        body: { extendedContext: false },
        userId: 'user-456',
      });
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('set to Off'),
      });
    });
  });

  describe('auto action (follow hierarchy)', () => {
    it('should set auto mode and show effective value', async () => {
      const interaction = createMockInteraction('auto', 'test-char');
      mockCallGatewayApi.mockResolvedValue({ ok: true, data: {} });
      mockGetExtendedContextDefault.mockResolvedValue(true);

      await handleSettings(interaction, mockConfig);

      expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/personality/test-char', {
        method: 'PUT',
        body: { extendedContext: null },
        userId: 'user-456',
      });
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringMatching(/set to Auto[\s\S]*Currently: \*\*enabled\*\*/),
      });
    });

    it('should show disabled when global default is false', async () => {
      const interaction = createMockInteraction('auto', 'test-char');
      mockCallGatewayApi.mockResolvedValue({ ok: true, data: {} });
      mockGetExtendedContextDefault.mockResolvedValue(false);

      await handleSettings(interaction, mockConfig);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringMatching(/set to Auto[\s\S]*Currently: \*\*disabled\*\*/),
      });
    });
  });

  describe('show action', () => {
    it('should show character settings with embed', async () => {
      const interaction = createMockInteraction('show', 'test-char');
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: { personality: createMockPersonality({ extendedContext: true }) },
      });

      await handleSettings(interaction, mockConfig);

      expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/personality/test-char', {
        method: 'GET',
        userId: 'user-456',
      });
      expect(mockGetAdminSettings).toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith({
        embeds: expect.arrayContaining([expect.any(EmbedBuilder)]),
      });
    });

    it('should handle missing admin settings', async () => {
      const interaction = createMockInteraction('show', 'test-char');
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: { personality: createMockPersonality() },
      });
      mockGetAdminSettings.mockResolvedValue(null);

      await handleSettings(interaction, mockConfig);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Failed to fetch global settings'),
      });
    });

    it('should handle 404 not found error', async () => {
      const interaction = createMockInteraction('show', 'nonexistent');
      mockCallGatewayApi.mockResolvedValue({ ok: false, status: 404, error: 'Not found' });

      await handleSettings(interaction, mockConfig);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: 'Character "nonexistent" not found.',
      });
    });

    it('should handle other API errors', async () => {
      const interaction = createMockInteraction('show', 'test-char');
      mockCallGatewayApi.mockResolvedValue({ ok: false, status: 500, error: 'Server error' });

      await handleSettings(interaction, mockConfig);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: 'Failed to get character: Server error',
      });
    });
  });

  describe('set-max-messages action', () => {
    it('should show current value when no value provided', async () => {
      const interaction = createMockInteraction('set-max-messages', 'test-char', { value: null });
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: { personality: createMockPersonality({ extendedContextMaxMessages: 50 }) },
      });

      await handleSettings(interaction, mockConfig);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Max Messages'),
      });
    });

    it('should update max messages with valid value', async () => {
      const interaction = createMockInteraction('set-max-messages', 'test-char', { value: 50 });
      mockCallGatewayApi.mockResolvedValue({ ok: true, data: {} });

      await handleSettings(interaction, mockConfig);

      expect(mockCallGatewayApi).toHaveBeenCalledWith(
        '/user/personality/test-char',
        expect.objectContaining({
          method: 'PUT',
          body: { extendedContextMaxMessages: 50 },
        })
      );
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Max messages set to 50'),
      });
    });

    it('should set to auto when value is 0', async () => {
      const interaction = createMockInteraction('set-max-messages', 'test-char', { value: 0 });
      mockCallGatewayApi.mockResolvedValue({ ok: true, data: {} });

      await handleSettings(interaction, mockConfig);

      expect(mockCallGatewayApi).toHaveBeenCalledWith(
        '/user/personality/test-char',
        expect.objectContaining({
          body: { extendedContextMaxMessages: null },
        })
      );
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Auto'),
      });
    });
  });

  describe('set-max-age action', () => {
    it('should show current value when no duration provided', async () => {
      const interaction = createMockInteraction('set-max-age', 'test-char', { duration: null });
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: { personality: createMockPersonality({ extendedContextMaxAge: 7200 }) },
      });

      await handleSettings(interaction, mockConfig);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Max Age'),
      });
    });

    it('should update max age with valid duration', async () => {
      const interaction = createMockInteraction('set-max-age', 'test-char', { duration: '2h' });
      mockCallGatewayApi.mockResolvedValue({ ok: true, data: {} });

      await handleSettings(interaction, mockConfig);

      expect(mockCallGatewayApi).toHaveBeenCalledWith(
        '/user/personality/test-char',
        expect.objectContaining({
          method: 'PUT',
          body: { extendedContextMaxAge: 7200 },
        })
      );
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Max age set to'),
      });
    });

    it('should set to auto when duration is "auto"', async () => {
      const interaction = createMockInteraction('set-max-age', 'test-char', { duration: 'auto' });
      mockCallGatewayApi.mockResolvedValue({ ok: true, data: {} });

      await handleSettings(interaction, mockConfig);

      expect(mockCallGatewayApi).toHaveBeenCalledWith(
        '/user/personality/test-char',
        expect.objectContaining({
          body: { extendedContextMaxAge: null },
        })
      );
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Auto'),
      });
    });

    it('should reject invalid duration format', async () => {
      const interaction = createMockInteraction('set-max-age', 'test-char', {
        duration: 'invalid',
      });

      await handleSettings(interaction, mockConfig);

      expect(mockCallGatewayApi).not.toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Invalid duration'),
      });
    });
  });

  describe('set-max-images action', () => {
    it('should show current value when no value provided', async () => {
      const interaction = createMockInteraction('set-max-images', 'test-char', { value: null });
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: { personality: createMockPersonality({ extendedContextMaxImages: 10 }) },
      });

      await handleSettings(interaction, mockConfig);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Max Images'),
      });
    });

    it('should update max images with valid value', async () => {
      const interaction = createMockInteraction('set-max-images', 'test-char', { value: 10 });
      mockCallGatewayApi.mockResolvedValue({ ok: true, data: {} });

      await handleSettings(interaction, mockConfig);

      expect(mockCallGatewayApi).toHaveBeenCalledWith(
        '/user/personality/test-char',
        expect.objectContaining({
          method: 'PUT',
          body: { extendedContextMaxImages: 10 },
        })
      );
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Max images set to 10'),
      });
    });

    it('should reject invalid max images value', async () => {
      const interaction = createMockInteraction('set-max-images', 'test-char', { value: 25 });

      await handleSettings(interaction, mockConfig);

      expect(mockCallGatewayApi).not.toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('between 0 and 20'),
      });
    });
  });

  describe('unknown action', () => {
    it('should reply with unknown action message', async () => {
      const interaction = createMockInteraction('invalid-action', 'test-char');

      await handleSettings(interaction, mockConfig);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: 'Unknown action: invalid-action',
      });
    });
  });

  describe('error handling', () => {
    it('should handle unexpected errors with editReply', async () => {
      const interaction = createMockInteraction('enable', 'test-char');
      mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

      await handleSettings(interaction, mockConfig);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: 'An error occurred while processing your request.',
      });
    });

    it('should not respond again if already replied', async () => {
      const interaction = createMockInteraction('enable', 'test-char');
      Object.defineProperty(interaction, 'replied', {
        get: () => true,
        configurable: true,
      });
      mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

      await handleSettings(interaction, mockConfig);

      expect(interaction.editReply).not.toHaveBeenCalled();
    });
  });
});
