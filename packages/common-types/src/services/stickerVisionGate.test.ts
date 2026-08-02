import { describe, expect, it, vi } from 'vitest';

const mockGetSystemSetting = vi.fn();
vi.mock('./SystemSettingsService.js', () => ({
  getSystemSetting: (key: string) => mockGetSystemSetting(key) as unknown,
}));

const { keepStickersIf, filterStickersBySetting } = await import('./stickerVisionGate.js');

/**
 * `isSticker` is declared but left ABSENT on `image` — the state ordinary
 * attachments actually arrive in, and the one the gate must not read as true.
 * Declaring it is required rather than cosmetic: `StickerFlagged` has only
 * optional members, so TypeScript's weak-type check rejects an object literal
 * sharing no properties with it.
 */
type Attachmentish = { url: string; isSticker?: boolean };

const sticker: Attachmentish = { url: 'https://cdn/s.png', isSticker: true };
const image: Attachmentish = { url: 'https://cdn/i.png' };

describe('keepStickersIf', () => {
  it('keeps everything when enabled', () => {
    expect(keepStickersIf(true, [sticker, image])).toEqual([sticker, image]);
  });

  it('drops only stickers when disabled', () => {
    expect(keepStickersIf(false, [sticker, image])).toEqual([image]);
  });

  it('leaves a non-sticker list untouched when disabled', () => {
    // `isSticker` is absent on ordinary attachments, and absent must not read
    // as true — the switch governs stickers, not attachments in general.
    expect(keepStickersIf(false, [image])).toEqual([image]);
  });

  it('takes `enabled` rather than reading the setting, so one request reads it once', () => {
    // Two lists, one decision. Reading a live setting per list could in
    // principle disagree mid-request and produce a message whose trigger
    // stickers were dropped while its reference stickers were not.
    mockGetSystemSetting.mockClear();
    keepStickersIf(false, [sticker]);
    keepStickersIf(false, [sticker]);
    expect(mockGetSystemSetting).not.toHaveBeenCalled();
  });
});

describe('filterStickersBySetting', () => {
  it('drops stickers when the switch is off', () => {
    mockGetSystemSetting.mockReturnValue(false);
    expect(filterStickersBySetting([sticker, image])).toEqual([image]);
    expect(mockGetSystemSetting).toHaveBeenCalledWith('stickerVisionEnabled');
  });

  it('keeps stickers when the switch is on', () => {
    mockGetSystemSetting.mockReturnValue(true);
    expect(filterStickersBySetting([sticker, image])).toEqual([sticker, image]);
  });
});
