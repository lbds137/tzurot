/**
 * Tests for Character Edit Handler
 *
 * Tests /character edit subcommand:
 * - Character not found
 * - Permission denied (canEdit: false)
 * - Successful dashboard opening
 * - Error handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleEdit } from './edit.js';
import * as api from './api.js';
import * as dashboardUtils from '../../utils/dashboard/index.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder, ActionRowBuilder } from 'discord.js';
import type { EnvConfig } from '@tzurot/common-types';

// Mock dependencies
vi.mock('./api.js', () => ({
  fetchCharacter: vi.fn(),
}));

vi.mock('../../utils/dashboard/index.js', () => ({
  buildDashboardEmbed: vi.fn(),
  buildDashboardComponents: vi.fn(),
  getSessionManager: vi.fn(),
}));

vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal();
  return {
    ...(actual as Record<string, unknown>),
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  };
});

describe('Character Edit Handler', () => {
  const mockConfig = { GATEWAY_URL: 'http://localhost:3000' } as EnvConfig;

  const createMockInteraction = (slug: string) => {
    const mockReply = { id: 'reply-123' };
    return {
      user: { id: 'user-123' },
      channelId: 'channel-456',
      options: {
        getString: vi.fn((_name: string, _required?: boolean) => slug),
      },
      editReply: vi.fn().mockResolvedValue(mockReply),
    } as unknown as ChatInputCommandInteraction;
  };

  const createMockCharacter = (overrides = {}) => ({
    id: 'char-uuid-1',
    name: 'Test Character',
    displayName: 'Test Display',
    slug: 'test-character',
    canEdit: true,
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();

    // Set up default dashboard mocks
    vi.mocked(dashboardUtils.buildDashboardEmbed).mockReturnValue(
      new EmbedBuilder().setTitle('Dashboard')
    );
    vi.mocked(dashboardUtils.buildDashboardComponents).mockReturnValue([
      new ActionRowBuilder() as never,
    ]);
    vi.mocked(dashboardUtils.getSessionManager).mockReturnValue({
      set: vi.fn(),
      get: vi.fn(),
      delete: vi.fn(),
    } as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('handleEdit', () => {
    // Note: deferReply is handled by top-level interactionCreate handler

    it('should return error when character not found', async () => {
      const mockInteraction = createMockInteraction('nonexistent');
      vi.mocked(api.fetchCharacter).mockResolvedValue(null);

      await handleEdit(mockInteraction, mockConfig);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.stringContaining('not found'));
    });

    it('should return error when user cannot edit character', async () => {
      const mockInteraction = createMockInteraction('other-char');
      vi.mocked(api.fetchCharacter).mockResolvedValue(
        createMockCharacter({ canEdit: false, slug: 'other-char' })
      );

      await handleEdit(mockInteraction, mockConfig);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(
        expect.stringContaining("don't have permission")
      );
    });

    it('should open dashboard for editable character', async () => {
      const mockInteraction = createMockInteraction('my-char');
      const mockCharacter = createMockCharacter({ slug: 'my-char' });
      vi.mocked(api.fetchCharacter).mockResolvedValue(mockCharacter);

      await handleEdit(mockInteraction, mockConfig);

      expect(dashboardUtils.buildDashboardEmbed).toHaveBeenCalled();
      expect(dashboardUtils.buildDashboardComponents).toHaveBeenCalledWith(
        expect.anything(),
        'my-char',
        mockCharacter,
        expect.objectContaining({ showClose: true, showRefresh: true })
      );
      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        embeds: expect.any(Array),
        components: expect.any(Array),
      });
    });

    it('should create session after opening dashboard', async () => {
      const mockInteraction = createMockInteraction('my-char');
      const mockCharacter = createMockCharacter({ slug: 'my-char' });
      vi.mocked(api.fetchCharacter).mockResolvedValue(mockCharacter);

      const mockSessionManager = {
        set: vi.fn(),
        get: vi.fn(),
        delete: vi.fn(),
      };
      vi.mocked(dashboardUtils.getSessionManager).mockReturnValue(mockSessionManager as never);

      await handleEdit(mockInteraction, mockConfig);

      expect(mockSessionManager.set).toHaveBeenCalledWith({
        userId: 'user-123',
        entityType: 'character',
        entityId: 'my-char',
        data: mockCharacter,
        messageId: 'reply-123',
        channelId: 'channel-456',
      });
    });

    it('should handle fetch errors gracefully', async () => {
      const mockInteraction = createMockInteraction('error-char');
      vi.mocked(api.fetchCharacter).mockRejectedValue(new Error('Network error'));

      await handleEdit(mockInteraction, mockConfig);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(
        expect.stringContaining('Failed to load character')
      );
    });
  });
});
