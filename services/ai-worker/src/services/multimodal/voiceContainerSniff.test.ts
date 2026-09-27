import { describe, it, expect } from 'vitest';
import {
  resolveVoiceAudioLabel,
  withAudioExtension,
  ebmlHasVideoTrack,
  EBML_HEADER_SCAN_MAX_BYTES,
} from './voiceContainerSniff.js';
import {
  hexToBytes,
  CHROMIUM_AUDIO_WEBM_PREFIX_HEX,
  FFMPEG_AV_WEBM_PREFIX_HEX,
  VIDEO_CODEC_AFTER_CLUSTER_HEX,
  BARE_V_PREFIX_BEFORE_CLUSTER_HEX,
} from '../../test/mocks/fixtures/webmHeaders.js';

const EBML_BYTES = Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x02, 0x03, 0x04]);
const OGGS_BYTES = Uint8Array.from([0x4f, 0x67, 0x67, 0x53, 0x00, 0x02, 0x00, 0x00]);
const UNRECOGNIZED_BYTES = Uint8Array.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]);

describe('resolveVoiceAudioLabel', () => {
  it('relabels an EBML voice attachment as audio/webm with a .webm name', () => {
    const result = resolveVoiceAudioLabel(
      { contentType: 'video/webm', name: 'voice-message.ogg', isVoiceMessage: true },
      EBML_BYTES
    );

    expect(result).toEqual({
      contentType: 'audio/webm',
      name: 'voice-message.webm',
      outcome: 'relabeled',
    });
  });

  it('relabels an OggS voice attachment as audio/ogg', () => {
    const result = resolveVoiceAudioLabel(
      { contentType: 'video/webm', name: 'voice-message.ogg', isVoiceMessage: true },
      OGGS_BYTES
    );

    expect(result).toEqual({
      contentType: 'audio/ogg',
      name: 'voice-message.ogg',
      outcome: 'relabeled',
    });
  });

  it('keeps the declared type when the container is unrecognized', () => {
    const result = resolveVoiceAudioLabel(
      { contentType: 'video/webm', name: 'voice-message.ogg', isVoiceMessage: true },
      UNRECOGNIZED_BYTES
    );

    expect(result).toEqual({
      contentType: 'video/webm',
      name: 'voice-message.ogg',
      outcome: 'unrecognized',
    });
  });

  it('leaves a declared audio/* voice attachment untouched even with EBML bytes', () => {
    const result = resolveVoiceAudioLabel(
      { contentType: 'audio/ogg', name: 'voice-message.ogg', isVoiceMessage: true },
      EBML_BYTES
    );

    expect(result).toEqual({
      contentType: 'audio/ogg',
      name: 'voice-message.ogg',
      outcome: 'not-applicable',
    });
  });

  it('relabels a non-voice video/webm EBML attachment as audio/webm', () => {
    const result = resolveVoiceAudioLabel(
      { contentType: 'video/webm', name: 'clip.webm', isVoiceMessage: false },
      EBML_BYTES
    );

    expect(result).toEqual({
      contentType: 'audio/webm',
      name: 'clip.webm',
      outcome: 'relabeled',
    });
  });

  it('relabels a video/webm EBML attachment with isVoiceMessage undefined', () => {
    const result = resolveVoiceAudioLabel(
      { contentType: 'video/webm', name: 'clip.webm' },
      EBML_BYTES
    );

    expect(result.outcome).toBe('relabeled');
    expect(result.contentType).toBe('audio/webm');
  });

  it('leaves a non-voice video/mp4 attachment untouched even with EBML bytes', () => {
    const result = resolveVoiceAudioLabel(
      { contentType: 'video/mp4', name: 'clip.mp4', isVoiceMessage: false },
      EBML_BYTES
    );

    expect(result).toEqual({
      contentType: 'video/mp4',
      name: 'clip.mp4',
      outcome: 'not-applicable',
    });
  });

  it('appends the extension to a name with no existing extension', () => {
    const result = resolveVoiceAudioLabel(
      { contentType: 'video/webm', name: 'voicemessage', isVoiceMessage: true },
      EBML_BYTES
    );

    expect(result.name).toBe('voicemessage.webm');
  });

  it('synthesizes a name when the attachment has no name', () => {
    const result = resolveVoiceAudioLabel(
      { contentType: 'video/webm', isVoiceMessage: true },
      OGGS_BYTES
    );

    expect(result.name).toBe('audio.ogg');
  });

  it('synthesizes a name when the attachment name is empty', () => {
    const result = resolveVoiceAudioLabel(
      { contentType: 'video/webm', name: '', isVoiceMessage: true },
      EBML_BYTES
    );

    expect(result.name).toBe('audio.webm');
  });

  it('treats a buffer shorter than 4 bytes as unrecognized', () => {
    const result = resolveVoiceAudioLabel(
      { contentType: 'video/webm', name: 'voice-message.ogg', isVoiceMessage: true },
      Uint8Array.from([0x1a, 0x45])
    );

    expect(result.outcome).toBe('unrecognized');
    expect(result.contentType).toBe('video/webm');
  });
});

describe('withAudioExtension', () => {
  it('replaces an existing extension', () => {
    expect(withAudioExtension('voice-message.ogg', '.webm')).toBe('voice-message.webm');
  });

  it('synthesizes a name when none is given', () => {
    expect(withAudioExtension(undefined, '.ogg')).toBe('audio.ogg');
  });
});

describe('ebmlHasVideoTrack', () => {
  it('returns false for a Chromium MediaRecorder audio-only WebM', () => {
    expect(ebmlHasVideoTrack(hexToBytes(CHROMIUM_AUDIO_WEBM_PREFIX_HEX))).toBe(false);
  });

  it('returns true for an ffmpeg A/V WebM', () => {
    expect(ebmlHasVideoTrack(hexToBytes(FFMPEG_AV_WEBM_PREFIX_HEX))).toBe(true);
  });

  it('returns false when the V_VP8 CodecID sits past the Cluster id, so the header scan stops before it', () => {
    expect(ebmlHasVideoTrack(hexToBytes(VIDEO_CODEC_AFTER_CLUSTER_HEX))).toBe(false);
  });

  it('returns false for a bare `V_` outside a CodecID element', () => {
    expect(ebmlHasVideoTrack(hexToBytes(BARE_V_PREFIX_BEFORE_CLUSTER_HEX))).toBe(false);
  });

  it('does not scan past EBML_HEADER_SCAN_MAX_BYTES', () => {
    const overCap = new Uint8Array(EBML_HEADER_SCAN_MAX_BYTES + 16);
    overCap.set([0x86, 0x85, 0x56, 0x5f, 0x56, 0x50, 0x38], EBML_HEADER_SCAN_MAX_BYTES);
    expect(ebmlHasVideoTrack(overCap)).toBe(false);

    const underCap = new Uint8Array(EBML_HEADER_SCAN_MAX_BYTES + 16);
    underCap.set([0x86, 0x85, 0x56, 0x5f, 0x56, 0x50, 0x38], EBML_HEADER_SCAN_MAX_BYTES - 8);
    expect(ebmlHasVideoTrack(underCap)).toBe(true);
  });

  it('returns false for an empty Uint8Array', () => {
    expect(ebmlHasVideoTrack(new Uint8Array())).toBe(false);
  });
});
