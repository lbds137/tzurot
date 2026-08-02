import { describe, expect, it } from 'vitest';
import { StickerFormatType, type Message, type Sticker } from 'discord.js';
import {
  extractSnapshotStickerImages,
  extractStickerImages,
  isRasterizableSticker,
  stickersToAttachments,
} from './stickerAttachments.js';

interface StickerFixture {
  id: string;
  name: string;
  format: StickerFormatType;
  url: string;
}

/**
 * The slice of a sticker this module reads. Narrow on purpose — a full `Sticker`
 * mock would assert nothing extra and would hide which fields the conversion
 * actually depends on.
 */
function sticker(overrides: Partial<StickerFixture> & { id: string }): StickerFixture {
  return {
    name: `sticker-${overrides.id}`,
    format: StickerFormatType.PNG,
    url: `https://cdn.discordapp.com/stickers/${overrides.id}.png`,
    ...overrides,
  };
}

function messageWith(opts: {
  stickers?: StickerFixture[];
  snapshotStickers?: StickerFixture[][];
}): Message {
  const toMap = (list: StickerFixture[]): Map<string, StickerFixture> =>
    new Map(list.map(s => [s.id, s]));

  return {
    stickers: toMap(opts.stickers ?? []),
    messageSnapshots: new Map(
      (opts.snapshotStickers ?? []).map((list, i) => [String(i), { stickers: toMap(list) }])
    ),
  } as unknown as Message;
}

describe('isRasterizableSticker', () => {
  it.each([
    ['PNG', StickerFormatType.PNG, true],
    ['APNG', StickerFormatType.APNG, true],
    ['GIF', StickerFormatType.GIF, true],
    ['Lottie', StickerFormatType.Lottie, false],
  ])('%s → %s', (_label, format, expected) => {
    expect(isRasterizableSticker({ format } as unknown as Sticker)).toBe(expected);
  });

  it('treats an unknown future format as NOT rasterizable', () => {
    // The check enumerates known raster formats rather than excluding Lottie, so
    // a new Discord vector format defaults to safe instead of feeding a
    // non-image document to the vision pipeline.
    expect(isRasterizableSticker({ format: 99 } as unknown as Sticker)).toBe(false);
  });
});

describe('extractStickerImages', () => {
  it('returns undefined when the message has no stickers', () => {
    // undefined rather than [] — matches extractEmbedImages so both spread alike.
    expect(extractStickerImages(messageWith({}))).toBeUndefined();
  });

  it('returns undefined when every sticker is un-rasterizable', () => {
    const message = messageWith({
      stickers: [sticker({ id: '1', format: StickerFormatType.Lottie })],
    });
    expect(extractStickerImages(message)).toBeUndefined();
  });

  it('carries the sticker snowflake as the attachment id (the cache identity)', () => {
    const message = messageWith({ stickers: [sticker({ id: '111222333444555666' })] });

    const result = extractStickerImages(message);

    expect(result).toHaveLength(1);
    // The snowflake is what makes the description permanently reusable — a
    // sticker's image can never change without minting a new id.
    expect(result?.[0].id).toBe('111222333444555666');
    expect(result?.[0].isSticker).toBe(true);
  });

  it('uses the sticker name and its CDN url', () => {
    const message = messageWith({
      stickers: [
        sticker({ id: '7', name: 'partyblob', url: 'https://cdn.discordapp.com/stickers/7.png' }),
      ],
    });

    expect(extractStickerImages(message)?.[0]).toMatchObject({
      name: 'partyblob',
      url: 'https://cdn.discordapp.com/stickers/7.png',
      contentType: 'image/png',
    });
  });

  it('marks a GIF sticker as image/gif and APNG as image/png', () => {
    // APNG is served with a .png extension — it IS a PNG, animated — so only
    // GIF diverges.
    const message = messageWith({
      stickers: [
        sticker({ id: '1', format: StickerFormatType.GIF }),
        sticker({ id: '2', format: StickerFormatType.APNG }),
      ],
    });

    const result = extractStickerImages(message);

    expect(result?.[0].contentType).toBe('image/gif');
    expect(result?.[1].contentType).toBe('image/png');
  });

  it('drops only the un-rasterizable stickers from a mixed message', () => {
    const message = messageWith({
      stickers: [
        sticker({ id: '1', format: StickerFormatType.Lottie }),
        sticker({ id: '2', format: StickerFormatType.PNG }),
      ],
    });

    const result = extractStickerImages(message);

    expect(result).toHaveLength(1);
    expect(result?.[0].id).toBe('2');
  });

  it('includes stickers carried by a forwarded message snapshot', () => {
    // Forwarded messages keep their stickers in snapshots; missing these would
    // silently describe nothing for a forwarded sticker.
    const message = messageWith({
      stickers: [sticker({ id: 'own' })],
      snapshotStickers: [[sticker({ id: 'forwarded' })]],
    });

    const ids = extractStickerImages(message)?.map(a => a.id);

    expect(ids).toEqual(['own', 'forwarded']);
  });
});

describe('extractSnapshotStickerImages', () => {
  // The reference-rendering paths format a forwarded SNAPSHOT directly, without
  // the parent Message that extractStickerImages needs — so this is the shape
  // those call sites actually hold.
  const snapshotWith = (list: StickerFixture[]): { stickers: Map<string, StickerFixture> } => ({
    stickers: new Map(list.map(s => [s.id, s])),
  });

  it('converts a snapshot’s rasterizable stickers', () => {
    const result = extractSnapshotStickerImages(snapshotWith([sticker({ id: '1' })]) as never);

    expect(result).toEqual([
      expect.objectContaining({ id: '1', isSticker: true, contentType: 'image/png' }),
    ]);
  });

  it('returns undefined when the snapshot carries no stickers', () => {
    // undefined, not [] — matches extractEmbedImages so both spread the same way.
    expect(extractSnapshotStickerImages(snapshotWith([]) as never)).toBeUndefined();
  });

  it('returns undefined when the stickers collection is absent entirely', () => {
    expect(extractSnapshotStickerImages({} as never)).toBeUndefined();
    expect(extractSnapshotStickerImages({ stickers: null } as never)).toBeUndefined();
  });

  it('drops Lottie stickers, which have no raster form to describe', () => {
    const result = extractSnapshotStickerImages(
      snapshotWith([
        sticker({ id: 'lottie', format: StickerFormatType.Lottie }),
        sticker({ id: 'png' }),
      ]) as never
    );

    expect(result?.map(a => a.id)).toEqual(['png']);
  });
});

describe('stickersToAttachments', () => {
  it('is the single conversion both extractors share', () => {
    // Pinned directly because the whole point of the kernel is that a live
    // message and a forwarded snapshot cannot drift in how a sticker becomes an
    // attachment — only in how the stickers are collected.
    const one = sticker({ id: 'shared', format: StickerFormatType.GIF });

    expect(stickersToAttachments([one] as never)).toEqual(
      extractSnapshotStickerImages({ stickers: new Map([['shared', one]]) } as never)
    );
  });

  it('uses image/gif only for GIF, image/png for PNG and APNG', () => {
    const result = stickersToAttachments([
      sticker({ id: 'g', format: StickerFormatType.GIF }),
      sticker({ id: 'a', format: StickerFormatType.APNG }),
      sticker({ id: 'p', format: StickerFormatType.PNG }),
    ] as never);

    expect(result?.map(a => a.contentType)).toEqual(['image/gif', 'image/png', 'image/png']);
  });
});
