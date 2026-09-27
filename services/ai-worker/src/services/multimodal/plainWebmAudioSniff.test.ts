import { describe, it, expect, beforeEach, vi } from 'vitest';
import { type AttachmentMetadata } from '@tzurot/common-types/types/schemas/discord';
import {
  hexToArrayBuffer,
  CHROMIUM_AUDIO_WEBM_PREFIX_HEX,
  FFMPEG_AV_WEBM_PREFIX_HEX,
} from '../../test/mocks/fixtures/webmHeaders.js';

const { mockFetchAudioBuffer } = vi.hoisted(() => ({ mockFetchAudioBuffer: vi.fn() }));
vi.mock('./AudioProcessor.js', () => ({
  fetchAudioBuffer: (...args: unknown[]) => mockFetchAudioBuffer(...args),
}));

const { sniffPlainWebmForAudioOnly, PLAIN_WEBM_SNIFF_MAX_BYTES } =
  await import('./plainWebmAudioSniff.js');

const baseAttachment = {
  url: 'https://cdn.discordapp.com/attachments/1/2/voice-message.ogg',
  name: 'voice-message.ogg',
  contentType: 'video/webm',
  size: 4096,
} satisfies AttachmentMetadata;

describe('sniffPlainWebmForAudioOnly', () => {
  beforeEach(() => {
    mockFetchAudioBuffer.mockReset();
  });

  it('seam: returns the fetched buffer for an audio-only Chromium MediaRecorder WebM (real label + video-track sniff)', async () => {
    const buffer = hexToArrayBuffer(CHROMIUM_AUDIO_WEBM_PREFIX_HEX);
    mockFetchAudioBuffer.mockResolvedValue(buffer);

    const result = await sniffPlainWebmForAudioOnly(baseAttachment);

    expect(result).toBe(buffer);
    expect(mockFetchAudioBuffer).toHaveBeenCalledWith(baseAttachment.url);
  });

  it('returns null for an ffmpeg A/V WebM (has a video track)', async () => {
    mockFetchAudioBuffer.mockResolvedValue(hexToArrayBuffer(FFMPEG_AV_WEBM_PREFIX_HEX));

    const result = await sniffPlainWebmForAudioOnly(baseAttachment);

    expect(result).toBeNull();
    expect(mockFetchAudioBuffer).toHaveBeenCalled();
  });

  it('returns null without fetching when the declared size is over the cap', async () => {
    const result = await sniffPlainWebmForAudioOnly({
      ...baseAttachment,
      size: PLAIN_WEBM_SNIFF_MAX_BYTES + 1,
    });

    expect(result).toBeNull();
    expect(mockFetchAudioBuffer).not.toHaveBeenCalled();
  });

  it('sniffs a file exactly at the size cap (boundary inclusive)', async () => {
    const buffer = hexToArrayBuffer(CHROMIUM_AUDIO_WEBM_PREFIX_HEX);
    mockFetchAudioBuffer.mockResolvedValue(buffer);

    const result = await sniffPlainWebmForAudioOnly({
      ...baseAttachment,
      size: PLAIN_WEBM_SNIFF_MAX_BYTES,
    });

    expect(result).toBe(buffer);
  });

  it('returns null without fetching when size is undefined', async () => {
    const { size: _size, ...withoutSize } = baseAttachment;
    const result = await sniffPlainWebmForAudioOnly(withoutSize);

    expect(result).toBeNull();
    expect(mockFetchAudioBuffer).not.toHaveBeenCalled();
  });

  it('returns null without fetching when isVoiceMessage is true', async () => {
    const result = await sniffPlainWebmForAudioOnly({
      ...baseAttachment,
      isVoiceMessage: true,
    });

    expect(result).toBeNull();
    expect(mockFetchAudioBuffer).not.toHaveBeenCalled();
  });

  it.each(['video/mp4', 'audio/webm'])(
    'returns null without fetching for contentType %s',
    async contentType => {
      const result = await sniffPlainWebmForAudioOnly({ ...baseAttachment, contentType });

      expect(result).toBeNull();
      expect(mockFetchAudioBuffer).not.toHaveBeenCalled();
    }
  );

  it('resolves null (does not throw) when the fetch rejects', async () => {
    mockFetchAudioBuffer.mockRejectedValue(new Error('network down'));

    const result = await sniffPlainWebmForAudioOnly(baseAttachment);

    expect(result).toBeNull();
  });

  it('returns null for OggS bytes under video/webm', async () => {
    mockFetchAudioBuffer.mockResolvedValue(
      Uint8Array.from([0x4f, 0x67, 0x67, 0x53, 0x00, 0x00, 0x00, 0x00]).buffer
    );

    const result = await sniffPlainWebmForAudioOnly(baseAttachment);

    expect(result).toBeNull();
  });

  it('returns null for unrecognized bytes', async () => {
    mockFetchAudioBuffer.mockResolvedValue(Uint8Array.from([0x00, 0x01, 0x02, 0x03]).buffer);

    const result = await sniffPlainWebmForAudioOnly(baseAttachment);

    expect(result).toBeNull();
  });
});
