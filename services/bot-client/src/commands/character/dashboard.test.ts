/**
 * Tests for Character Dashboard Handlers
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  handleModalSubmit,
  handleSelectMenu,
  handleButton,
  isCharacterDashboardInteraction,
} from './dashboard.js';
import { handleDashboardClose } from '../../utils/dashboard/closeHandler.js';
import * as api from './api.js';
import * as createModule from './create.js';
import * as viewModule from './view.js';
import * as dashboardUtils from '../../utils/dashboard/index.js';
import * as customIds from '../../utils/customIds.js';
import type { EnvConfig } from '@tzurot/common-types';
import type {
  StringSelectMenuInteraction,
  ButtonInteraction,
  ModalSubmitInteraction,
} from 'discord.js';
import { MessageFlags } from 'discord.js';

// Mock dependencies
vi.mock('./api.js', () => ({
  fetchCharacter: vi.fn(),
  updateCharacter: vi.fn(),
  toggleVisibility: vi.fn(),
}));

// Mock userGatewayClient for delete functionality
const mockCallGatewayApi = vi.fn();
vi.mock('../../utils/userGatewayClient.js', () => ({
  callGatewayApi: (...args: unknown[]) => mockCallGatewayApi(...args),
}));

vi.mock('./create.js', () => ({
  handleSeedModalSubmit: vi.fn(),
}));

// Note: Browse pagination is handled in index.ts, not dashboard.ts

vi.mock('./view.js', () => ({
  handleViewPagination: vi.fn(),
  handleExpandField: vi.fn(),
}));

vi.mock('../../utils/dashboard/index.js', async () => {
  const actual = await vi.importActual('../../utils/dashboard/index.js');
  return {
    ...actual,
    buildDashboardEmbed: vi.fn().mockReturnValue({ data: {} }),
    buildDashboardComponents: vi.fn().mockReturnValue([]),
    buildDashboardCustomId: vi.fn((type, action) => `${type}::${action}`),
    buildSectionModal: vi.fn().mockReturnValue({ toJSON: () => ({}) }),
    extractModalValues: vi.fn(),
    getSessionManager: vi.fn().mockReturnValue({
      get: vi.fn(),
      set: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    }),
    parseDashboardCustomId: vi.fn(),
    isDashboardInteraction: vi.fn(),
  };
});

vi.mock('../../utils/dashboard/closeHandler.js', () => ({
  handleDashboardClose: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../utils/dashboard/deleteConfirmation.js', () => ({
  buildDeleteConfirmation: vi.fn().mockReturnValue({
    embed: { data: {} },
    components: [],
  }),
}));

vi.mock('../../utils/customIds.js', () => ({
  CUSTOM_ID_DELIMITER: '::',
  CharacterCustomIds: {
    parse: vi.fn(),
  },
}));

vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal();
  return {
    ...(actual as Record<string, unknown>),
    getConfig: vi.fn().mockReturnValue({ GATEWAY_URL: 'http://localhost:3000' }),
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  };
});

describe('Character Dashboard', () => {
  const mockConfig = { GATEWAY_URL: 'http://localhost:3000' } as EnvConfig;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('handleModalSubmit', () => {
    const createMockModalInteraction = (customId: string) =>
      ({
        customId,
        user: { id: 'user-123' },
        reply: vi.fn(),
        deferUpdate: vi.fn(),
        editReply: vi.fn(),
      }) as unknown as ModalSubmitInteraction;

    it('should route seed modal to handleSeedModalSubmit', async () => {
      vi.mocked(dashboardUtils.buildDashboardCustomId).mockReturnValue('character::seed');
      const mockInteraction = createMockModalInteraction('character::seed');

      await handleModalSubmit(mockInteraction, mockConfig);

      expect(createModule.handleSeedModalSubmit).toHaveBeenCalledWith(mockInteraction, mockConfig);
    });

    it('should handle section edit modals', async () => {
      vi.mocked(dashboardUtils.parseDashboardCustomId).mockReturnValue({
        entityType: 'character',
        action: 'modal',
        entityId: 'test-char',
        sectionId: 'identity',
      });

      const mockInteraction = createMockModalInteraction('character::modal::test-char::identity');
      mockInteraction.deferUpdate = vi.fn();
      mockInteraction.editReply = vi.fn();

      vi.mocked(api.updateCharacter).mockResolvedValue({
        id: 'uuid',
        name: 'Test',
        slug: 'test-char',
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
      });

      await handleModalSubmit(mockInteraction, mockConfig);

      expect(mockInteraction.deferUpdate).toHaveBeenCalled();
    });

    it('should reply with error for unknown modal', async () => {
      vi.mocked(dashboardUtils.buildDashboardCustomId).mockReturnValue('character::seed');
      vi.mocked(dashboardUtils.parseDashboardCustomId).mockReturnValue(null);

      const mockInteraction = createMockModalInteraction('unknown::modal');

      await handleModalSubmit(mockInteraction, mockConfig);

      expect(mockInteraction.reply).toHaveBeenCalledWith({
        content: expect.stringContaining('Unknown form submission'),
        flags: MessageFlags.Ephemeral,
      });
    });

    it('should preserve browseContext in session when editing character from browse', async () => {
      const browseContext = { source: 'browse' as const, page: 2, filter: 'all', sort: 'date' };
      vi.mocked(dashboardUtils.parseDashboardCustomId).mockReturnValue({
        entityType: 'character',
        action: 'modal',
        entityId: 'test-char',
        sectionId: 'identity',
      });

      const mockInteraction = createMockModalInteraction('character::modal::test-char::identity');
      mockInteraction.deferUpdate = vi.fn();
      mockInteraction.editReply = vi.fn();

      // Session has browseContext (cast mock to allow partial data)
      const mockSession = { data: { name: 'Test', browseContext } };
      vi.mocked(dashboardUtils.getSessionManager().get).mockResolvedValue(mockSession as never);

      vi.mocked(api.updateCharacter).mockResolvedValue({
        id: 'uuid',
        name: 'Test',
        slug: 'test-char',
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
      });

      await handleModalSubmit(mockInteraction, mockConfig);

      // Verify session was updated with browseContext preserved
      expect(dashboardUtils.getSessionManager().update).toHaveBeenCalledWith(
        'user-123', // userId
        'character',
        'test-char',
        expect.objectContaining({
          browseContext, // browseContext should be preserved
        })
      );
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

    it('should return early if not a character interaction', async () => {
      vi.mocked(dashboardUtils.parseDashboardCustomId).mockReturnValue({
        entityType: 'persona',
        action: 'menu',
        entityId: 'test',
      });

      const mockInteraction = createMockSelectInteraction('persona::menu::test', 'edit-identity');

      await handleSelectMenu(mockInteraction);

      expect(mockInteraction.showModal).not.toHaveBeenCalled();
      expect(mockInteraction.reply).not.toHaveBeenCalled();
    });

    it('should handle action-visibility selection', async () => {
      vi.mocked(dashboardUtils.parseDashboardCustomId).mockReturnValue({
        entityType: 'character',
        action: 'menu',
        entityId: 'test-char',
      });

      vi.mocked(api.fetchCharacter).mockResolvedValue({
        id: 'uuid',
        name: 'Test',
        slug: 'test-char',
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
        canEdit: true,
      });

      vi.mocked(api.toggleVisibility).mockResolvedValue({
        id: 'uuid',
        slug: 'test-char',
        isPublic: true,
      });

      const mockInteraction = createMockSelectInteraction(
        'character::menu::test-char',
        'action-visibility'
      );
      mockInteraction.deferUpdate = vi.fn();
      mockInteraction.editReply = vi.fn();

      await handleSelectMenu(mockInteraction);

      expect(api.toggleVisibility).toHaveBeenCalledWith('test-char', true, 'user-123', mockConfig);
    });

    it('should handle action-avatar selection with prompt', async () => {
      vi.mocked(dashboardUtils.parseDashboardCustomId).mockReturnValue({
        entityType: 'character',
        action: 'menu',
        entityId: 'test-char',
      });

      const mockInteraction = createMockSelectInteraction(
        'character::menu::test-char',
        'action-avatar'
      );

      await handleSelectMenu(mockInteraction);

      expect(mockInteraction.reply).toHaveBeenCalledWith({
        content: expect.stringContaining('/character avatar'),
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
      }) as unknown as ButtonInteraction;

    // Note: List/sort pagination tests removed - browse pagination is now handled in index.ts

    it('should handle view pagination button', async () => {
      vi.mocked(customIds.CharacterCustomIds.parse).mockReturnValue({
        command: 'character',
        action: 'view',
        characterId: 'test-char',
        viewPage: 2,
      });

      const mockInteraction = createMockButtonInteraction('character:view:test-char:2');

      await handleButton(mockInteraction);

      expect(viewModule.handleViewPagination).toHaveBeenCalledWith(
        mockInteraction,
        'test-char',
        2,
        expect.any(Object)
      );
    });

    it('should handle expand field button', async () => {
      vi.mocked(customIds.CharacterCustomIds.parse).mockReturnValue({
        command: 'character',
        action: 'expand',
        characterId: 'test-char',
        fieldName: 'personalityTraits',
      });

      const mockInteraction = createMockButtonInteraction(
        'character:expand:test-char:personalityTraits'
      );

      await handleButton(mockInteraction);

      expect(viewModule.handleExpandField).toHaveBeenCalledWith(
        mockInteraction,
        'test-char',
        'personalityTraits',
        expect.any(Object)
      );
    });

    it('should delegate to shared close handler', async () => {
      vi.mocked(customIds.CharacterCustomIds.parse).mockReturnValue(null);
      vi.mocked(dashboardUtils.parseDashboardCustomId).mockReturnValue({
        entityType: 'character',
        action: 'close',
        entityId: 'test-char',
      });

      const mockInteraction = createMockButtonInteraction('character::close::test-char');

      await handleButton(mockInteraction);

      // Verify delegation to shared handler
      expect(handleDashboardClose).toHaveBeenCalledWith(mockInteraction, 'character', 'test-char');
    });

    it('should handle refresh button', async () => {
      vi.mocked(customIds.CharacterCustomIds.parse).mockReturnValue(null);
      vi.mocked(dashboardUtils.parseDashboardCustomId).mockReturnValue({
        entityType: 'character',
        action: 'refresh',
        entityId: 'test-char',
      });

      vi.mocked(api.fetchCharacter).mockResolvedValue({
        id: 'uuid',
        name: 'Test',
        slug: 'test-char',
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
        canEdit: true,
      });

      const mockInteraction = createMockButtonInteraction('character::refresh::test-char');

      await handleButton(mockInteraction);

      expect(mockInteraction.deferUpdate).toHaveBeenCalled();
      expect(api.fetchCharacter).toHaveBeenCalledWith('test-char', expect.any(Object), 'user-123');
      expect(mockInteraction.editReply).toHaveBeenCalled();
    });

    it('should handle character not found on refresh', async () => {
      vi.mocked(customIds.CharacterCustomIds.parse).mockReturnValue(null);
      vi.mocked(dashboardUtils.parseDashboardCustomId).mockReturnValue({
        entityType: 'character',
        action: 'refresh',
        entityId: 'nonexistent',
      });

      vi.mocked(api.fetchCharacter).mockResolvedValue(null);

      const mockInteraction = createMockButtonInteraction('character::refresh::nonexistent');

      await handleButton(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Character not found'),
        embeds: [],
        components: [],
      });
    });
  });

  describe('isCharacterDashboardInteraction', () => {
    it('should return true for dashboard-specific actions', () => {
      vi.mocked(dashboardUtils.isDashboardInteraction).mockReturnValue(true);

      // Test each dashboard action
      const dashboardActions = [
        'menu',
        'modal',
        'close',
        'refresh',
        'back',
        'delete',
        'delete_confirm',
        'delete_cancel',
      ];

      for (const action of dashboardActions) {
        vi.mocked(customIds.CharacterCustomIds.parse).mockReturnValue({
          command: 'character',
          action,
          characterId: 'test-char',
        });

        expect(isCharacterDashboardInteraction(`character::${action}::test-char`)).toBe(true);
      }
    });

    it('should return false for non-character customId', () => {
      vi.mocked(dashboardUtils.isDashboardInteraction).mockReturnValue(false);

      expect(isCharacterDashboardInteraction('persona::menu::test')).toBe(false);
    });

    it('should return false for non-dashboard character actions', () => {
      vi.mocked(dashboardUtils.isDashboardInteraction).mockReturnValue(true);

      // Browse actions should NOT be matched
      vi.mocked(customIds.CharacterCustomIds.parse).mockReturnValue({
        command: 'character',
        action: 'browse',
        page: 0,
      });
      expect(isCharacterDashboardInteraction('character::browse::0::all::date::')).toBe(false);

      vi.mocked(customIds.CharacterCustomIds.parse).mockReturnValue({
        command: 'character',
        action: 'browse-select',
      });
      expect(isCharacterDashboardInteraction('character::browse-select')).toBe(false);

      // List action should NOT be matched
      vi.mocked(customIds.CharacterCustomIds.parse).mockReturnValue({
        command: 'character',
        action: 'list',
        page: 0,
      });
      expect(isCharacterDashboardInteraction('character::list::0')).toBe(false);
    });

    it('should return false if parse returns null', () => {
      vi.mocked(dashboardUtils.isDashboardInteraction).mockReturnValue(true);
      vi.mocked(customIds.CharacterCustomIds.parse).mockReturnValue(null);

      expect(isCharacterDashboardInteraction('character::invalid')).toBe(false);
    });
  });

  describe('delete confirmation buttons', () => {
    const createMockButtonInteraction = (customId: string) =>
      ({
        customId,
        user: { id: 'user-123' },
        message: { id: 'msg-123' },
        channelId: 'channel-123',
        update: vi.fn(),
        deferUpdate: vi.fn(),
        editReply: vi.fn(),
      }) as unknown as ButtonInteraction;

    beforeEach(() => {
      mockCallGatewayApi.mockReset();
    });

    it('should handle delete_confirm and delete character', async () => {
      vi.mocked(customIds.CharacterCustomIds.parse).mockReturnValue({
        command: 'character',
        action: 'delete_confirm',
        characterId: 'test-char',
      });

      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: {
          deletedCounts: {
            conversationHistory: 5,
            memories: 3,
            pendingMemories: 0,
            channelSettings: 1,
            aliases: 0,
          },
          deletedName: 'Test Character',
          deletedSlug: 'test-char',
        },
      });

      const mockInteraction = createMockButtonInteraction('character:delete_confirm:test-char');

      await handleButton(mockInteraction);

      expect(mockInteraction.update).toHaveBeenCalledWith({
        content: expect.stringContaining('Deleting character'),
        embeds: [],
        components: [],
      });
      expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/personality/test-char', {
        method: 'DELETE',
        userId: 'user-123',
      });
      // The success message (schema validation may show simplified or detailed message)
      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('deleted'),
        embeds: [],
        components: [],
      });
    });

    it('should handle delete_cancel and restore dashboard', async () => {
      vi.mocked(customIds.CharacterCustomIds.parse).mockReturnValue({
        command: 'character',
        action: 'delete_cancel',
        characterId: 'test-char',
      });

      const mockInteraction = createMockButtonInteraction('character:delete_cancel:test-char');

      await handleButton(mockInteraction);

      expect(mockInteraction.update).toHaveBeenCalledWith({
        content: expect.stringContaining('Deletion cancelled'),
        embeds: [],
        components: [],
      });
      expect(mockCallGatewayApi).not.toHaveBeenCalled();
    });

    it('should handle delete API failure', async () => {
      vi.mocked(customIds.CharacterCustomIds.parse).mockReturnValue({
        command: 'character',
        action: 'delete_confirm',
        characterId: 'test-char',
      });

      mockCallGatewayApi.mockResolvedValue({
        ok: false,
        error: 'Character not found',
      });

      const mockInteraction = createMockButtonInteraction('character:delete_confirm:test-char');

      await handleButton(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Failed to delete'),
        embeds: [],
        components: [],
      });
    });

    it('should return early for delete actions with missing characterId', async () => {
      vi.mocked(customIds.CharacterCustomIds.parse).mockReturnValue({
        command: 'character',
        action: 'delete_confirm',
        characterId: undefined,
      });

      const mockInteraction = createMockButtonInteraction('character:delete_confirm');

      await handleButton(mockInteraction);

      // Should return early without calling API
      expect(mockCallGatewayApi).not.toHaveBeenCalled();
      expect(mockInteraction.update).not.toHaveBeenCalled();
    });
  });
});
