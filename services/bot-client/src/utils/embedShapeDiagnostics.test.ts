/**
 * Tests for embedShapeDiagnostics
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIEmbed, Message } from 'discord.js';
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

  it('logs the embed key names and type when no message is available', () => {
    const embed: APIEmbed = { title: 'Some Title', description: 'Some Description' };

    logEmptyEmbedShape(embed);

    expect(warnMock).toHaveBeenCalledTimes(1);
    const [payload] = warnMock.mock.calls[0] as [Record<string, unknown>, string];
    expect(Object.keys(payload).sort()).toEqual(['embedKeys', 'embedType']);
    expect(payload.embedKeys).toEqual(['description', 'title']);
    expect(payload.embedType).toBeNull();
  });

  it('logs the component-type tree when a message is available', () => {
    const embed: APIEmbed = {};
    const message = {
      id: 'msg-1',
      components: [
        {
          type: 17,
          components: [
            { type: 10, content: 'SECRET_TEXT' },
            { type: 12, items: [{ media: { url: 'https://cdn.example/SECRET_IMAGE.png' } }] },
          ],
        },
      ],
    } as unknown as Message;

    logEmptyEmbedShape(embed, message);

    const [payload] = warnMock.mock.calls[0] as [Record<string, unknown>, string];
    expect(payload.components).toEqual([{ type: 17, childCount: 2, childTypes: [10, 12] }]);
  });

  it('summarizes a top-level MediaGallery component with no typed children', () => {
    const embed: APIEmbed = {};
    const message = {
      id: 'msg-2',
      components: [
        {
          type: 12,
          items: [{ media: { url: 'https://cdn.example/SECRET_IMAGE.png' } }],
        },
      ],
    } as unknown as Message;

    logEmptyEmbedShape(embed, message);

    const [payload] = warnMock.mock.calls[0] as [Record<string, unknown>, string];
    expect(payload.components).toEqual([{ type: 12, childCount: 1, childTypes: [] }]);
  });

  it('logs no value drawn from the message', () => {
    const embed: APIEmbed = {
      author: { name: '', icon_url: 'https://cdn.example/SECRET_AVATAR.png' },
      footer: { text: '', icon_url: 'https://cdn.example/SECRET_FOOTER.png' },
      image: { url: '' },
      fields: [],
    };
    const message = {
      id: 'msg-3',
      components: [
        {
          type: 17,
          components: [
            { type: 10, content: 'SECRET_TEXT' },
            { type: 12, items: [{ media: { url: 'https://cdn.example/SECRET_IMAGE.png' } }] },
          ],
        },
      ],
    } as unknown as Message;

    logEmptyEmbedShape(embed, message);

    const [payload] = warnMock.mock.calls[0] as [Record<string, unknown>, string];
    expect(Object.keys(payload).sort()).toEqual([
      'componentCount',
      'components',
      'embedKeys',
      'embedType',
      'messageId',
    ]);

    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('SECRET_AVATAR');
    expect(serialized).not.toContain('SECRET_FOOTER');
    expect(serialized).not.toContain('SECRET_TEXT');
    expect(serialized).not.toContain('SECRET_IMAGE');
  });
});
