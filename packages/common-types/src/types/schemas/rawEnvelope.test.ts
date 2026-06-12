import { describe, it, expect } from 'vitest';
import { rawAssemblyInputsSchema } from './rawEnvelope.js';

describe('rawAssemblyInputsSchema — guild/attachment raw forms', () => {
  const base = { rawMessageContent: 'hello' };

  it('parses an envelope without the raw guild/attachment fields (ABSENT)', () => {
    const result = rawAssemblyInputsSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.rawParticipantGuildInfo).toBeUndefined();
      expect(result.data.rawExtendedContextImageAttachments).toBeUndefined();
      expect(result.data.rawActiveGuildMemberInfo).toBeUndefined();
    }
  });

  it('parses the discord:-keyed guild map, the uncapped image list, and the active scalar', () => {
    const result = rawAssemblyInputsSchema.safeParse({
      ...base,
      rawParticipantGuildInfo: {
        'discord:111': { roles: ['Admin', 'Dev'], displayColor: '#FF00FF' },
      },
      rawExtendedContextImageAttachments: [
        {
          url: 'https://cdn/img.png',
          contentType: 'image/png',
          id: 'a1',
          sourceDiscordMessageId: 'm1',
        },
      ],
      rawActiveGuildMemberInfo: { roles: ['Mod'], joinedAt: '2024-01-01T00:00:00.000Z' },
    });
    expect(result.success).toBe(true);
  });

  it('preserves EMPTY guild map and image list (not collapsed to absent)', () => {
    const result = rawAssemblyInputsSchema.safeParse({
      ...base,
      rawParticipantGuildInfo: {},
      rawExtendedContextImageAttachments: [],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.rawParticipantGuildInfo).toEqual({});
      expect(result.data.rawExtendedContextImageAttachments).toEqual([]);
    }
  });

  it('rejects guild entries exceeding the role cap (shared guildMemberInfoSchema rule)', () => {
    const result = rawAssemblyInputsSchema.safeParse({
      ...base,
      rawActiveGuildMemberInfo: { roles: ['a', 'b', 'c', 'd', 'e', 'f'] },
    });
    expect(result.success).toBe(false);
  });
});
