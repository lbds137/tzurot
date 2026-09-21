/**
 * Tests for embedShapeDiagnostics
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIEmbed } from 'discord.js';
import { logEmptyEmbedShape } from './embedShapeDiagnostics.js';

const { warnMock } = vi.hoisted(() => ({ warnMock: vi.fn() }));

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: warnMock,
      error: vi.fn(),
    }),
  };
});

describe('embedShapeDiagnostics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs the embed key names and type when no messageId is available', () => {
    const embed: APIEmbed = { title: 'Some Title', description: 'Some Description' };

    logEmptyEmbedShape(embed);

    expect(warnMock).toHaveBeenCalledTimes(1);
    const [payload] = warnMock.mock.calls[0] as [Record<string, unknown>, string];
    expect(Object.keys(payload).sort()).toEqual(['embedKeys', 'embedType']);
    expect(payload.embedKeys).toEqual(['description', 'title']);
    expect(payload.embedType).toBeNull();
  });

  it('logs no value drawn from the message', () => {
    const embed = {
      author: { name: '', icon_url: 'https://cdn.example/SECRET_AVATAR.png' },
      footer: { text: '', icon_url: 'https://cdn.example/SECRET_FOOTER.png' },
      image: { url: '' },
      fields: [],
      components: [
        {
          type: 17,
          components: [
            { type: 10, content: 'SECRET_TEXT' },
            { type: 12, items: [{ media: { url: 'https://cdn.example/SECRET_IMAGE.png' } }] },
          ],
        },
      ],
    } as unknown as APIEmbed;

    logEmptyEmbedShape(embed, 'msg-3');

    const [payload] = warnMock.mock.calls[0] as [Record<string, unknown>, string];
    expect(Object.keys(payload).sort()).toEqual(['embedKeys', 'embedType', 'messageId']);

    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('SECRET_AVATAR');
    expect(serialized).not.toContain('SECRET_FOOTER');
    expect(serialized).not.toContain('SECRET_TEXT');
    expect(serialized).not.toContain('SECRET_IMAGE');
  });

  it('omits messageId from the key set when the argument is omitted', () => {
    const embed: APIEmbed = {};

    logEmptyEmbedShape(embed);

    const [payload] = warnMock.mock.calls[0] as [Record<string, unknown>, string];
    expect(Object.keys(payload).sort()).toEqual(['embedKeys', 'embedType']);
  });
});
