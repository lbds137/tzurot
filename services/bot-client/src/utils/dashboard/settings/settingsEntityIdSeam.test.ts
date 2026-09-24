/**
 * Seam test for the compacted settings customId: a click on an id built with a
 * UUID entityId runs the REAL chain — createSettingsCommandHandlers → the
 * settings router → the session lookup and the per-entity update handler —
 * and every consumer receives the canonical UUID, never the compacted
 * segment. Only the Redis-backed SessionManager is mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  ButtonInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import {
  type SettingsDashboardConfig,
  type SettingsDashboardSession,
  type SettingUpdateHandler,
  DashboardView,
  buildSettingsCustomId,
} from './types.js';
import { EXTENDED_CONTEXT_SETTINGS, MEMORY_SETTINGS } from './settingsConfig.js';
import { compactEntityId } from './settingsEntityIdCodec.js';
import { createSettingsCommandHandlers } from './createSettingsCommandHandlers.js';

const mockSessionManager = {
  set: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
};

vi.mock('../SessionManager.js', () => ({
  getSessionManager: vi.fn(() => mockSessionManager),
}));

const ENTITY_TYPE = 'character-overrides';
const PERSONALITY_UUID = '765a9b5a-857f-5822-bc60-37cc8aada4ac';
const USER_ID = 'user-seam-1';

const config: SettingsDashboardConfig = {
  level: 'personality',
  entityType: ENTITY_TYPE,
  titlePrefix: 'Seam',
  color: DISCORD_COLORS.BLURPLE,
  // maxMessages (a modal setting) and shareHistoryAcrossPersonalities (an enum)
  settings: [...EXTENDED_CONTEXT_SETTINGS, ...MEMORY_SETTINGS],
  scopeNote: () => 'seam scope',
};

function makeSession(): SettingsDashboardSession {
  return {
    level: 'personality',
    entityId: PERSONALITY_UUID,
    entityName: 'Seam Character',
    data: {},
    view: DashboardView.OVERVIEW,
    userId: USER_ID,
    messageId: 'message-1',
    channelId: 'channel-1',
    lastActivityAt: new Date(),
  };
}

/** Interaction surface the settings router touches; every responder resolves. */
function makeInteraction(customId: string, extra: Record<string, unknown> = {}): unknown {
  return {
    customId,
    user: { id: USER_ID },
    deferred: false,
    replied: false,
    deferUpdate: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
    ...extra,
  };
}

describe('compacted settings customId → canonical UUID at every consumer', () => {
  const updateHandler = vi.fn<SettingUpdateHandler>();
  const createUpdateHandler = vi.fn((_entityId: string) => updateHandler);

  const handlers = createSettingsCommandHandlers({
    entityType: ENTITY_TYPE,
    settingsConfig: config,
    createUpdateHandler,
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockSessionManager.get.mockImplementation(() => Promise.resolve({ data: makeSession() }));
    updateHandler.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('a set click reaches the session lookup and the update handler with the canonical UUID', async () => {
    const customId = buildSettingsCustomId(
      ENTITY_TYPE,
      'set',
      PERSONALITY_UUID,
      'shareHistoryAcrossPersonalities:guilds-only'
    );
    // Precondition: the click carries the compacted segment, not the raw UUID.
    expect(customId).toContain(compactEntityId(PERSONALITY_UUID));
    expect(customId).not.toContain(PERSONALITY_UUID);
    const interaction = makeInteraction(customId) as ButtonInteraction;

    await handlers.handleButton(interaction);

    expect(mockSessionManager.get).toHaveBeenCalledWith(USER_ID, ENTITY_TYPE, PERSONALITY_UUID);
    expect(createUpdateHandler).toHaveBeenCalledWith(PERSONALITY_UUID);
    expect(updateHandler).toHaveBeenCalledWith(
      interaction,
      expect.objectContaining({ entityId: PERSONALITY_UUID }),
      'shareHistoryAcrossPersonalities',
      'guilds-only'
    );
    // The post-update session write stays keyed by the canonical UUID.
    expect(mockSessionManager.set).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: ENTITY_TYPE, entityId: PERSONALITY_UUID })
    );
  });

  it('a select click reaches the session lookup with the canonical UUID', async () => {
    const customId = buildSettingsCustomId(ENTITY_TYPE, 'select', PERSONALITY_UUID);
    const interaction = makeInteraction(customId, {
      values: ['shareHistoryAcrossPersonalities'],
    }) as StringSelectMenuInteraction;

    await handlers.handleSelectMenu(interaction);

    expect(mockSessionManager.get).toHaveBeenCalledWith(USER_ID, ENTITY_TYPE, PERSONALITY_UUID);
    expect(interaction.editReply).toHaveBeenCalled();
  });

  it('a modal submit reaches the session lookup and the update handler with the canonical UUID', async () => {
    const customId = buildSettingsCustomId(ENTITY_TYPE, 'modal', PERSONALITY_UUID, 'maxMessages');
    const interaction = makeInteraction(customId, {
      fields: { getTextInputValue: vi.fn(() => '42') },
    }) as ModalSubmitInteraction;

    await handlers.handleModal(interaction);

    expect(mockSessionManager.get).toHaveBeenCalledWith(USER_ID, ENTITY_TYPE, PERSONALITY_UUID);
    expect(createUpdateHandler).toHaveBeenCalledWith(PERSONALITY_UUID);
    expect(updateHandler).toHaveBeenCalledWith(
      interaction,
      expect.objectContaining({ entityId: PERSONALITY_UUID }),
      'maxMessages',
      42
    );
  });

  it('a legacy raw-UUID click (rendered before compaction) reaches the same session', async () => {
    const legacyId = `${ENTITY_TYPE}::set::${PERSONALITY_UUID}::shareHistoryAcrossPersonalities:guilds-only`;
    const interaction = makeInteraction(legacyId) as ButtonInteraction;

    await handlers.handleButton(interaction);

    expect(mockSessionManager.get).toHaveBeenCalledWith(USER_ID, ENTITY_TYPE, PERSONALITY_UUID);
    expect(createUpdateHandler).toHaveBeenCalledWith(PERSONALITY_UUID);
  });
});
