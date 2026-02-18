/**
 * Tests for Character Create Handlers
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleCreate, handleSeedModalSubmit } from './create.js';
import * as api from './api.js';
import * as dashboardUtils from '../../utils/dashboard/index.js';
import type { EnvConfig } from '@tzurot/common-types';
import type { ModalSubmitInteraction } from 'discord.js';
import { MessageFlags } from 'discord.js';
import type { ModalCommandContext } from '../../utils/commandContext/types.js';

// Mock dependencies
vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal();
  return {
    ...(actual as Record<string, unknown>),
    isBotOwner: vi.fn().mockReturnValue(true),
    // Slug passthrough — normalization tested in common-types slugUtils.test.ts
    normalizeSlugForUser: vi.fn((slug: string) => slug),
  };
});

vi.mock('./api.js', () => ({
  createCharacter: vi.fn(),
}));

vi.mock('../../utils/dashboard/index.js', () => ({
  buildDashboardEmbed: vi.fn().mockReturnValue({ data: {} }),
  buildDashboardComponents: vi.fn().mockReturnValue([]),
  buildDashboardCustomId: vi.fn().mockReturnValue('character::seed'),
  extractModalValues: vi.fn(),
  getSessionManager: vi.fn().mockReturnValue({
    set: vi.fn(),
  }),
}));

describe('Character Create', () => {
  const mockConfig = { GATEWAY_URL: 'http://localhost:3000' } as EnvConfig;

  describe('handleCreate', () => {
    const mockInteraction = {
      showModal: vi.fn(),
    } as unknown as ModalCommandContext;

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should show modal for character creation', async () => {
      await handleCreate(mockInteraction);

      expect(mockInteraction.showModal).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title: 'Create New Character',
          }),
        })
      );
    });

    it('should include seed fields in modal', async () => {
      await handleCreate(mockInteraction);

      // Get the ModalBuilder and convert to JSON for inspection
      const modalBuilder = vi.mocked(mockInteraction.showModal).mock.calls[0][0] as {
        toJSON: () => { components: Array<{ components: Array<{ custom_id: string }> }> };
      };
      const modalData = modalBuilder.toJSON();
      const fieldIds = modalData.components.flatMap(row => row.components.map(c => c.custom_id));

      expect(fieldIds).toContain('name');
      expect(fieldIds).toContain('slug');
      expect(fieldIds).toContain('characterInfo');
      expect(fieldIds).toContain('personalityTraits');
    });
  });

  describe('handleSeedModalSubmit', () => {
    const createMockModalInteraction = (values: Record<string, string>) =>
      ({
        user: { id: 'user-123', username: 'testuser' },
        channelId: 'channel-123',
        deferReply: vi.fn(),
        editReply: vi.fn().mockResolvedValue({ id: 'message-123' }),
        fields: {
          getTextInputValue: vi.fn((id: string) => values[id] ?? ''),
        },
      }) as unknown as ModalSubmitInteraction;

    beforeEach(() => {
      vi.clearAllMocks();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should defer reply with ephemeral flag', async () => {
      vi.mocked(dashboardUtils.extractModalValues).mockReturnValue({
        name: 'Test Character',
        slug: 'test-character',
        characterInfo: 'Info',
        personalityTraits: 'Traits',
      });

      vi.mocked(api.createCharacter).mockResolvedValue({
        id: 'new-uuid',
        name: 'Test Character',
        slug: 'test-character',
        displayName: null,
        isPublic: false,
        ownerId: 'user-123',
        characterInfo: 'Info',
        personalityTraits: 'Traits',
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
      });

      const mockInteraction = createMockModalInteraction({
        name: 'Test Character',
        slug: 'test-character',
        characterInfo: 'Info',
        personalityTraits: 'Traits',
      });

      await handleSeedModalSubmit(mockInteraction, mockConfig);

      expect(mockInteraction.deferReply).toHaveBeenCalledWith({
        flags: MessageFlags.Ephemeral,
      });
    });

    it('should reject invalid slug format', async () => {
      vi.mocked(dashboardUtils.extractModalValues).mockReturnValue({
        name: 'Test',
        slug: 'Invalid Slug!',
        characterInfo: 'Info',
        personalityTraits: 'Traits',
      });

      const mockInteraction = createMockModalInteraction({
        name: 'Test',
        slug: 'Invalid Slug!',
        characterInfo: 'Info',
        personalityTraits: 'Traits',
      });

      await handleSeedModalSubmit(mockInteraction, mockConfig);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(
        expect.stringContaining('Invalid slug format')
      );
    });

    it('should accept valid slug with lowercase, numbers, and hyphens', async () => {
      vi.mocked(dashboardUtils.extractModalValues).mockReturnValue({
        name: 'Test',
        slug: 'valid-slug-123',
        characterInfo: 'Info',
        personalityTraits: 'Traits',
      });

      vi.mocked(api.createCharacter).mockResolvedValue({
        id: 'new-uuid',
        name: 'Test',
        slug: 'valid-slug-123',
        displayName: null,
        isPublic: false,
        ownerId: 'user-123',
        characterInfo: 'Info',
        personalityTraits: 'Traits',
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
      });

      const mockInteraction = createMockModalInteraction({
        name: 'Test',
        slug: 'valid-slug-123',
        characterInfo: 'Info',
        personalityTraits: 'Traits',
      });

      await handleSeedModalSubmit(mockInteraction, mockConfig);

      expect(api.createCharacter).toHaveBeenCalled();
    });

    it('should create character via API with correct data', async () => {
      vi.mocked(dashboardUtils.extractModalValues).mockReturnValue({
        name: 'New Character',
        slug: 'new-character',
        characterInfo: 'Character info here',
        personalityTraits: 'Personality traits',
      });

      vi.mocked(api.createCharacter).mockResolvedValue({
        id: 'new-uuid',
        name: 'New Character',
        slug: 'new-character',
        displayName: null,
        isPublic: false,
        ownerId: 'user-123',
        characterInfo: 'Character info here',
        personalityTraits: 'Personality traits',
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
      });

      const mockInteraction = createMockModalInteraction({
        name: 'New Character',
        slug: 'new-character',
        characterInfo: 'Character info here',
        personalityTraits: 'Personality traits',
      });

      await handleSeedModalSubmit(mockInteraction, mockConfig);

      expect(api.createCharacter).toHaveBeenCalledWith(
        {
          name: 'New Character',
          slug: 'new-character',
          characterInfo: 'Character info here',
          personalityTraits: 'Personality traits',
          isPublic: false,
        },
        'user-123',
        mockConfig
      );
    });

    it('should handle duplicate slug error (409)', async () => {
      vi.mocked(dashboardUtils.extractModalValues).mockReturnValue({
        name: 'Test',
        slug: 'existing-slug',
        characterInfo: 'Info',
        personalityTraits: 'Traits',
      });

      vi.mocked(api.createCharacter).mockRejectedValue(new Error('409'));

      const mockInteraction = createMockModalInteraction({
        name: 'Test',
        slug: 'existing-slug',
        characterInfo: 'Info',
        personalityTraits: 'Traits',
      });

      await handleSeedModalSubmit(mockInteraction, mockConfig);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(
        expect.stringContaining('already exists')
      );
    });

    it('should handle generic creation error', async () => {
      vi.mocked(dashboardUtils.extractModalValues).mockReturnValue({
        name: 'Test',
        slug: 'test-slug',
        characterInfo: 'Info',
        personalityTraits: 'Traits',
      });

      vi.mocked(api.createCharacter).mockRejectedValue(new Error('Server error'));

      const mockInteraction = createMockModalInteraction({
        name: 'Test',
        slug: 'test-slug',
        characterInfo: 'Info',
        personalityTraits: 'Traits',
      });

      await handleSeedModalSubmit(mockInteraction, mockConfig);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(
        '❌ Failed to create character. Please try again.'
      );
    });

    it('should create session after successful creation', async () => {
      const mockSessionManager = {
        set: vi.fn(),
      };
      vi.mocked(dashboardUtils.getSessionManager).mockReturnValue(mockSessionManager as any);

      vi.mocked(dashboardUtils.extractModalValues).mockReturnValue({
        name: 'Test',
        slug: 'test-slug',
        characterInfo: 'Info',
        personalityTraits: 'Traits',
      });

      vi.mocked(api.createCharacter).mockResolvedValue({
        id: 'new-uuid',
        name: 'Test',
        slug: 'test-slug',
        displayName: null,
        isPublic: false,
        ownerId: 'user-123',
        characterInfo: 'Info',
        personalityTraits: 'Traits',
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
      });

      const mockInteraction = createMockModalInteraction({
        name: 'Test',
        slug: 'test-slug',
        characterInfo: 'Info',
        personalityTraits: 'Traits',
      });

      await handleSeedModalSubmit(mockInteraction, mockConfig);

      expect(mockSessionManager.set).toHaveBeenCalledWith({
        userId: 'user-123',
        entityType: 'character',
        entityId: 'test-slug',
        data: expect.any(Object),
        messageId: 'message-123',
        channelId: 'channel-123',
      });
    });
  });
});
