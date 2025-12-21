/**
 * Tests for Character List Handlers
 *
 * Note: escapeMarkdown tests are in utils/markdownUtils.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleList, handleListPagination } from './list.js';
import * as api from './api.js';
import type { EnvConfig } from '@tzurot/common-types';
import type { ButtonInteraction, ChatInputCommandInteraction, Client } from 'discord.js';

// Mock the api module
vi.mock('./api.js', () => ({
  fetchUserCharacters: vi.fn(),
  fetchPublicCharacters: vi.fn(),
  fetchUsernames: vi.fn(),
}));

describe('Character List', () => {

  describe('handleList', () => {
    const mockConfig = { GATEWAY_URL: 'http://localhost:3000' } as EnvConfig;

    const mockInteraction = {
      user: { id: 'user-123' },
      client: {
        users: {
          fetch: vi.fn(),
        },
      },
      editReply: vi.fn(),
    } as unknown as ChatInputCommandInteraction;

    beforeEach(() => {
      vi.clearAllMocks();
      vi.mocked(api.fetchUserCharacters).mockResolvedValue([]);
      vi.mocked(api.fetchPublicCharacters).mockResolvedValue([]);
      vi.mocked(api.fetchUsernames).mockResolvedValue(new Map());
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    // Note: deferReply is handled by top-level interactionCreate handler

    it('should fetch both owned and public characters', async () => {
      await handleList(mockInteraction, mockConfig);

      expect(api.fetchUserCharacters).toHaveBeenCalledWith('user-123', mockConfig);
      expect(api.fetchPublicCharacters).toHaveBeenCalledWith('user-123', mockConfig);
    });

    it('should show empty state when user has no characters', async () => {
      vi.mocked(api.fetchUserCharacters).mockResolvedValue([]);
      vi.mocked(api.fetchPublicCharacters).mockResolvedValue([]);

      await handleList(mockInteraction, mockConfig);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              data: expect.objectContaining({
                description: expect.stringContaining("You don't have any characters yet"),
              }),
            }),
          ]),
        })
      );
    });

    it('should display owned characters', async () => {
      vi.mocked(api.fetchUserCharacters).mockResolvedValue([
        {
          id: 'char-1',
          name: 'My Character',
          slug: 'my-char',
          displayName: null,
          isPublic: false,
          ownerId: 'user-123',
          characterInfo: '',
          personalityTraits: '',
          personalityTone: null,
          personalityAge: null,
          personalityAppearance: null,
          personalityLikes: null,
          personalityDislikes: null,
          conversationalGoals: null,
          conversationalExamples: null,
          errorMessage: null,
          birthMonth: null,
          birthDay: null,
          birthYear: null,
          voiceEnabled: false,
          imageEnabled: false,
          avatarData: null,
          createdAt: '',
          updatedAt: '',
        },
      ]);

      await handleList(mockInteraction, mockConfig);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              data: expect.objectContaining({
                description: expect.stringContaining('My Character'),
              }),
            }),
          ]),
        })
      );
    });

    it('should handle API errors gracefully', async () => {
      vi.mocked(api.fetchUserCharacters).mockRejectedValue(new Error('API error'));

      await handleList(mockInteraction, mockConfig);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(
        '❌ Failed to load characters. Please try again.'
      );
    });

    it('should show visibility icons', async () => {
      vi.mocked(api.fetchUserCharacters).mockResolvedValue([
        {
          id: 'char-1',
          name: 'Private Char',
          slug: 'private-char',
          displayName: null,
          isPublic: false,
          ownerId: 'user-123',
          characterInfo: '',
          personalityTraits: '',
          personalityTone: null,
          personalityAge: null,
          personalityAppearance: null,
          personalityLikes: null,
          personalityDislikes: null,
          conversationalGoals: null,
          conversationalExamples: null,
          errorMessage: null,
          birthMonth: null,
          birthDay: null,
          birthYear: null,
          voiceEnabled: false,
          imageEnabled: false,
          avatarData: null,
          createdAt: '',
          updatedAt: '',
        },
        {
          id: 'char-2',
          name: 'Public Char',
          slug: 'public-char',
          displayName: null,
          isPublic: true,
          ownerId: 'user-123',
          characterInfo: '',
          personalityTraits: '',
          personalityTone: null,
          personalityAge: null,
          personalityAppearance: null,
          personalityLikes: null,
          personalityDislikes: null,
          conversationalGoals: null,
          conversationalExamples: null,
          errorMessage: null,
          birthMonth: null,
          birthDay: null,
          birthYear: null,
          voiceEnabled: false,
          imageEnabled: false,
          avatarData: null,
          createdAt: '',
          updatedAt: '',
        },
      ]);

      await handleList(mockInteraction, mockConfig);

      const callArgs = vi.mocked(mockInteraction.editReply).mock.calls[0][0];
      expect(callArgs).toEqual(
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              data: expect.objectContaining({
                description: expect.stringMatching(/🔒.*Private Char/),
              }),
            }),
          ]),
        })
      );
    });
  });

  describe('handleListPagination', () => {
    const mockConfig = { GATEWAY_URL: 'http://localhost:3000' } as EnvConfig;

    const mockInteraction = {
      user: { id: 'user-123' },
      client: {
        users: {
          fetch: vi.fn(),
        },
      },
      deferUpdate: vi.fn(),
      editReply: vi.fn(),
    } as unknown as ButtonInteraction;

    beforeEach(() => {
      vi.clearAllMocks();
      vi.mocked(api.fetchUserCharacters).mockResolvedValue([]);
      vi.mocked(api.fetchPublicCharacters).mockResolvedValue([]);
      vi.mocked(api.fetchUsernames).mockResolvedValue(new Map());
    });

    it('should defer update on pagination', async () => {
      await handleListPagination(mockInteraction, 1, mockConfig);

      expect(mockInteraction.deferUpdate).toHaveBeenCalled();
    });

    it('should refresh data on pagination', async () => {
      await handleListPagination(mockInteraction, 1, mockConfig);

      expect(api.fetchUserCharacters).toHaveBeenCalledWith('user-123', mockConfig);
      expect(api.fetchPublicCharacters).toHaveBeenCalledWith('user-123', mockConfig);
    });

    it('should handle errors gracefully without crashing', async () => {
      vi.mocked(api.fetchUserCharacters).mockRejectedValue(new Error('API error'));

      // Should not throw
      await expect(handleListPagination(mockInteraction, 1, mockConfig)).resolves.not.toThrow();

      // Should not call editReply on error (keeps existing content)
      expect(mockInteraction.editReply).not.toHaveBeenCalled();
    });
  });
});
