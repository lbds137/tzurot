/**
 * Tests for Character Dashboard Action Handlers
 *
 * Tests the action handlers extracted from dashboard.ts:
 * visibility toggle, avatar/voice redirects, and voice toggle.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleAction, refreshDashboardAfterUpdate } from './dashboardActions.js';
import * as api from './api.js';
import * as dashboardUtils from '../../utils/dashboard/index.js';
import type { EnvConfig } from '@tzurot/common-types/config/config';
import type { StringSelectMenuInteraction } from 'discord.js';
import { MessageFlags } from 'discord.js';
import type { FetchedCharacter } from './api.js';

vi.mock('../../utils/gatewayClients.js', () => ({
  clientsFor: vi.fn(() => ({ userClient: {} })),
}));

vi.mock('./api.js', () => ({
  fetchCharacter: vi.fn(),
  updateCharacter: vi.fn(),
  toggleVisibility: vi.fn(),
}));

vi.mock('../../utils/dashboard/index.js', async () => {
  const actual = await vi.importActual('../../utils/dashboard/index.js');
  return {
    ...actual,
    buildDashboardEmbed: vi.fn().mockReturnValue({ data: {} }),
    buildDashboardComponents: vi.fn().mockReturnValue([]),
    getSessionManager: vi.fn().mockReturnValue({
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    }),
  };
});

vi.mock('@tzurot/common-types/config/config', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/config/config')>(
    '@tzurot/common-types/config/config'
  );
  return {
    ...actual,
    getConfig: vi.fn().mockReturnValue({ GATEWAY_URL: 'http://localhost:3000' }),
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

function createMockInteraction(overrides = {}) {
  return {
    user: { id: 'user-123' },
    reply: vi.fn(),
    deferUpdate: vi.fn(),
    editReply: vi.fn(),
    ...overrides,
  } as unknown as StringSelectMenuInteraction;
}

function createMockCharacter(overrides: Partial<FetchedCharacter> = {}): FetchedCharacter {
  return {
    id: 'uuid',
    name: 'Test',
    slug: 'test-char',
    displayName: null,
    isPublic: false,
    definitionPublic: false,
    definitionRedacted: false,
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
    hasVoiceReference: false,
    imageEnabled: false,
    avatarData: null,
    createdAt: '',
    updatedAt: '',
    canEdit: true,
    ...overrides,
  };
}

describe('Dashboard Actions', () => {
  const mockConfig = { GATEWAY_URL: 'http://localhost:3000' } as EnvConfig;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('handleAction - visibility', () => {
    it('should toggle visibility and refresh dashboard', async () => {
      const mockInteraction = createMockInteraction();
      vi.mocked(api.fetchCharacter).mockResolvedValue(createMockCharacter({ isPublic: false }));
      vi.mocked(api.toggleVisibility).mockResolvedValue({
        id: 'uuid',
        slug: 'test-char',
        isPublic: true,
      });

      await handleAction(mockInteraction, 'test-char', 'visibility', mockConfig);

      expect(mockInteraction.deferUpdate).toHaveBeenCalled();
      // Third arg is the `userClient` stub minted by the mocked `clientsFor`.
      // Auth identity now flows through the brand on `userClient`, not the
      // per-call payload, so the assertion is intentionally loose here.
      expect(api.toggleVisibility).toHaveBeenCalledWith(
        'test-char',
        true,
        expect.any(Object),
        mockConfig
      );
      expect(mockInteraction.editReply).toHaveBeenCalled();
    });

    it('should return early if character not found', async () => {
      const mockInteraction = createMockInteraction();
      vi.mocked(api.fetchCharacter).mockResolvedValue(null);

      await handleAction(mockInteraction, 'test-char', 'visibility', mockConfig);

      expect(api.toggleVisibility).not.toHaveBeenCalled();
    });
  });

  describe('handleAction - avatar', () => {
    it('should reply with ephemeral redirect message', async () => {
      const mockInteraction = createMockInteraction();

      await handleAction(mockInteraction, 'test-char', 'avatar', mockConfig);

      expect(mockInteraction.reply).toHaveBeenCalledWith({
        content: expect.stringContaining('/character avatar'),
        flags: MessageFlags.Ephemeral,
      });
    });
  });

  describe('handleAction - voice', () => {
    it('should reply with ephemeral redirect message', async () => {
      const mockInteraction = createMockInteraction();

      await handleAction(mockInteraction, 'test-char', 'voice', mockConfig);

      expect(mockInteraction.reply).toHaveBeenCalledWith({
        content: expect.stringContaining('/character voice'),
        flags: MessageFlags.Ephemeral,
      });
    });

    it('should mention voice-clear in the message', async () => {
      const mockInteraction = createMockInteraction();

      await handleAction(mockInteraction, 'test-char', 'voice', mockConfig);

      expect(mockInteraction.reply).toHaveBeenCalledWith({
        content: expect.stringContaining('/character voice-clear'),
        flags: MessageFlags.Ephemeral,
      });
    });
  });

  describe('handleAction - definition-visibility', () => {
    it('should toggle definitionPublic and refresh dashboard', async () => {
      const mockInteraction = createMockInteraction();
      vi.mocked(api.fetchCharacter).mockResolvedValue(
        createMockCharacter({ definitionPublic: false })
      );
      vi.mocked(api.updateCharacter).mockResolvedValue({
        character: createMockCharacter({ definitionPublic: true }),
        shadowedAliases: [],
      });

      await handleAction(mockInteraction, 'test-char', 'definition-visibility', mockConfig);

      expect(mockInteraction.deferUpdate).toHaveBeenCalled();
      expect(api.updateCharacter).toHaveBeenCalledWith(
        'test-char',
        { definitionPublic: true },
        expect.any(Object),
        expect.any(Object)
      );
      expect(mockInteraction.editReply).toHaveBeenCalled();
    });

    it('should toggle back off from public', async () => {
      const mockInteraction = createMockInteraction();
      vi.mocked(api.fetchCharacter).mockResolvedValue(
        createMockCharacter({ definitionPublic: true })
      );
      vi.mocked(api.updateCharacter).mockResolvedValue({
        character: createMockCharacter({ definitionPublic: false }),
        shadowedAliases: [],
      });

      await handleAction(mockInteraction, 'test-char', 'definition-visibility', mockConfig);

      expect(api.updateCharacter).toHaveBeenCalledWith(
        'test-char',
        { definitionPublic: false },
        expect.any(Object),
        expect.any(Object)
      );
    });

    it('should return early if character not found', async () => {
      const mockInteraction = createMockInteraction();
      vi.mocked(api.fetchCharacter).mockResolvedValue(null);

      await handleAction(mockInteraction, 'test-char', 'definition-visibility', mockConfig);

      expect(api.updateCharacter).not.toHaveBeenCalled();
    });
  });

  describe('handleAction - voice-toggle', () => {
    it('should toggle voiceEnabled and refresh dashboard', async () => {
      const mockInteraction = createMockInteraction();
      vi.mocked(api.fetchCharacter).mockResolvedValue(
        createMockCharacter({ voiceEnabled: true, hasVoiceReference: true })
      );
      vi.mocked(api.updateCharacter).mockResolvedValue({
        character: createMockCharacter({ voiceEnabled: false, hasVoiceReference: true }),
        shadowedAliases: [],
      });

      await handleAction(mockInteraction, 'test-char', 'voice-toggle', mockConfig);

      expect(mockInteraction.deferUpdate).toHaveBeenCalled();
      expect(api.updateCharacter).toHaveBeenCalledWith(
        'test-char',
        { voiceEnabled: false },
        expect.any(Object),
        expect.any(Object)
      );
      expect(mockInteraction.editReply).toHaveBeenCalled();
    });

    it('should return early if character not found', async () => {
      const mockInteraction = createMockInteraction();
      vi.mocked(api.fetchCharacter).mockResolvedValue(null);

      await handleAction(mockInteraction, 'test-char', 'voice-toggle', mockConfig);

      expect(api.updateCharacter).not.toHaveBeenCalled();
    });

    it('should refresh dashboard without updating when voice reference is missing', async () => {
      const mockInteraction = createMockInteraction();
      const character = createMockCharacter({ hasVoiceReference: false, voiceEnabled: false });
      vi.mocked(api.fetchCharacter).mockResolvedValue(character);

      await handleAction(mockInteraction, 'test-char', 'voice-toggle', mockConfig);

      // Should NOT call updateCharacter — the toggle is invalid without a voice reference
      expect(api.updateCharacter).not.toHaveBeenCalled();
      // Should still refresh dashboard (removes the stale toggle button)
      expect(mockInteraction.editReply).toHaveBeenCalled();
    });
  });

  describe('refreshDashboardAfterUpdate', () => {
    it('should rebuild embed and components with updated data', async () => {
      const mockInteraction = createMockInteraction();
      const updated = createMockCharacter({ isPublic: true });

      await refreshDashboardAfterUpdate(mockInteraction, 'test-char', updated);

      expect(dashboardUtils.buildDashboardEmbed).toHaveBeenCalled();
      expect(dashboardUtils.buildDashboardComponents).toHaveBeenCalled();
      expect(mockInteraction.editReply).toHaveBeenCalled();
    });

    it('should update session with preserved context', async () => {
      const mockInteraction = createMockInteraction();
      const updated = createMockCharacter();

      const mockSession = {
        data: { canEdit: true, browseContext: { source: 'browse', page: 1 } },
      };
      vi.mocked(dashboardUtils.getSessionManager().get).mockResolvedValue(mockSession as never);

      await refreshDashboardAfterUpdate(mockInteraction, 'test-char', updated);

      expect(dashboardUtils.getSessionManager().update).toHaveBeenCalledWith(
        'user-123',
        'character',
        'test-char',
        expect.objectContaining({
          canEdit: true,
          browseContext: { source: 'browse', page: 1 },
        })
      );
    });

    it('prefers the update response canEdit over a stale session value', async () => {
      const mockInteraction = createMockInteraction();
      // Fresh response says the user can no longer edit; the stale session
      // still claims true — the authoritative response value must win
      // (`??` falls back only on null/undefined, never on false).
      const updated = { ...createMockCharacter(), canEdit: false };
      const mockSession = { data: { canEdit: true } };
      vi.mocked(dashboardUtils.getSessionManager().get).mockResolvedValue(mockSession as never);

      await refreshDashboardAfterUpdate(mockInteraction, 'test-char', updated);

      expect(dashboardUtils.getSessionManager().update).toHaveBeenCalledWith(
        'user-123',
        'character',
        'test-char',
        expect.objectContaining({ canEdit: false })
      );
    });
  });
});
