import { describe, it, expect } from 'vitest';
import { isVoiceAttachment } from './voiceAttachment.js';

describe('isVoiceAttachment', () => {
  it('is true for an audio content-type with a duration (a voice message)', () => {
    expect(isVoiceAttachment({ contentType: 'audio/ogg', duration: 5.2 })).toBe(true);
  });

  it('is false for an audio content-type without a duration (a plain audio file)', () => {
    expect(isVoiceAttachment({ contentType: 'audio/mpeg', duration: null })).toBe(false);
  });

  it('is false for a video content-type even with a duration (the MP4 bug)', () => {
    // The exact production false-positive: a video carries a duration, so the old
    // `audio/* || duration` treated it as a voice message.
    expect(isVoiceAttachment({ contentType: 'video/mp4', duration: 30 })).toBe(false);
  });

  it('is false for a non-audio binary content-type with a duration', () => {
    expect(isVoiceAttachment({ contentType: 'application/octet-stream', duration: 5.2 })).toBe(
      false
    );
  });

  it('is false for an image', () => {
    expect(isVoiceAttachment({ contentType: 'image/png', duration: null })).toBe(false);
  });

  it('falls back to duration when the content-type is absent (forwarded snapshot)', () => {
    // Discord sometimes omits content-type in forwarded snapshots; a duration is
    // then the only signal of a genuine voice message.
    expect(isVoiceAttachment({ contentType: null, duration: 5.2 })).toBe(true);
    expect(isVoiceAttachment({ contentType: undefined, duration: 5.2 })).toBe(true);
  });

  it('is false when both content-type and duration are absent', () => {
    expect(isVoiceAttachment({ contentType: null, duration: null })).toBe(false);
  });
});
