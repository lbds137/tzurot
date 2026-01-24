/**
 * Tests for Profile Dashboard Handlers
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageFlags } from 'discord.js';
import type {
  StringSelectMenuInteraction,
  ButtonInteraction,
  ModalSubmitInteraction,
} from 'discord.js';
import {
  handleModalSubmit,
  handleSelectMenu,
  handleButton,
  isProfileDashboardInteraction,
} from './dashboard.js';

// Mock dependencies
const mockFetchProfile = vi.fn();
const mockUpdateProfile = vi.fn();
const mockDeleteProfile = vi.fn();
const mockIsDefaultProfile = vi.fn();

vi.mock('./api.js', () => ({
  fetchProfile: (...args: unknown[]) => mockFetchProfile(...args),
  updateProfile: (...args: unknown[]) => mockUpdateProfile(...args),
  deleteProfile: (...args: unknown[]) => mockDeleteProfile(...args),
  isDefaultProfile: (...args: unknown[]) => mockIsDefaultProfile(...args),
}));

vi.mock('./config.js', async () => {
  const actual = await vi.importActual('./config.js');
  return {
    ...actual,
  };
});

const mockSessionManager = {
  get: vi.fn(),
  set: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

vi.mock('../../../utils/dashboard/index.js', async () => {
  const actual = await vi.importActual('../../../utils/dashboard/index.js');
  return {
    ...actual,
    getSessionManager: () => mockSessionManager,
  };
});

vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
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

describe('Profile Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionManager.get.mockResolvedValue(null);
    mockSessionManager.set.mockResolvedValue(undefined);
    mockSessionManager.update.mockResolvedValue(undefined);
    mockSessionManager.delete.mockResolvedValue(undefined);
  });

  describe('handleModalSubmit', () => {
    const createMockModalInteraction = (customId: string) =>
      ({
        customId,
        user: { id: 'user-123' },
        reply: vi.fn(),
        deferUpdate: vi.fn(),
        editReply: vi.fn(),
        followUp: vi.fn(),
        fields: {
          getTextInputValue: vi.fn().mockReturnValue('test-value'),
        },
      }) as unknown as ModalSubmitInteraction;

    it('should handle section modal submission', async () => {
      const mockInteraction = createMockModalInteraction('profile::modal::persona-123::identity');

      mockSessionManager.get.mockResolvedValue({
        data: {
          id: 'persona-123',
          name: 'Test Profile',
          preferredName: 'Tester',
          pronouns: 'they/them',
          isDefault: false,
        },
      });

      mockUpdateProfile.mockResolvedValue({
        id: 'persona-123',
        name: 'Updated Profile',
        preferredName: 'Updated',
        pronouns: 'they/them',
        isDefault: false,
      });

      await handleModalSubmit(mockInteraction);

      expect(mockInteraction.deferUpdate).toHaveBeenCalled();
      expect(mockUpdateProfile).toHaveBeenCalled();
    });

    it('should reply with error for unknown modal', async () => {
      const mockInteraction = createMockModalInteraction('unknown::modal');

      await handleModalSubmit(mockInteraction);

      expect(mockInteraction.reply).toHaveBeenCalledWith({
        content: expect.stringContaining('Unknown form submission'),
        flags: MessageFlags.Ephemeral,
      });
    });

    it('should handle update failure gracefully', async () => {
      const mockInteraction = createMockModalInteraction('profile::modal::persona-123::identity');

      mockSessionManager.get.mockResolvedValue({
        data: {
          id: 'persona-123',
          name: 'Test Profile',
          isDefault: false,
        },
      });

      mockUpdateProfile.mockResolvedValue(null);

      await handleModalSubmit(mockInteraction);

      expect(mockInteraction.followUp).toHaveBeenCalledWith({
        content: expect.stringContaining('Failed to save'),
        flags: MessageFlags.Ephemeral,
      });
    });
  });

  describe('handleSelectMenu', () => {
    const createMockSelectInteraction = (customId: string, value: string) =>
      ({
        customId,
        values: [value],
        user: { id: 'user-123' },
        message: { id: 'msg-123' },
        channelId: 'channel-123',
        reply: vi.fn(),
        showModal: vi.fn(),
      }) as unknown as StringSelectMenuInteraction;

    it('should return early if not a profile interaction', async () => {
      const mockInteraction = createMockSelectInteraction('character::menu::test', 'edit-identity');

      await handleSelectMenu(mockInteraction);

      expect(mockInteraction.showModal).not.toHaveBeenCalled();
      expect(mockInteraction.reply).not.toHaveBeenCalled();
    });

    it('should show modal for section edit with session data', async () => {
      const mockInteraction = createMockSelectInteraction(
        'profile::menu::persona-123',
        'edit-identity'
      );

      mockSessionManager.get.mockResolvedValue({
        data: {
          id: 'persona-123',
          name: 'Test Profile',
          preferredName: 'Tester',
          pronouns: 'they/them',
          isDefault: false,
        },
      });

      await handleSelectMenu(mockInteraction);

      expect(mockInteraction.showModal).toHaveBeenCalled();
    });

    it('should fetch profile and create session if no session exists', async () => {
      const mockInteraction = createMockSelectInteraction(
        'profile::menu::persona-123',
        'edit-identity'
      );

      mockSessionManager.get.mockResolvedValue(null);
      mockFetchProfile.mockResolvedValue({
        id: 'persona-123',
        name: 'Fetched Profile',
        preferredName: 'Fetcher',
        isDefault: false,
      });

      await handleSelectMenu(mockInteraction);

      expect(mockFetchProfile).toHaveBeenCalledWith('persona-123', 'user-123');
      expect(mockSessionManager.set).toHaveBeenCalled();
      expect(mockInteraction.showModal).toHaveBeenCalled();
    });

    it('should reply with error if profile not found', async () => {
      const mockInteraction = createMockSelectInteraction(
        'profile::menu::persona-123',
        'edit-identity'
      );

      mockSessionManager.get.mockResolvedValue(null);
      mockFetchProfile.mockResolvedValue(null);

      await handleSelectMenu(mockInteraction);

      expect(mockInteraction.reply).toHaveBeenCalledWith({
        content: expect.stringContaining('Profile not found'),
        flags: MessageFlags.Ephemeral,
      });
    });

    it('should reply with error for unknown section', async () => {
      const mockInteraction = createMockSelectInteraction(
        'profile::menu::persona-123',
        'edit-nonexistent'
      );

      await handleSelectMenu(mockInteraction);

      expect(mockInteraction.reply).toHaveBeenCalledWith({
        content: expect.stringContaining('Unknown section'),
        flags: MessageFlags.Ephemeral,
      });
    });
  });

  describe('handleButton', () => {
    const createMockButtonInteraction = (customId: string) =>
      ({
        customId,
        user: { id: 'user-123' },
        message: { id: 'msg-123' },
        channelId: 'channel-123',
        update: vi.fn(),
        deferUpdate: vi.fn(),
        editReply: vi.fn(),
        reply: vi.fn(),
      }) as unknown as ButtonInteraction;

    describe('close button', () => {
      it('should delete session and close dashboard', async () => {
        const mockInteraction = createMockButtonInteraction('profile::close::persona-123');

        await handleButton(mockInteraction);

        expect(mockSessionManager.delete).toHaveBeenCalledWith(
          'user-123',
          'profile',
          'persona-123'
        );
        expect(mockInteraction.update).toHaveBeenCalledWith({
          content: expect.stringContaining('Dashboard closed'),
          embeds: [],
          components: [],
        });
      });
    });

    describe('refresh button', () => {
      it('should refresh dashboard with fresh data', async () => {
        const mockInteraction = createMockButtonInteraction('profile::refresh::persona-123');

        mockFetchProfile.mockResolvedValue({
          id: 'persona-123',
          name: 'Refreshed Profile',
          preferredName: 'Refresher',
          isDefault: false,
        });

        await handleButton(mockInteraction);

        expect(mockInteraction.deferUpdate).toHaveBeenCalled();
        expect(mockFetchProfile).toHaveBeenCalledWith('persona-123', 'user-123');
        expect(mockSessionManager.set).toHaveBeenCalled();
        expect(mockInteraction.editReply).toHaveBeenCalled();
      });

      it('should show error if profile not found on refresh', async () => {
        const mockInteraction = createMockButtonInteraction('profile::refresh::persona-123');

        mockFetchProfile.mockResolvedValue(null);

        await handleButton(mockInteraction);

        expect(mockInteraction.editReply).toHaveBeenCalledWith({
          content: expect.stringContaining('Profile not found'),
          embeds: [],
          components: [],
        });
      });
    });

    describe('delete button', () => {
      it('should show confirmation dialog', async () => {
        const mockInteraction = createMockButtonInteraction('profile::delete::persona-123');

        mockSessionManager.get.mockResolvedValue({
          data: {
            id: 'persona-123',
            name: 'Test Profile',
            isDefault: false,
          },
        });
        mockIsDefaultProfile.mockResolvedValue(false);

        await handleButton(mockInteraction);

        expect(mockInteraction.update).toHaveBeenCalledWith({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              data: expect.objectContaining({
                title: expect.stringContaining('Delete'),
              }),
            }),
          ]),
          components: expect.any(Array),
        });
      });

      it('should prevent deleting default profile', async () => {
        const mockInteraction = createMockButtonInteraction('profile::delete::persona-123');

        mockSessionManager.get.mockResolvedValue({
          data: {
            id: 'persona-123',
            name: 'Default Profile',
            isDefault: true,
          },
        });
        mockIsDefaultProfile.mockResolvedValue(true);

        await handleButton(mockInteraction);

        expect(mockInteraction.reply).toHaveBeenCalledWith({
          content: expect.stringContaining('Cannot delete your default profile'),
          flags: MessageFlags.Ephemeral,
        });
      });

      it('should show error if session expired', async () => {
        const mockInteraction = createMockButtonInteraction('profile::delete::persona-123');

        mockSessionManager.get.mockResolvedValue(null);

        await handleButton(mockInteraction);

        expect(mockInteraction.reply).toHaveBeenCalledWith({
          content: expect.stringContaining('Session expired'),
          flags: MessageFlags.Ephemeral,
        });
      });
    });

    describe('confirm-delete button', () => {
      it('should delete profile and show success', async () => {
        const mockInteraction = createMockButtonInteraction('profile::confirm-delete::persona-123');

        mockSessionManager.get.mockResolvedValue({
          data: {
            id: 'persona-123',
            name: 'Profile To Delete',
            isDefault: false,
          },
        });
        mockDeleteProfile.mockResolvedValue({ success: true });

        await handleButton(mockInteraction);

        expect(mockInteraction.deferUpdate).toHaveBeenCalled();
        expect(mockDeleteProfile).toHaveBeenCalledWith('persona-123', 'user-123');
        expect(mockSessionManager.delete).toHaveBeenCalled();
        expect(mockInteraction.editReply).toHaveBeenCalledWith({
          content: expect.stringContaining('has been deleted'),
          embeds: [],
          components: [],
        });
      });

      it('should show error on delete failure', async () => {
        const mockInteraction = createMockButtonInteraction('profile::confirm-delete::persona-123');

        mockSessionManager.get.mockResolvedValue({
          data: { name: 'Profile' },
        });
        mockDeleteProfile.mockResolvedValue({ success: false, error: 'Database error' });

        await handleButton(mockInteraction);

        expect(mockInteraction.editReply).toHaveBeenCalledWith({
          content: expect.stringContaining('Failed to delete'),
          embeds: [],
          components: [],
        });
      });
    });

    describe('cancel-delete button', () => {
      it('should return to dashboard view', async () => {
        const mockInteraction = createMockButtonInteraction('profile::cancel-delete::persona-123');

        // Provide complete flattened profile data for dashboard rendering
        mockSessionManager.get.mockResolvedValue({
          data: {
            id: 'persona-123',
            name: 'Test Profile',
            preferredName: 'Tester',
            pronouns: 'they/them',
            description: 'A test profile',
            content: 'Some content',
            isDefault: false,
            shareLongTermMemory: false,
          },
        });

        await handleButton(mockInteraction);

        expect(mockInteraction.deferUpdate).toHaveBeenCalled();
        expect(mockInteraction.editReply).toHaveBeenCalled();
      });

      it('should show error if session expired', async () => {
        const mockInteraction = createMockButtonInteraction('profile::cancel-delete::persona-123');

        mockSessionManager.get.mockResolvedValue(null);

        await handleButton(mockInteraction);

        expect(mockInteraction.editReply).toHaveBeenCalledWith({
          content: expect.stringContaining('Session expired'),
          embeds: [],
          components: [],
        });
      });
    });
  });

  describe('isProfileDashboardInteraction', () => {
    it('should return true for profile dashboard customId', () => {
      expect(isProfileDashboardInteraction('profile::menu::test')).toBe(true);
    });

    it('should return false for non-profile customId', () => {
      expect(isProfileDashboardInteraction('character::menu::test')).toBe(false);
    });
  });
});
