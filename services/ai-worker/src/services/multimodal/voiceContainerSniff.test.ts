import { describe, it, expect } from 'vitest';
import { resolveVoiceAudioLabel, withAudioExtension } from './voiceContainerSniff.js';

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

  it('leaves a non-voice video/webm attachment untouched', () => {
    const result = resolveVoiceAudioLabel(
      { contentType: 'video/webm', name: 'clip.webm', isVoiceMessage: false },
      EBML_BYTES
    );

    expect(result).toEqual({
      contentType: 'video/webm',
      name: 'clip.webm',
      outcome: 'not-applicable',
    });
  });

  it('leaves a video/webm attachment with isVoiceMessage undefined untouched', () => {
    const result = resolveVoiceAudioLabel(
      { contentType: 'video/webm', name: 'clip.webm' },
      EBML_BYTES
    );

    expect(result.outcome).toBe('not-applicable');
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
