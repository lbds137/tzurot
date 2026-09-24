import { describe, it, expect } from 'vitest';
import { MessageFlags, MessageFlagsBitField } from 'discord.js';
import { isVoiceAttachment, hasVoiceMessageFlag } from './voiceAttachment.js';

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

  it('classifies a video/webm attachment with a duration as voice when the message carries IsVoiceMessage', () => {
    expect(
      isVoiceAttachment({ contentType: 'video/webm', duration: 5.2 }, { messageIsVoice: true })
    ).toBe(true);
  });

  it('keeps a video/webm attachment with a duration a plain file when the message lacks IsVoiceMessage', () => {
    expect(
      isVoiceAttachment({ contentType: 'video/webm', duration: 5.2 }, { messageIsVoice: false })
    ).toBe(false);
    expect(isVoiceAttachment({ contentType: 'video/webm', duration: 5.2 })).toBe(false);
  });

  it('requires a duration even when the message carries IsVoiceMessage', () => {
    expect(
      isVoiceAttachment({ contentType: 'video/webm', duration: null }, { messageIsVoice: true })
    ).toBe(false);
  });

  it('still classifies audio/ogg with a duration as voice without the message flag', () => {
    expect(isVoiceAttachment({ contentType: 'audio/ogg', duration: 5.2 })).toBe(true);
    expect(
      isVoiceAttachment({ contentType: 'audio/ogg', duration: 5.2 }, { messageIsVoice: false })
    ).toBe(true);
  });
});

describe('hasVoiceMessageFlag', () => {
  it('reads IsVoiceMessage from message flags', () => {
    expect(
      hasVoiceMessageFlag({ flags: new MessageFlagsBitField(MessageFlags.IsVoiceMessage) })
    ).toBe(true);
    expect(hasVoiceMessageFlag({ flags: new MessageFlagsBitField(MessageFlags.Ephemeral) })).toBe(
      false
    );
    expect(hasVoiceMessageFlag({ flags: undefined })).toBe(false);
    expect(hasVoiceMessageFlag({})).toBe(false);
  });
});
