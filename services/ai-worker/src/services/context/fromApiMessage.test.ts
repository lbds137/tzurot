import { describe, it, expect } from 'vitest';
import { type RawAssemblyInputs } from '@tzurot/common-types/types/schemas/rawEnvelope';
import { fromApiMessage } from './fromApiMessage.js';

type RawMsg = NonNullable<RawAssemblyInputs['rawExtendedContextMessages']>[number];

// Minimal raw message; individual tests override the fields under test.
const baseMsg = (overrides: Partial<RawMsg> = {}): RawMsg =>
  ({
    role: 'user',
    content: 'hello',
    id: 'msg-1',
    personaId: 'persona-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    discordMessageId: ['discord-1'],
    ...overrides,
  }) as RawMsg;

describe('fromApiMessage', () => {
  it('carries channelId/guildId through and preserves populated fields', () => {
    const result = fromApiMessage(baseMsg(), 'chan-1', 'guild-1');

    expect(result.channelId).toBe('chan-1');
    expect(result.guildId).toBe('guild-1');
    expect(result.id).toBe('msg-1');
    expect(result.personaId).toBe('persona-1');
    expect(result.discordMessageId).toEqual(['discord-1']);
    expect(result.createdAt).toEqual(new Date('2026-01-01T00:00:00.000Z'));
  });

  it('accepts a null guildId (DM context)', () => {
    const result = fromApiMessage(baseMsg(), 'chan-1', null);
    expect(result.guildId).toBeNull();
  });

  it('defaults missing id/personaId to empty string (diff-normalization parity)', () => {
    const result = fromApiMessage(
      baseMsg({ id: undefined, personaId: undefined }),
      'chan-1',
      'guild-1'
    );
    expect(result.id).toBe('');
    expect(result.personaId).toBe('');
  });

  it('falls back to epoch-0 when createdAt is undefined', () => {
    const result = fromApiMessage(baseMsg({ createdAt: undefined }), 'chan-1', 'guild-1');
    expect(result.createdAt).toEqual(new Date(0));
  });

  it('defaults missing discordMessageId to an empty array', () => {
    const result = fromApiMessage(baseMsg({ discordMessageId: undefined }), 'chan-1', 'guild-1');
    expect(result.discordMessageId).toEqual([]);
  });
});
