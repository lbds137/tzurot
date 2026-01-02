/**
 * Tests for Admin Settings Subcommand
 *
 * Tests the new AdminSettings singleton API pattern.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
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

const mockAdminFetch = vi.fn();
const mockAdminPatchJson = vi.fn();
vi.mock('../../utils/adminApiClient.js', () => ({
  adminFetch: (...args: unknown[]) => mockAdminFetch(...args),
  adminPatchJson: (...args: unknown[]) => mockAdminPatchJson(...args),
}));

describe('Admin Settings Subcommand', () => {
  const mockSettings = {
    id: '550e8400-e29b-41d4-a716-446655440001',
    updatedBy: 'user-123',
    createdAt: '2025-01-15T00:00:00.000Z',
    updatedAt: '2025-01-15T00:00:00.000Z',
    extendedContextDefault: true,
    extendedContextMaxMessages: 50,
    extendedContextMaxAge: 7200, // 2 hours in seconds
    extendedContextMaxImages: 5,
  };

  const createMockInteraction = (
    action: string,
    options?: { value?: number | null; duration?: string | null }
  ): ChatInputCommandInteraction & {
    reply: ReturnType<typeof vi.fn>;
    editReply: ReturnType<typeof vi.fn>;
    deferred: boolean;
    replied: boolean;
  } => {
    const getStringMock = vi.fn((name: string) => {
      if (name === 'action') return action;
      if (name === 'duration') return options?.duration ?? null;
      return null;
    });

    const getIntegerMock = vi.fn((_name: string) => {
      return options?.value ?? null;
    });

    return {
      options: {
        getString: getStringMock,
        getInteger: getIntegerMock,
      },
      user: { id: 'user-456' },
      reply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
      deferred: true,
      replied: false,
    } as unknown as ChatInputCommandInteraction & {
      reply: ReturnType<typeof vi.fn>;
      editReply: ReturnType<typeof vi.fn>;
      deferred: boolean;
      replied: boolean;
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('show action', () => {
    it('should display settings dashboard embed', async () => {
      const interaction = createMockInteraction('show');
      mockAdminFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockSettings),
      });

      await handleSettings(interaction);

      expect(mockAdminFetch).toHaveBeenCalledWith('/admin/settings', {
        method: 'GET',
        userId: 'user-456',
      });
      expect(interaction.editReply).toHaveBeenCalledWith({
        embeds: expect.arrayContaining([
          expect.objectContaining({
            data: expect.objectContaining({
              title: 'Admin Settings',
            }),
          }),
        ]),
      });
    });

    it('should handle fetch error', async () => {
      const interaction = createMockInteraction('show');
      mockAdminFetch.mockResolvedValue({ ok: false });

      await handleSettings(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: 'Failed to fetch admin settings.',
      });
    });
  });

  describe('toggle-extended-context action', () => {
    it('should toggle extended context from true to false', async () => {
      const interaction = createMockInteraction('toggle-extended-context');
      mockAdminFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockSettings),
      });
      mockAdminPatchJson.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ ...mockSettings, extendedContextDefault: false }),
      });

      await handleSettings(interaction);

      expect(mockAdminPatchJson).toHaveBeenCalledWith(
        '/admin/settings',
        { extendedContextDefault: false },
        'user-456'
      );
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Extended context disabled globally'),
      });
    });

    it('should toggle extended context from false to true', async () => {
      const interaction = createMockInteraction('toggle-extended-context');
      mockAdminFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ ...mockSettings, extendedContextDefault: false }),
      });
      mockAdminPatchJson.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ ...mockSettings, extendedContextDefault: true }),
      });

      await handleSettings(interaction);

      expect(mockAdminPatchJson).toHaveBeenCalledWith(
        '/admin/settings',
        { extendedContextDefault: true },
        'user-456'
      );
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Extended context enabled globally'),
      });
    });

    it('should handle update error', async () => {
      const interaction = createMockInteraction('toggle-extended-context');
      mockAdminFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockSettings),
      });
      mockAdminPatchJson.mockResolvedValue({
        ok: false,
        text: vi.fn().mockResolvedValue('Server error'),
      });

      await handleSettings(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: 'Failed to update: Server error',
      });
    });
  });

  describe('set-max-messages action', () => {
    it('should show current value when no value provided', async () => {
      const interaction = createMockInteraction('set-max-messages');
      mockAdminFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockSettings),
      });

      await handleSettings(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('**Current max messages:** 50'),
      });
    });

    it('should update max messages when value provided', async () => {
      const interaction = createMockInteraction('set-max-messages', { value: 75 });
      mockAdminPatchJson.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ ...mockSettings, extendedContextMaxMessages: 75 }),
      });

      await handleSettings(interaction);

      expect(mockAdminPatchJson).toHaveBeenCalledWith(
        '/admin/settings',
        { extendedContextMaxMessages: 75 },
        'user-456'
      );
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Max messages set to 75'),
      });
    });

    it('should reject value out of range', async () => {
      const interaction = createMockInteraction('set-max-messages', { value: 150 });

      await handleSettings(interaction);

      expect(mockAdminPatchJson).not.toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: 'Max messages must be between 1 and 100.',
      });
    });
  });

  describe('set-max-age action', () => {
    it('should show current value when no duration provided', async () => {
      const interaction = createMockInteraction('set-max-age');
      mockAdminFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockSettings),
      });

      await handleSettings(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('**Current max age:** 2 hours'),
      });
    });

    it('should update max age when duration provided', async () => {
      const interaction = createMockInteraction('set-max-age', { duration: '4h' });
      mockAdminPatchJson.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ ...mockSettings, extendedContextMaxAge: 14400 }),
      });

      await handleSettings(interaction);

      expect(mockAdminPatchJson).toHaveBeenCalledWith(
        '/admin/settings',
        { extendedContextMaxAge: 14400 }, // 4 hours in seconds
        'user-456'
      );
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Max age set to 4 hours'),
      });
    });

    it('should disable max age with "off"', async () => {
      const interaction = createMockInteraction('set-max-age', { duration: 'off' });
      mockAdminPatchJson.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ ...mockSettings, extendedContextMaxAge: null }),
      });

      await handleSettings(interaction);

      expect(mockAdminPatchJson).toHaveBeenCalledWith(
        '/admin/settings',
        { extendedContextMaxAge: null },
        'user-456'
      );
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Max age filter disabled'),
      });
    });

    it('should reject invalid duration format', async () => {
      const interaction = createMockInteraction('set-max-age', { duration: 'invalid' });

      await handleSettings(interaction);

      expect(mockAdminPatchJson).not.toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Invalid duration'),
      });
    });

    it('should reject duration less than 1 minute', async () => {
      const interaction = createMockInteraction('set-max-age', { duration: '30s' });

      await handleSettings(interaction);

      expect(mockAdminPatchJson).not.toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: 'Max age must be at least 1 minute.',
      });
    });
  });

  describe('set-max-images action', () => {
    it('should show current value when no value provided', async () => {
      const interaction = createMockInteraction('set-max-images');
      mockAdminFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockSettings),
      });

      await handleSettings(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('**Current max images:** 5'),
      });
    });

    it('should update max images when value provided', async () => {
      const interaction = createMockInteraction('set-max-images', { value: 10 });
      mockAdminPatchJson.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ ...mockSettings, extendedContextMaxImages: 10 }),
      });

      await handleSettings(interaction);

      expect(mockAdminPatchJson).toHaveBeenCalledWith(
        '/admin/settings',
        { extendedContextMaxImages: 10 },
        'user-456'
      );
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Max images set to 10'),
      });
    });

    it('should allow setting max images to 0', async () => {
      const interaction = createMockInteraction('set-max-images', { value: 0 });
      mockAdminPatchJson.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ ...mockSettings, extendedContextMaxImages: 0 }),
      });

      await handleSettings(interaction);

      expect(mockAdminPatchJson).toHaveBeenCalledWith(
        '/admin/settings',
        { extendedContextMaxImages: 0 },
        'user-456'
      );
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Max images set to 0'),
      });
    });

    it('should reject value out of range', async () => {
      const interaction = createMockInteraction('set-max-images', { value: 25 });

      await handleSettings(interaction);

      expect(mockAdminPatchJson).not.toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: 'Max images must be between 0 and 20.',
      });
    });
  });

  describe('unknown action', () => {
    it('should reply with unknown action message', async () => {
      const interaction = createMockInteraction('invalid-action');

      await handleSettings(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: 'Unknown action: invalid-action',
      });
    });
  });

  describe('error handling', () => {
    it('should handle unexpected errors', async () => {
      const interaction = createMockInteraction('toggle-extended-context');
      mockAdminFetch.mockRejectedValue(new Error('Network error'));

      await handleSettings(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: 'An error occurred while processing your request.',
      });
    });

    it('should not respond again if already replied', async () => {
      const interaction = createMockInteraction('toggle-extended-context');
      Object.defineProperty(interaction, 'replied', {
        get: () => true,
        configurable: true,
      });
      mockAdminFetch.mockRejectedValue(new Error('Network error'));

      await handleSettings(interaction);

      expect(interaction.editReply).not.toHaveBeenCalled();
    });
  });
});
