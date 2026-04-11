/**
 * Tests for createSettingsCommandHandlers
 *
 * Verifies the shared router factory correctly extracts entity IDs and forwards
 * to the underlying handleSettingsXxx functions. Covers the guard/parse/forward
 * behavior that was previously duplicated across character/overrides.ts,
 * character/settings.ts, and channel/settings.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  ButtonInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';
import type { SettingsDashboardConfig, SettingUpdateHandler } from './types.js';

vi.mock('./types.js', async importOriginal => {
  const actual = await importOriginal<typeof import('./types.js')>();
  return {
    ...actual,
    isSettingsInteraction: vi.fn(),
    parseSettingsCustomId: vi.fn(),
  };
});

vi.mock('./SettingsDashboardHandler.js', () => ({
  handleSettingsSelectMenu: vi.fn(),
  handleSettingsButton: vi.fn(),
  handleSettingsModal: vi.fn(),
}));

// Imports must come AFTER vi.mock calls
import { isSettingsInteraction, parseSettingsCustomId } from './types.js';
import {
  handleSettingsSelectMenu,
  handleSettingsButton,
  handleSettingsModal,
} from './SettingsDashboardHandler.js';
import { createSettingsCommandHandlers } from './createSettingsCommandHandlers.js';

// Test fixtures
const TEST_ENTITY_TYPE = 'character-test';

const testConfig = {
  level: 'user-personality',
  entityType: TEST_ENTITY_TYPE,
  titlePrefix: 'Test',
  color: 0x5865f2,
  settings: [],
} as unknown as SettingsDashboardConfig;

/**
 * A minimal mock for the boundary types of the three interaction types.
 * We never call real discord.js methods — the factory only reads `customId`.
 */
function makeButtonInteraction(customId: string): ButtonInteraction {
  return { customId } as unknown as ButtonInteraction;
}
function makeSelectMenuInteraction(customId: string): StringSelectMenuInteraction {
  return { customId } as unknown as StringSelectMenuInteraction;
}
function makeModalInteraction(customId: string): ModalSubmitInteraction {
  return { customId } as unknown as ModalSubmitInteraction;
}

describe('createSettingsCommandHandlers', () => {
  const mockUpdateHandler: SettingUpdateHandler = vi.fn();
  const mockCreateUpdateHandler = vi.fn(() => mockUpdateHandler);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockCreateUpdateHandler.mockReturnValue(mockUpdateHandler);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isInteraction', () => {
    it('delegates to isSettingsInteraction with the configured entityType', () => {
      vi.mocked(isSettingsInteraction).mockReturnValue(true);

      const handlers = createSettingsCommandHandlers({
        entityType: TEST_ENTITY_TYPE,
        settingsConfig: testConfig,
        createUpdateHandler: mockCreateUpdateHandler,
      });

      const result = handlers.isInteraction('character-test::button::xyz');

      expect(result).toBe(true);
      expect(isSettingsInteraction).toHaveBeenCalledWith(
        'character-test::button::xyz',
        TEST_ENTITY_TYPE
      );
    });

    it('returns false when isSettingsInteraction returns false', () => {
      vi.mocked(isSettingsInteraction).mockReturnValue(false);

      const handlers = createSettingsCommandHandlers({
        entityType: TEST_ENTITY_TYPE,
        settingsConfig: testConfig,
        createUpdateHandler: mockCreateUpdateHandler,
      });

      const result = handlers.isInteraction('other-type::button::xyz');

      expect(result).toBe(false);
      expect(isSettingsInteraction).toHaveBeenCalledWith(
        'other-type::button::xyz',
        TEST_ENTITY_TYPE
      );
    });
  });

  describe('handleButton', () => {
    it('forwards to handleSettingsButton with the extracted entityId', async () => {
      vi.mocked(isSettingsInteraction).mockReturnValue(true);
      vi.mocked(parseSettingsCustomId).mockReturnValue({
        entityType: TEST_ENTITY_TYPE,
        action: 'button',
        entityId: 'personality-uuid-123',
      });

      const handlers = createSettingsCommandHandlers({
        entityType: TEST_ENTITY_TYPE,
        settingsConfig: testConfig,
        createUpdateHandler: mockCreateUpdateHandler,
      });
      const interaction = makeButtonInteraction('character-test::button::personality-uuid-123');

      await handlers.handleButton(interaction);

      expect(mockCreateUpdateHandler).toHaveBeenCalledWith('personality-uuid-123');
      expect(handleSettingsButton).toHaveBeenCalledWith(interaction, testConfig, mockUpdateHandler);
    });

    it('returns early without forwarding when isSettingsInteraction returns false', async () => {
      vi.mocked(isSettingsInteraction).mockReturnValue(false);

      const handlers = createSettingsCommandHandlers({
        entityType: TEST_ENTITY_TYPE,
        settingsConfig: testConfig,
        createUpdateHandler: mockCreateUpdateHandler,
      });

      await handlers.handleButton(makeButtonInteraction('other-type::button::xyz'));

      expect(parseSettingsCustomId).not.toHaveBeenCalled();
      expect(mockCreateUpdateHandler).not.toHaveBeenCalled();
      expect(handleSettingsButton).not.toHaveBeenCalled();
    });

    it('returns early when parseSettingsCustomId returns null', async () => {
      vi.mocked(isSettingsInteraction).mockReturnValue(true);
      vi.mocked(parseSettingsCustomId).mockReturnValue(null);

      const handlers = createSettingsCommandHandlers({
        entityType: TEST_ENTITY_TYPE,
        settingsConfig: testConfig,
        createUpdateHandler: mockCreateUpdateHandler,
      });

      await handlers.handleButton(makeButtonInteraction('character-test::button::'));

      expect(mockCreateUpdateHandler).not.toHaveBeenCalled();
      expect(handleSettingsButton).not.toHaveBeenCalled();
    });
  });

  describe('handleSelectMenu', () => {
    it('forwards to handleSettingsSelectMenu with the extracted entityId', async () => {
      vi.mocked(isSettingsInteraction).mockReturnValue(true);
      vi.mocked(parseSettingsCustomId).mockReturnValue({
        entityType: TEST_ENTITY_TYPE,
        action: 'select',
        entityId: 'personality-uuid-456',
      });

      const handlers = createSettingsCommandHandlers({
        entityType: TEST_ENTITY_TYPE,
        settingsConfig: testConfig,
        createUpdateHandler: mockCreateUpdateHandler,
      });
      const interaction = makeSelectMenuInteraction('character-test::select::personality-uuid-456');

      await handlers.handleSelectMenu(interaction);

      expect(mockCreateUpdateHandler).toHaveBeenCalledWith('personality-uuid-456');
      expect(handleSettingsSelectMenu).toHaveBeenCalledWith(
        interaction,
        testConfig,
        mockUpdateHandler
      );
    });

    it('returns early when isSettingsInteraction returns false', async () => {
      vi.mocked(isSettingsInteraction).mockReturnValue(false);

      const handlers = createSettingsCommandHandlers({
        entityType: TEST_ENTITY_TYPE,
        settingsConfig: testConfig,
        createUpdateHandler: mockCreateUpdateHandler,
      });

      await handlers.handleSelectMenu(makeSelectMenuInteraction('nope::select::xyz'));

      expect(handleSettingsSelectMenu).not.toHaveBeenCalled();
    });

    it('returns early when parseSettingsCustomId returns null', async () => {
      vi.mocked(isSettingsInteraction).mockReturnValue(true);
      vi.mocked(parseSettingsCustomId).mockReturnValue(null);

      const handlers = createSettingsCommandHandlers({
        entityType: TEST_ENTITY_TYPE,
        settingsConfig: testConfig,
        createUpdateHandler: mockCreateUpdateHandler,
      });

      await handlers.handleSelectMenu(makeSelectMenuInteraction('character-test::select::'));

      expect(mockCreateUpdateHandler).not.toHaveBeenCalled();
      expect(handleSettingsSelectMenu).not.toHaveBeenCalled();
    });
  });

  describe('handleModal', () => {
    it('forwards to handleSettingsModal with the extracted entityId', async () => {
      vi.mocked(isSettingsInteraction).mockReturnValue(true);
      vi.mocked(parseSettingsCustomId).mockReturnValue({
        entityType: TEST_ENTITY_TYPE,
        action: 'modal',
        entityId: 'channel-id-789',
      });

      const handlers = createSettingsCommandHandlers({
        entityType: TEST_ENTITY_TYPE,
        settingsConfig: testConfig,
        createUpdateHandler: mockCreateUpdateHandler,
      });
      const interaction = makeModalInteraction('character-test::modal::channel-id-789');

      await handlers.handleModal(interaction);

      expect(mockCreateUpdateHandler).toHaveBeenCalledWith('channel-id-789');
      expect(handleSettingsModal).toHaveBeenCalledWith(interaction, testConfig, mockUpdateHandler);
    });

    it('returns early when isSettingsInteraction returns false', async () => {
      vi.mocked(isSettingsInteraction).mockReturnValue(false);

      const handlers = createSettingsCommandHandlers({
        entityType: TEST_ENTITY_TYPE,
        settingsConfig: testConfig,
        createUpdateHandler: mockCreateUpdateHandler,
      });

      await handlers.handleModal(makeModalInteraction('nope::modal::xyz'));

      expect(handleSettingsModal).not.toHaveBeenCalled();
    });

    it('returns early when parseSettingsCustomId returns null', async () => {
      vi.mocked(isSettingsInteraction).mockReturnValue(true);
      vi.mocked(parseSettingsCustomId).mockReturnValue(null);

      const handlers = createSettingsCommandHandlers({
        entityType: TEST_ENTITY_TYPE,
        settingsConfig: testConfig,
        createUpdateHandler: mockCreateUpdateHandler,
      });

      await handlers.handleModal(makeModalInteraction('character-test::modal::'));

      expect(mockCreateUpdateHandler).not.toHaveBeenCalled();
      expect(handleSettingsModal).not.toHaveBeenCalled();
    });
  });

  describe('createUpdateHandler invocation', () => {
    it('calls createUpdateHandler exactly once per interaction with the parsed entityId', async () => {
      vi.mocked(isSettingsInteraction).mockReturnValue(true);
      vi.mocked(parseSettingsCustomId).mockReturnValue({
        entityType: TEST_ENTITY_TYPE,
        action: 'button',
        entityId: 'entity-abc',
      });

      const handlers = createSettingsCommandHandlers({
        entityType: TEST_ENTITY_TYPE,
        settingsConfig: testConfig,
        createUpdateHandler: mockCreateUpdateHandler,
      });

      await handlers.handleButton(makeButtonInteraction('character-test::button::entity-abc'));

      expect(mockCreateUpdateHandler).toHaveBeenCalledTimes(1);
      expect(mockCreateUpdateHandler).toHaveBeenCalledWith('entity-abc');
    });
  });
});
