import { describe, it, expect, vi } from 'vitest';
import type { ReferencedMessage } from '@tzurot/common-types/types/schemas/message';
import type { RawAssemblyInputs } from '@tzurot/common-types/types/schemas/rawEnvelope';
import type { UserMentionDeps } from '@tzurot/common-types/utils/mentionRewriter';
import { rewriteRawContent } from './contentRewriter.js';

const USER_ID = '567890123456789012';
const CHANNEL_ID = '123456789012345678';
const ROLE_ID = '345678901234567890';

function makeDeps(overrides: Partial<UserMentionDeps> = {}): UserMentionDeps {
  return {
    getOrCreateUser: vi.fn().mockResolvedValue({ userId: 'internal-1' }),
    resolvePersona: vi.fn().mockResolvedValue({ personaId: 'persona-1', preferredName: 'Vee' }),
    findUserByDiscordId: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

function rawRef(referenceNumber: number, discordMessageId: string): ReferencedMessage {
  return {
    referenceNumber,
    discordMessageId,
    discordUserId: 'u1',
    authorUsername: 'a',
    authorDisplayName: 'A',
    content: 'ref',
    embeds: '',
    timestamp: '2026-06-01T00:00:00.000Z',
    locationContext: '',
  };
}

function raw(partial: Partial<RawAssemblyInputs> = {}): RawAssemblyInputs {
  return { rawMessageContent: 'hello', ...partial };
}

describe('rewriteRawContent', () => {
  it('passes plain content through untouched', async () => {
    const result = await rewriteRawContent({
      raw: raw(),
      rawReferences: undefined,
      personalityId: 'pers-1',
      deps: makeDeps(),
    });
    expect(result.messageContent).toBe('hello');
    expect(result.mentionedPersonas).toBeUndefined();
    expect(result.referencedChannels).toBeUndefined();
  });

  it('treats EMPTY raw references like ABSENT for link rewriting (nothing to map)', async () => {
    const url =
      'https://discord.com/channels/111111111111111111/222222222222222222/333333333333333333';
    const result = await rewriteRawContent({
      raw: raw({ rawMessageContent: `see ${url}` }),
      rawReferences: [],
      personalityId: 'pers-1',
      deps: makeDeps(),
    });
    expect(result.messageContent).toBe(`see ${url}`);
  });

  it('replaces message links with [Reference N] from wire-adopted numbers', async () => {
    const url =
      'https://discord.com/channels/111111111111111111/222222222222222222/333333333333333333';
    const result = await rewriteRawContent({
      raw: raw({ rawMessageContent: `look at ${url} please` }),
      rawReferences: [rawRef(2, '333333333333333333')],
      personalityId: 'pers-1',
      deps: makeDeps(),
    });
    expect(result.messageContent).toBe('look at [Reference 2] please');
  });

  it('leaves links untouched when no reference carries their message id', async () => {
    const url =
      'https://discord.com/channels/111111111111111111/222222222222222222/444444444444444444';
    const result = await rewriteRawContent({
      raw: raw({ rawMessageContent: `see ${url}` }),
      rawReferences: [rawRef(1, 'different-id')],
      personalityId: 'pers-1',
      deps: makeDeps(),
    });
    expect(result.messageContent).toBe(`see ${url}`);
  });

  it('last reference number wins per message id (multi-snapshot forwards)', async () => {
    const url =
      'https://discord.com/channels/111111111111111111/222222222222222222/333333333333333333';
    const result = await rewriteRawContent({
      raw: raw({ rawMessageContent: url }),
      // Two snapshot refs sharing the forward container's message id.
      rawReferences: [rawRef(1, '333333333333333333'), rawRef(2, '333333333333333333')],
      personalityId: 'pers-1',
      deps: makeDeps(),
    });
    expect(result.messageContent).toBe('[Reference 2]');
  });

  it('resolves user mentions from rawMentionedUsers and emits mentionedPersonas', async () => {
    const deps = makeDeps();
    const result = await rewriteRawContent({
      raw: raw({
        rawMessageContent: `hey <@${USER_ID}>`,
        rawMentionedUsers: [{ discordId: USER_ID, username: 'someone', displayName: 'Someone' }],
      }),
      rawReferences: undefined,
      personalityId: 'pers-1',
      deps,
    });
    expect(result.messageContent).toBe('hey @Vee');
    expect(result.mentionedPersonas).toEqual([{ personaId: 'persona-1', personaName: 'Vee' }]);
    expect(deps.getOrCreateUser).toHaveBeenCalledWith(
      USER_ID,
      'someone',
      'Someone',
      undefined,
      false
    );
  });

  it('rewrites channel and role mentions from the capture-time raw lists', async () => {
    const result = await rewriteRawContent({
      raw: raw({
        rawMessageContent: `see <#${CHANNEL_ID}> and ping <@&${ROLE_ID}>`,
        rawMentionedChannels: [
          { channelId: CHANNEL_ID, channelName: 'general', topic: 'chat', guildId: 'g1' },
        ],
        rawMentionedRoles: [{ roleId: ROLE_ID, roleName: 'Mods', mentionable: true }],
      }),
      rawReferences: undefined,
      personalityId: 'pers-1',
      deps: makeDeps(),
    });
    expect(result.messageContent).toBe('see #general and ping @Mods');
    expect(result.referencedChannels).toEqual([
      { channelId: CHANNEL_ID, channelName: 'general', topic: 'chat', guildId: 'g1' },
    ]);
  });

  it('substitutes placeholders for in-content ids absent from the raw lists', async () => {
    const result = await rewriteRawContent({
      raw: raw({
        rawMessageContent: `see <#${CHANNEL_ID}>`,
        // Capture resolved nothing (channel wasn't in the guild cache).
        rawMentionedChannels: [],
      }),
      rawReferences: undefined,
      personalityId: 'pers-1',
      deps: makeDeps(),
    });
    expect(result.messageContent).toBe('see #unknown-channel');
    expect(result.referencedChannels).toBeUndefined();
  });

  it('applies the full pipeline in bot order: links, users, channels, roles', async () => {
    const url =
      'https://discord.com/channels/111111111111111111/222222222222222222/333333333333333333';
    const result = await rewriteRawContent({
      raw: raw({
        rawMessageContent: `${url} <@${USER_ID}> <#${CHANNEL_ID}> <@&${ROLE_ID}>`,
        rawMentionedUsers: [{ discordId: USER_ID, username: 'someone', displayName: 'Someone' }],
        rawMentionedChannels: [{ channelId: CHANNEL_ID, channelName: 'general' }],
        rawMentionedRoles: [{ roleId: ROLE_ID, roleName: 'Mods' }],
      }),
      rawReferences: [rawRef(1, '333333333333333333')],
      personalityId: 'pers-1',
      deps: makeDeps(),
    });
    expect(result.messageContent).toBe('[Reference 1] @Vee #general @Mods');
  });
});
