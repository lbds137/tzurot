import { describe, it, expect, vi } from 'vitest';
import { DISCORD_MENTIONS } from '../constants/discord.js';
import {
  resolveUserMentions,
  rewriteChannelMentions,
  rewriteRoleMentions,
  type MentionTargetUser,
  type UserMentionDeps,
} from './mentionRewriter.js';

const USER_ID = '567890123456789012';
const OTHER_ID = '678901234567890123';

function target(partial: Partial<MentionTargetUser> = {}): MentionTargetUser {
  return {
    discordId: USER_ID,
    username: 'someone',
    displayName: 'Someone',
    isBot: false,
    ...partial,
  };
}

function makeDeps(overrides: Partial<UserMentionDeps> = {}): UserMentionDeps {
  return {
    getOrCreateUser: vi.fn().mockResolvedValue({ userId: 'internal-1' }),
    resolvePersona: vi.fn().mockResolvedValue({ personaId: 'persona-1', preferredName: 'Vee' }),
    findUserByDiscordId: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

describe('resolveUserMentions', () => {
  it('returns content unchanged when there are no mentions', async () => {
    const deps = makeDeps();
    const result = await resolveUserMentions('plain text', new Map(), 'pers-1', deps);
    expect(result.processedContent).toBe('plain text');
    expect(result.mentionedUsers).toEqual([]);
    expect(deps.getOrCreateUser).not.toHaveBeenCalled();
  });

  it('replaces both mention formats for an in-map target with the persona name', async () => {
    const deps = makeDeps();
    const result = await resolveUserMentions(
      `hey <@${USER_ID}> and again <@!${USER_ID}>`,
      new Map([[USER_ID, target()]]),
      'pers-1',
      deps
    );
    expect(result.processedContent).toBe('hey @Vee and again @Vee');
    expect(result.mentionedUsers).toEqual([
      { discordId: USER_ID, userId: 'internal-1', personaId: 'persona-1', personaName: 'Vee' },
    ]);
    expect(deps.getOrCreateUser).toHaveBeenCalledWith(
      USER_ID,
      'someone',
      'Someone',
      undefined,
      false
    );
  });

  it('falls back to the display name when the persona has no preferred name', async () => {
    const deps = makeDeps({
      resolvePersona: vi.fn().mockResolvedValue({ personaId: 'persona-1', preferredName: null }),
    });
    const result = await resolveUserMentions(
      `<@${USER_ID}>`,
      new Map([[USER_ID, target()]]),
      'pers-1',
      deps
    );
    expect(result.processedContent).toBe('@Someone');
  });

  it('leaves bot mentions untouched (getOrCreateUser returns null)', async () => {
    const deps = makeDeps({ getOrCreateUser: vi.fn().mockResolvedValue(null) });
    const content = `<@${USER_ID}>`;
    const result = await resolveUserMentions(
      content,
      new Map([[USER_ID, target({ isBot: true })]]),
      'pers-1',
      deps
    );
    expect(result.processedContent).toBe(content);
    expect(result.mentionedUsers).toEqual([]);
  });

  it('resolves out-of-map ids via the DB fallback', async () => {
    const deps = makeDeps({
      findUserByDiscordId: vi.fn().mockResolvedValue({ id: 'internal-9', username: 'dbuser' }),
      resolvePersona: vi.fn().mockResolvedValue({ personaId: 'persona-9', preferredName: null }),
    });
    const result = await resolveUserMentions(`<@${OTHER_ID}>`, new Map(), 'pers-1', deps);
    expect(deps.findUserByDiscordId).toHaveBeenCalledWith(OTHER_ID);
    expect(result.processedContent).toBe('@dbuser');
    expect(result.mentionedUsers[0]).toEqual({
      discordId: OTHER_ID,
      userId: 'internal-9',
      personaId: 'persona-9',
      personaName: 'dbuser',
    });
  });

  it('leaves unresolvable mentions raw and continues with the rest', async () => {
    const deps = makeDeps({
      findUserByDiscordId: vi.fn().mockResolvedValue(null),
    });
    const result = await resolveUserMentions(
      `<@${USER_ID}> and <@${OTHER_ID}>`,
      new Map([[USER_ID, target()]]),
      'pers-1',
      deps
    );
    expect(result.processedContent).toBe(`@Vee and <@${OTHER_ID}>`);
    expect(result.mentionedUsers).toHaveLength(1);
  });

  it('caps processing at MAX_PER_MESSAGE unique ids in content order', async () => {
    const ids = Array.from(
      { length: DISCORD_MENTIONS.MAX_PER_MESSAGE + 2 },
      (_, i) => `${100000000000000000n + BigInt(i)}`
    );
    const content = ids.map(id => `<@${id}>`).join(' ');
    const targets = new Map(ids.map(id => [id, target({ discordId: id })]));
    const deps = makeDeps();

    const result = await resolveUserMentions(content, targets, 'pers-1', deps);

    expect(deps.getOrCreateUser).toHaveBeenCalledTimes(DISCORD_MENTIONS.MAX_PER_MESSAGE);
    // Beyond-cap ids stay as raw tags.
    expect(result.processedContent).toContain(`<@${ids[ids.length - 1]}>`);
  });

  it('ignores non-snowflake user ids entirely (no DB fallback round-trip)', async () => {
    const deps = makeDeps();
    const content = 'hi <@1> and <@42>';
    const result = await resolveUserMentions(content, new Map(), 'pers-1', deps);
    expect(result.processedContent).toBe(content);
    expect(deps.findUserByDiscordId).not.toHaveBeenCalled();
  });

  it('swallows DB-fallback lookup errors without failing the batch', async () => {
    const deps = makeDeps({
      findUserByDiscordId: vi.fn().mockRejectedValue(new Error('db down')),
    });
    const content = `<@${OTHER_ID}>`;
    const result = await resolveUserMentions(content, new Map(), 'pers-1', deps);
    expect(result.processedContent).toBe(content);
    expect(result.mentionedUsers).toEqual([]);
  });

  it('swallows per-target resolution errors without failing the batch', async () => {
    const deps = makeDeps({
      getOrCreateUser: vi.fn().mockRejectedValue(new Error('db down')),
    });
    const content = `<@${USER_ID}>`;
    const result = await resolveUserMentions(
      content,
      new Map([[USER_ID, target()]]),
      'pers-1',
      deps
    );
    expect(result.processedContent).toBe(content);
    expect(result.mentionedUsers).toEqual([]);
  });
});

const CHANNEL_ID = '123456789012345678';

describe('rewriteChannelMentions', () => {
  it('returns content unchanged when there are no channel mentions', () => {
    const lookup = vi.fn();
    const result = rewriteChannelMentions('plain text', lookup);
    expect(result.processedContent).toBe('plain text');
    expect(result.mentionedChannels).toEqual([]);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('replaces resolved channels with #name and collects them', () => {
    const result = rewriteChannelMentions(`see <#${CHANNEL_ID}>`, id =>
      id === CHANNEL_ID ? { channelId: id, channelName: 'general', topic: 'chat' } : null
    );
    expect(result.processedContent).toBe('see #general');
    expect(result.mentionedChannels).toEqual([
      { channelId: CHANNEL_ID, channelName: 'general', topic: 'chat' },
    ]);
  });

  it('substitutes the placeholder for unresolvable within-cap channels', () => {
    const result = rewriteChannelMentions(`see <#${CHANNEL_ID}>`, () => null);
    expect(result.processedContent).toBe(`see ${DISCORD_MENTIONS.UNKNOWN_CHANNEL_PLACEHOLDER}`);
    expect(result.mentionedChannels).toEqual([]);
  });

  it('ignores non-snowflake ids entirely', () => {
    const content = 'see <#123>';
    const result = rewriteChannelMentions(content, () => null);
    expect(result.processedContent).toBe(content);
  });

  it('caps at MAX_CHANNELS_PER_MESSAGE, leaving the overflow raw', () => {
    const ids = Array.from(
      { length: DISCORD_MENTIONS.MAX_CHANNELS_PER_MESSAGE + 1 },
      (_, i) => `${200000000000000000n + BigInt(i)}`
    );
    const content = ids.map(id => `<#${id}>`).join(' ');
    const result = rewriteChannelMentions(content, id => ({ channelId: id, channelName: 'c' }));
    expect(result.mentionedChannels).toHaveLength(DISCORD_MENTIONS.MAX_CHANNELS_PER_MESSAGE);
    expect(result.processedContent).toContain(`<#${ids[ids.length - 1]}>`);
  });
});

const ROLE_ID = '345678901234567890';

describe('rewriteRoleMentions', () => {
  it('returns content unchanged when there are no role mentions', () => {
    const result = rewriteRoleMentions('plain text', () => null);
    expect(result.processedContent).toBe('plain text');
    expect(result.mentionedRoles).toEqual([]);
  });

  it('caps at MAX_ROLES_PER_MESSAGE, leaving the overflow raw', () => {
    const ids = Array.from(
      { length: DISCORD_MENTIONS.MAX_ROLES_PER_MESSAGE + 1 },
      (_, i) => `${300000000000000000n + BigInt(i)}`
    );
    const content = ids.map(id => `<@&${id}>`).join(' ');
    const result = rewriteRoleMentions(content, id => ({ roleId: id, roleName: 'r' }));
    expect(result.mentionedRoles).toHaveLength(DISCORD_MENTIONS.MAX_ROLES_PER_MESSAGE);
    expect(result.processedContent).toContain(`<@&${ids[ids.length - 1]}>`);
  });

  it('replaces resolved roles with @name and collects them', () => {
    const result = rewriteRoleMentions(`ping <@&${ROLE_ID}>`, id =>
      id === ROLE_ID ? { roleId: id, roleName: 'Mods', mentionable: true } : null
    );
    expect(result.processedContent).toBe('ping @Mods');
    expect(result.mentionedRoles).toEqual([
      { roleId: ROLE_ID, roleName: 'Mods', mentionable: true },
    ]);
  });

  it('ignores non-snowflake role ids entirely', () => {
    const content = 'ping <@&123>';
    const result = rewriteRoleMentions(content, () => null);
    expect(result.processedContent).toBe(content);
    expect(result.mentionedRoles).toEqual([]);
  });

  it('substitutes the placeholder for unresolvable within-cap roles', () => {
    const result = rewriteRoleMentions(`ping <@&${ROLE_ID}>`, () => null);
    expect(result.processedContent).toBe(`ping ${DISCORD_MENTIONS.UNKNOWN_ROLE_PLACEHOLDER}`);
    expect(result.mentionedRoles).toEqual([]);
  });
});
