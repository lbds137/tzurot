/**
 * Tests for the "Edit Character" message context-menu command.
 *
 * Runs the real `openCharacterEditDashboard` helper and mocks only the external
 * boundaries (gateway lookup, character fetch, dashboard builders, session
 * manager) so permission checks (`canEdit`) and session storage are verified on
 * the context-menu path end-to-end.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ActionRowBuilder,
  ApplicationCommandType,
  EmbedBuilder,
  type MessageContextMenuCommandInteraction,
} from 'discord.js';
import editCharacterMessageCommand from './editCharacterMessage.js';
import * as api from './character/api.js';
import type { FetchedCharacter } from './character/api.js';
import * as dashboardUtils from '../utils/dashboard/index.js';

const lookupMock = vi.hoisted(() => vi.fn());
vi.mock('../utils/gatewayServiceCalls.js', () => ({
  lookupPersonalityFromMessage: lookupMock,
}));

vi.mock('../utils/gatewayClients.js', () => ({
  clientsFor: vi.fn(() => ({ userClient: { stub: true } })),
}));

vi.mock('@tzurot/common-types/config/config', () => ({
  getConfig: vi.fn(() => ({ GATEWAY_URL: 'http://localhost:3000' })),
}));

vi.mock('./character/api.js', () => ({
  fetchCharacter: vi.fn(),
}));

vi.mock('../utils/dashboard/index.js', () => ({
  buildDashboardEmbed: vi.fn(),
  buildDashboardComponents: vi.fn(),
  getSessionManager: vi.fn(),
}));

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

vi.mock('@tzurot/common-types/utils/ownerMiddleware', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/ownerMiddleware')>(
    '@tzurot/common-types/utils/ownerMiddleware'
  );
  return {
    ...actual,
    isBotOwner: vi.fn(() => false),
  };
});

function makeInteraction(targetId = '123456789012345678'): MessageContextMenuCommandInteraction {
  return {
    targetId,
    targetMessage: { id: targetId, content: 'Character reply' },
    user: { id: 'user-123' },
    guild: { id: 'guild-1' },
    guildId: 'guild-1',
    member: null,
    channel: { id: 'channel-456' },
    channelId: 'channel-456',
    commandName: 'Edit Character',
    editReply: vi.fn().mockResolvedValue({ id: 'reply-123' }),
    followUp: vi.fn().mockResolvedValue(undefined),
    deleteReply: vi.fn().mockResolvedValue(undefined),
  } as unknown as MessageContextMenuCommandInteraction;
}

function createMockCharacter(overrides: Record<string, unknown> = {}): FetchedCharacter {
  return {
    id: 'char-uuid-1',
    name: 'Test Character',
    displayName: 'Test Display',
    slug: 'test-character',
    canEdit: true,
    ...overrides,
  } as unknown as FetchedCharacter;
}

beforeEach(() => {
  vi.clearAllMocks();
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

describe('Edit Character context-menu command', () => {
  it('declares a MESSAGE-type context-menu command named "Edit Character"', () => {
    const json = editCharacterMessageCommand.data.toJSON();
    expect(json.name).toBe('Edit Character');
    expect(json.type).toBe(ApplicationCommandType.Message);
  });

  it('opens the character edit dashboard and stores the session when the user can edit', async () => {
    lookupMock.mockResolvedValue({
      personalityId: 'char-uuid-1',
      personalityName: 'Lila',
      personalitySlug: 'lila',
      role: 'assistant',
      incognito: false,
    });
    const mockCharacter = createMockCharacter({ slug: 'lila', canEdit: true });
    vi.mocked(api.fetchCharacter).mockResolvedValue(mockCharacter);

    const mockSessionManager = {
      set: vi.fn(),
      get: vi.fn(),
      delete: vi.fn(),
    };
    vi.mocked(dashboardUtils.getSessionManager).mockReturnValue(mockSessionManager as never);
    const interaction = makeInteraction();

    await editCharacterMessageCommand.execute(interaction);

    expect(lookupMock).toHaveBeenCalledWith('123456789012345678');
    expect(api.fetchCharacter).toHaveBeenCalledWith(
      'lila',
      { GATEWAY_URL: 'http://localhost:3000' },
      { stub: true }
    );
    expect(interaction.editReply).toHaveBeenCalledWith({
      embeds: expect.any(Array),
      components: expect.any(Array),
    });
    expect(mockSessionManager.set).toHaveBeenCalledWith({
      userId: 'user-123',
      entityType: 'character',
      entityId: 'lila',
      data: { ...mockCharacter, _isAdmin: false },
      messageId: 'reply-123',
      channelId: 'channel-456',
    });
  });

  it('refuses with permissionDenied when canEdit is false on the context-menu path', async () => {
    lookupMock.mockResolvedValue({
      personalityId: 'char-uuid-2',
      personalityName: 'Other',
      personalitySlug: 'other-char',
      role: 'assistant',
      incognito: false,
    });
    vi.mocked(api.fetchCharacter).mockResolvedValue(
      createMockCharacter({ slug: 'other-char', canEdit: false })
    );
    const interaction = makeInteraction();

    await editCharacterMessageCommand.execute(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('do not have permission'),
    });
    expect(dashboardUtils.buildDashboardEmbed).not.toHaveBeenCalled();
  });

  it('renders an ephemeral error and does not fetch a character on a non-character message (lookup 404)', async () => {
    lookupMock.mockResolvedValue(null);
    const interaction = makeInteraction();

    await editCharacterMessageCommand.execute(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining("That message isn't from a character"),
    });
    expect(api.fetchCharacter).not.toHaveBeenCalled();
  });

  it('renders an ephemeral error and does not fetch a character when the lookup row has no slug', async () => {
    lookupMock.mockResolvedValue({
      personalityId: 'char-uuid-3',
      personalityName: 'Lila',
      personalitySlug: undefined,
      role: 'assistant',
      incognito: false,
    });
    const interaction = makeInteraction();

    await editCharacterMessageCommand.execute(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining("That message isn't from a character"),
    });
    expect(api.fetchCharacter).not.toHaveBeenCalled();
    expect(dashboardUtils.buildDashboardEmbed).not.toHaveBeenCalled();
  });

  it('runs through the real createContextMenuDeferredContext and execute path with no interaction.options property', async () => {
    lookupMock.mockResolvedValue({
      personalityId: 'char-uuid-1',
      personalityName: 'Lila',
      personalitySlug: 'lila',
      role: 'assistant',
      incognito: false,
    });
    vi.mocked(api.fetchCharacter).mockResolvedValue(
      createMockCharacter({ slug: 'lila', canEdit: true })
    );
    const interaction = makeInteraction();

    expect('options' in (interaction as unknown as Record<string, unknown>)).toBe(false);

    await expect(editCharacterMessageCommand.execute(interaction)).resolves.toBeUndefined();

    expect(interaction.editReply).toHaveBeenCalledWith({
      embeds: expect.any(Array),
      components: expect.any(Array),
    });
  });
});
