/**
 * Tests for messageCharacterLookup (character + sticky-incognito resolution
 * for message context-menu actions).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MessageContextMenuCommandInteraction } from 'discord.js';
import { BOT_FOOTER_TEXT } from '@tzurot/common-types/constants/discord';
import { CATALOG } from '../ux/catalog/catalog.js';
import { renderSpec } from '../ux/render/render.js';
import type { lookupPersonalityFromMessage } from './gatewayServiceCalls.js';
import {
  footerIsIncognito,
  NOT_A_CHARACTER_MESSAGE,
  resolveMessageCharacter,
  resolveMessageCharacterOrReply,
} from './messageCharacterLookup.js';

type LookupRow = NonNullable<Awaited<ReturnType<typeof lookupPersonalityFromMessage>>>;

const lookupMock = vi.hoisted(() => vi.fn());
vi.mock('./gatewayServiceCalls.js', () => ({
  lookupPersonalityFromMessage: lookupMock,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('footerIsIncognito', () => {
  it('returns true when the message content carries the incognito footer line', () => {
    const content = `Hello there!\n-# ${BOT_FOOTER_TEXT.INCOGNITO_MODE}`;
    expect(footerIsIncognito(content)).toBe(true);
    // Second consecutive call pins that /g lastIndex state is not shared.
    expect(footerIsIncognito(content)).toBe(true);
  });

  it('returns false when the message content has no incognito footer', () => {
    expect(footerIsIncognito('Hello there!\n-# 🌱 Fresh Mode • Memories not being used')).toBe(
      false
    );
  });
});

describe('resolveMessageCharacter', () => {
  it('returns null when the gateway lookup finds no row (404)', async () => {
    lookupMock.mockResolvedValue(null);

    const result = await resolveMessageCharacter({
      id: '123456789012345678',
      content: 'User message',
    });

    expect(result).toBeNull();
    expect(lookupMock).toHaveBeenCalledWith('123456789012345678');
  });

  it('returns null when the lookup row has no personalitySlug', async () => {
    lookupMock.mockResolvedValue({
      personalityId: 'pers-1',
      personalityName: 'Lila',
      personalitySlug: undefined,
      role: 'assistant',
      incognito: true,
    } satisfies LookupRow);

    const result = await resolveMessageCharacter({
      id: '123456789012345678',
      content: 'Reply',
    });

    expect(result).toBeNull();
  });

  it('returns null when the lookup row is a user message (non-assistant role)', async () => {
    lookupMock.mockResolvedValue({
      personalityId: 'pers-1',
      personalityName: 'Lila',
      personalitySlug: 'lila',
      role: 'user',
      incognito: false,
    } satisfies LookupRow);

    const result = await resolveMessageCharacter({
      id: '123456789012345678',
      content: 'User question',
    });

    expect(result).toBeNull();
  });

  it('uses row.incognito=true from the DB when present (even without footer)', async () => {
    lookupMock.mockResolvedValue({
      personalityId: 'pers-1',
      personalityName: 'Lila',
      personalitySlug: 'lila',
      role: 'assistant',
      incognito: true,
    } satisfies LookupRow);

    const result = await resolveMessageCharacter({
      id: '123456789012345678',
      content: 'Reply without footer',
    });

    expect(result).toEqual({
      personalityId: 'pers-1',
      personalityName: 'Lila',
      personalitySlug: 'lila',
      incognito: true,
    });
  });

  it('row.incognito null + footer present → true (fallback to rendered footer)', async () => {
    lookupMock.mockResolvedValue({
      personalityId: 'pers-1',
      personalityName: 'Lila',
      personalitySlug: 'lila',
      role: 'assistant',
      incognito: null,
      triggerMemoryExists: true,
    } satisfies LookupRow);

    const result = await resolveMessageCharacter({
      id: '123456789012345678',
      content: `Legacy reply\n-# ${BOT_FOOTER_TEXT.INCOGNITO_MODE}`,
    });

    expect(result).toEqual({
      personalityId: 'pers-1',
      personalityName: 'Lila',
      personalitySlug: 'lila',
      incognito: true,
    });
  });

  it('row.incognito false + footer present → false (DB wins over message content)', async () => {
    lookupMock.mockResolvedValue({
      personalityId: 'pers-1',
      personalityName: 'Lila',
      personalitySlug: 'lila',
      role: 'assistant',
      incognito: false,
    } satisfies LookupRow);

    const result = await resolveMessageCharacter({
      id: '123456789012345678',
      content: `Quoted footer\n-# ${BOT_FOOTER_TEXT.INCOGNITO_MODE}`,
    });

    expect(result).toEqual({
      personalityId: 'pers-1',
      personalityName: 'Lila',
      personalitySlug: 'lila',
      incognito: false,
    });
  });

  it('legacy row, no footer, trigger memory exists → false (forwards includeIncognitoEvidence when needIncognito: true)', async () => {
    lookupMock.mockResolvedValue({
      personalityId: 'pers-1',
      personalityName: 'Lila',
      personalitySlug: 'lila',
      role: 'assistant',
      incognito: null,
      triggerMemoryExists: true,
    } satisfies LookupRow);

    const result = await resolveMessageCharacter(
      {
        id: '123456789012345678',
        content: 'Legacy non-incognito reply',
      },
      { needIncognito: true }
    );

    expect(lookupMock).toHaveBeenCalledWith('123456789012345678', {
      includeIncognitoEvidence: true,
    });
    expect(result).toEqual({
      personalityId: 'pers-1',
      personalityName: 'Lila',
      personalitySlug: 'lila',
      incognito: false,
    });
  });

  it('legacy, no footer, no memory (triggerMemoryExists=false) → true (fails toward privacy)', async () => {
    lookupMock.mockResolvedValue({
      personalityId: 'pers-1',
      personalityName: 'Lila',
      personalitySlug: 'lila',
      role: 'assistant',
      incognito: null,
      triggerMemoryExists: false,
    } satisfies LookupRow);

    const result = await resolveMessageCharacter({
      id: '123456789012345678',
      content: 'Non-final chunk of legacy incognito reply',
    });

    expect(result).toEqual({
      personalityId: 'pers-1',
      personalityName: 'Lila',
      personalitySlug: 'lila',
      incognito: true,
    });
  });

  it('legacy, no footer, triggerMemoryExists absent → true (fails toward privacy)', async () => {
    lookupMock.mockResolvedValue({
      personalityId: 'pers-1',
      personalityName: 'Lila',
      personalitySlug: 'lila',
      role: 'assistant',
      incognito: null,
    } satisfies LookupRow);

    const result = await resolveMessageCharacter({
      id: '123456789012345678',
      content: 'Legacy reply without trigger memory signal',
    });

    expect(result).toEqual({
      personalityId: 'pers-1',
      personalityName: 'Lila',
      personalitySlug: 'lila',
      incognito: true,
    });
  });
});

describe('resolveMessageCharacterOrReply', () => {
  it('returns the resolved character without calling editReply on a valid assistant message', async () => {
    lookupMock.mockResolvedValue({
      personalityId: 'pers-1',
      personalityName: 'Lila',
      personalitySlug: 'lila',
      role: 'assistant',
      incognito: false,
    } satisfies LookupRow);
    const editReply = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      targetMessage: { id: '123456789012345678', content: 'Hello' },
      editReply,
    } as unknown as MessageContextMenuCommandInteraction;

    const result = await resolveMessageCharacterOrReply(interaction);

    expect(result).toEqual({
      personalityId: 'pers-1',
      personalityName: 'Lila',
      personalitySlug: 'lila',
      incognito: false,
    });
    expect(editReply).not.toHaveBeenCalled();
  });

  it('edits the deferred reply with the exact validation error and returns null when resolution fails', async () => {
    lookupMock.mockResolvedValue(null);
    const editReply = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      targetMessage: { id: '123456789012345678', content: 'Not a character message' },
      editReply,
    } as unknown as MessageContextMenuCommandInteraction;

    const result = await resolveMessageCharacterOrReply(interaction);

    expect(result).toBeNull();
    expect(editReply).toHaveBeenCalledTimes(1);
    expect(editReply).toHaveBeenCalledWith({
      content: renderSpec(CATALOG.error.validation(NOT_A_CHARACTER_MESSAGE)),
    });
  });
});
