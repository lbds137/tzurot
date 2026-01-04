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
import * as api from './api.js';
import * as createModule from './create.js';
import * as listModule from './list.js';
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

vi.mock('./create.js', () => ({
  handleSeedModalSubmit: vi.fn(),
}));

vi.mock('./list.js', () => ({
  handleListPagination: vi.fn(),
}));

vi.mock('./view.js', () => ({
  handleViewPagination: vi.fn(),
  handleExpandField: vi.fn(),
}));

vi.mock('../../utils/dashboard/index.js', () => ({
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
}));

vi.mock('../../utils/customIds.js', () => ({
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

      vi.mocked(api.toggleVisibility).mockResolvedValue({ isPublic: true });

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

    it('should handle list pagination button', async () => {
      vi.mocked(customIds.CharacterCustomIds.parse).mockReturnValue({
        action: 'list',
        page: 2,
        sort: 'date',
      });

      const mockInteraction = createMockButtonInteraction('character::list::2::date');

      await handleButton(mockInteraction);

      expect(listModule.handleListPagination).toHaveBeenCalledWith(
        mockInteraction,
        2,
        'date',
        expect.any(Object)
      );
    });

    it('should handle sort toggle button and reset to page 0', async () => {
      vi.mocked(customIds.CharacterCustomIds.parse).mockReturnValue({
        action: 'sort',
        page: 3,
        sort: 'name',
      });

      const mockInteraction = createMockButtonInteraction('character::sort::3::name');

      await handleButton(mockInteraction);

      // Sort action should reset to page 0
      expect(listModule.handleListPagination).toHaveBeenCalledWith(
        mockInteraction,
        0,
        'name',
        expect.any(Object)
      );
    });

    it('should handle view pagination button', async () => {
      vi.mocked(customIds.CharacterCustomIds.parse).mockReturnValue({
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

    it('should handle close button', async () => {
      vi.mocked(customIds.CharacterCustomIds.parse).mockReturnValue(null);
      vi.mocked(dashboardUtils.parseDashboardCustomId).mockReturnValue({
        entityType: 'character',
        action: 'close',
        entityId: 'test-char',
      });

      const mockSessionManager = {
        get: vi.fn(),
        set: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      };
      vi.mocked(dashboardUtils.getSessionManager).mockReturnValue(mockSessionManager as any);

      const mockInteraction = createMockButtonInteraction('character::close::test-char');

      await handleButton(mockInteraction);

      expect(mockSessionManager.delete).toHaveBeenCalledWith('user-123', 'character', 'test-char');
      expect(mockInteraction.update).toHaveBeenCalledWith({
        content: expect.stringContaining('Dashboard closed'),
        embeds: [],
        components: [],
      });
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
    it('should return true for character dashboard customId', () => {
      vi.mocked(dashboardUtils.isDashboardInteraction).mockReturnValue(true);

      expect(isCharacterDashboardInteraction('character::menu::test')).toBe(true);
      expect(dashboardUtils.isDashboardInteraction).toHaveBeenCalledWith(
        'character::menu::test',
        'character'
      );
    });

    it('should return false for non-character customId', () => {
      vi.mocked(dashboardUtils.isDashboardInteraction).mockReturnValue(false);

      expect(isCharacterDashboardInteraction('persona::menu::test')).toBe(false);
    });
  });
});
