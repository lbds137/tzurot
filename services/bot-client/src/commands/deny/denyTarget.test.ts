import { describe, it, expect, vi } from 'vitest';
import { describeDenyScope, resolveDenyTarget, scopeForSubcommand } from './denyTarget.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';

function createMockContext(
  user: { id: string; username: string; displayName: string } | null,
  options: Record<string, unknown> = {}
): DeferredCommandContext {
  const optionMap = new Map(Object.entries(options));
  return {
    interaction: {
      options: {
        getUser: vi.fn().mockReturnValue(user),
      },
    },
    getOption: vi.fn((name: string) => optionMap.get(name) ?? null),
  } as unknown as DeferredCommandContext;
}

describe('scopeForSubcommand', () => {
  it('maps each scope subcommand name to its denial scope', () => {
    expect(scopeForSubcommand('everywhere')).toBe('BOT');
    expect(scopeForSubcommand('server')).toBe('BOT');
    expect(scopeForSubcommand('this-server')).toBe('GUILD');
    expect(scopeForSubcommand('channel')).toBe('CHANNEL');
    expect(scopeForSubcommand('character')).toBe('PERSONALITY');
  });

  it('returns null for an unknown or absent subcommand', () => {
    expect(scopeForSubcommand('bogus')).toBeNull();
    expect(scopeForSubcommand(null)).toBeNull();
  });
});

describe('resolveDenyTarget', () => {
  it('derives USER type from a filled user option', () => {
    const context = createMockContext({
      id: '999888777',
      username: 'lbds137',
      displayName: 'Vlad',
    });

    const result = resolveDenyTarget(context);

    expect(result).toEqual({
      ok: true,
      target: {
        type: 'USER',
        discordId: '999888777',
        display: '**Vlad** (@lbds137 · `999888777`)',
      },
    });
  });

  it('derives GUILD type from a filled server option', () => {
    const context = createMockContext(null, { server: '111222333' });

    const result = resolveDenyTarget(context);

    expect(result).toEqual({
      ok: true,
      target: { type: 'GUILD', discordId: '111222333', display: 'server `111222333`' },
    });
  });

  it('trims surrounding whitespace from a pasted server ID', () => {
    const context = createMockContext(null, { server: '  111222333  ' });

    const result = resolveDenyTarget(context);

    expect(result).toEqual({
      ok: true,
      target: { type: 'GUILD', discordId: '111222333', display: 'server `111222333`' },
    });
  });

  it('rejects when neither is supplied', () => {
    const result = resolveDenyTarget(createMockContext(null));

    expect(result).toEqual({
      ok: false,
      message:
        'No target supplied. Pick a `user`, or use the `server` subcommand for a whole server.',
    });
  });

  // handleAdd and handleRemove share this resolver, so a message naming one
  // group's verb hands the wrong command to the other group's caller.
  it('names no group verb in the no-target message, since add and remove share it', () => {
    const result = resolveDenyTarget(createMockContext(null));

    expect(result.ok).toBe(false);
    const message = result.ok ? '' : result.message;
    expect(message).not.toMatch(/\/deny (add|remove)\b/);
  });

  it('treats a whitespace-only server option as absent', () => {
    const result = resolveDenyTarget(createMockContext(null, { server: '   ' }));

    expect(result.ok).toBe(false);
  });

  it('escapes markdown in a server ID so a crafted ID cannot reshape the confirmation', () => {
    const context = createMockContext(null, { server: '111`**not the owner**`222' });

    const result = resolveDenyTarget(context);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.target.display).toBe('server `111\\`\\*\\*not the owner\\*\\*\\`222`');
    }
  });

  it('escapes markdown in a display name so a crafted name cannot reshape the confirmation', () => {
    const context = createMockContext({
      id: '999888777',
      username: 'plain',
      displayName: '**not the owner**',
    });

    const result = resolveDenyTarget(context);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.target.display).toBe('**\\*\\*not the owner\\*\\*** (@plain · `999888777`)');
    }
  });
});

describe('describeDenyScope', () => {
  const noDetails = { channelId: null, character: null };

  it('describes each scope in plain words', () => {
    expect(describeDenyScope('BOT', noDetails)).toBe('everywhere (every server and DM)');
    expect(describeDenyScope('GUILD', noDetails)).toBe('in this server');
    expect(describeDenyScope('CHANNEL', { channelId: 'chan-1', character: null })).toBe(
      'in <#chan-1>'
    );
    expect(describeDenyScope('PERSONALITY', { channelId: null, character: 'lilith' })).toBe(
      'for the character **lilith**'
    );
  });

  it('falls back to generic wording when the detail is missing', () => {
    expect(describeDenyScope('CHANNEL', noDetails)).toBe('in this channel');
    expect(describeDenyScope('PERSONALITY', noDetails)).toBe('for this character');
    expect(describeDenyScope('PERSONALITY', { channelId: null, character: '' })).toBe(
      'for this character'
    );
  });

  it('escapes markdown in a character name', () => {
    expect(describeDenyScope('PERSONALITY', { channelId: null, character: '*lil*' })).toBe(
      'for the character **\\*lil\\***'
    );
  });
});
