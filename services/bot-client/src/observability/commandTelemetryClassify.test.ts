import { describe, it, expect } from 'vitest';
import { classifyChannelKind, classifyErrorCode } from './commandTelemetryClassify.js';
import type { ChatInputCommandInteraction } from 'discord.js';

function makeInteraction(opts: {
  guildId: string | null;
  isThread?: boolean;
}): ChatInputCommandInteraction {
  return {
    guildId: opts.guildId,
    channel: opts.isThread === undefined ? null : { isThread: () => opts.isThread === true },
  } as unknown as ChatInputCommandInteraction;
}

describe('classifyChannelKind', () => {
  it('classifies a guild channel', () => {
    expect(classifyChannelKind(makeInteraction({ guildId: 'g1' }))).toBe('guild');
  });

  it('classifies a DM (no guildId)', () => {
    expect(classifyChannelKind(makeInteraction({ guildId: null }))).toBe('dm');
  });

  it('classifies a thread even though it also carries a guildId', () => {
    expect(classifyChannelKind(makeInteraction({ guildId: 'g1', isThread: true }))).toBe('thread');
  });
});

describe('classifyErrorCode', () => {
  it('returns the constructor name for an Error', () => {
    expect(classifyErrorCode(new TypeError('boom'))).toBe('TypeError');
  });

  it('never leaks the error message', () => {
    expect(classifyErrorCode(new Error('contains user text'))).not.toContain('contains user text');
  });

  it('falls back to UnknownError for a non-Error throw', () => {
    expect(classifyErrorCode('a string throw')).toBe('UnknownError');
  });

  it('truncates a pathologically long constructor name to 100 chars', () => {
    class LongName extends Error {}
    Object.defineProperty(LongName, 'name', { value: 'X'.repeat(200) });
    expect(classifyErrorCode(new LongName())).toHaveLength(100);
  });
});
