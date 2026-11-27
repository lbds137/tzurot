/**
 * Tests for the "Chime In" message context-menu command.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApplicationCommandType, type MessageContextMenuCommandInteraction } from 'discord.js';
import { BOT_FOOTER_TEXT } from '@tzurot/common-types/constants/discord';
import chimeInMessageCommand from './chimeInMessage.js';

const lookupMock = vi.hoisted(() => vi.fn());
vi.mock('../utils/gatewayServiceCalls.js', () => ({
  lookupPersonalityFromMessage: lookupMock,
}));

const runCharacterTurnMock = vi.hoisted(() => vi.fn());
vi.mock('../services/character/characterTurn.js', () => ({
  runCharacterTurn: runCharacterTurnMock,
}));

function makeInteraction(
  overrides: { targetId?: string; content?: string } = {}
): MessageContextMenuCommandInteraction {
  const targetId = overrides.targetId ?? '123456789012345678';
  const content = overrides.content ?? 'Character reply';
  return {
    targetId,
    targetMessage: { id: targetId, content },
    user: { id: 'user-1', displayName: 'Alice' },
    guild: { id: 'guild-1' },
    guildId: 'guild-1',
    member: { displayName: 'Alice' },
    channel: { id: 'chan-1' },
    channelId: 'chan-1',
    commandName: 'Chime In',
    editReply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
    deleteReply: vi.fn().mockResolvedValue(undefined),
  } as unknown as MessageContextMenuCommandInteraction;
}

beforeEach(() => {
  vi.clearAllMocks();
  runCharacterTurnMock.mockResolvedValue(undefined);
});

describe('Chime In context-menu command', () => {
  it('declares a MESSAGE-type context-menu command named "Chime In"', () => {
    const json = chimeInMessageCommand.data.toJSON();
    expect(json.name).toBe('Chime In');
    expect(json.type).toBe(ApplicationCommandType.Message);
  });

  it('incognito reply → incognito turn: carries incognito=true from history into runCharacterTurn', async () => {
    lookupMock.mockResolvedValue({
      personalityId: 'pers-1',
      personalityName: 'Lila',
      personalitySlug: 'lila',
      role: 'assistant',
      incognito: true,
    });
    const interaction = makeInteraction();

    await chimeInMessageCommand.execute(interaction);

    expect(lookupMock).toHaveBeenCalledWith('123456789012345678', {
      includeIncognitoEvidence: true,
    });
    expect(runCharacterTurnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: 'chan-1',
        guildId: 'guild-1',
        isEphemeral: true,
      }),
      {
        characterArg: 'lila',
        message: null,
        filters: { excludePrivate: false, onlyMine: false },
        incognitoOption: true,
      }
    );
  });

  it('non-incognito reply → non-incognito turn: carries incognito=false from history into runCharacterTurn', async () => {
    lookupMock.mockResolvedValue({
      personalityId: 'pers-1',
      personalityName: 'Lila',
      personalitySlug: 'lila',
      role: 'assistant',
      incognito: false,
    });
    const interaction = makeInteraction();

    await chimeInMessageCommand.execute(interaction);

    expect(runCharacterTurnMock).toHaveBeenCalledWith(expect.anything(), {
      characterArg: 'lila',
      message: null,
      filters: { excludePrivate: false, onlyMine: false },
      incognitoOption: false,
    });
  });

  it('falls back to the clicked message footer when row.incognito is null', async () => {
    lookupMock.mockResolvedValue({
      personalityId: 'pers-1',
      personalityName: 'Lila',
      personalitySlug: 'lila',
      role: 'assistant',
      incognito: null,
      triggerMemoryExists: true,
    });
    const interaction = makeInteraction({
      content: `Old incognito reply\n-# ${BOT_FOOTER_TEXT.INCOGNITO_MODE}`,
    });

    await chimeInMessageCommand.execute(interaction);

    expect(runCharacterTurnMock).toHaveBeenCalledWith(expect.anything(), {
      characterArg: 'lila',
      message: null,
      filters: { excludePrivate: false, onlyMine: false },
      incognitoOption: true,
    });
  });

  it('renders an ephemeral error and does not call runCharacterTurn on a non-character message (lookup 404)', async () => {
    lookupMock.mockResolvedValue(null);
    const interaction = makeInteraction();

    await chimeInMessageCommand.execute(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining("That message isn't from a character"),
    });
    expect(runCharacterTurnMock).not.toHaveBeenCalled();
  });

  it('renders an ephemeral error and does not call runCharacterTurn on a user-role history row', async () => {
    lookupMock.mockResolvedValue({
      personalityId: 'pers-1',
      personalityName: 'Lila',
      personalitySlug: 'lila',
      role: 'user',
      incognito: false,
    });
    const interaction = makeInteraction();

    await chimeInMessageCommand.execute(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining("That message isn't from a character"),
    });
    expect(runCharacterTurnMock).not.toHaveBeenCalled();
  });

  it('renders an ephemeral error and does not call runCharacterTurn when the lookup row has no slug', async () => {
    lookupMock.mockResolvedValue({
      personalityId: 'pers-1',
      personalityName: 'Lila',
      personalitySlug: undefined,
      role: 'assistant',
      incognito: false,
    });
    const interaction = makeInteraction();

    await chimeInMessageCommand.execute(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining("That message isn't from a character"),
    });
    expect(runCharacterTurnMock).not.toHaveBeenCalled();
  });
});
