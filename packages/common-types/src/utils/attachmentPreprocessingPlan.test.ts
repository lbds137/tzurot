import { describe, it, expect } from 'vitest';
import { type AttachmentMetadata } from '../types/schemas/discord.js';
import { classifyForPreprocessing, planPreprocessing } from './attachmentPreprocessingPlan.js';

function att(overrides: Partial<AttachmentMetadata>): AttachmentMetadata {
  return {
    url: 'https://cdn.discordapp.com/attachments/1/2/thing',
    name: 'thing',
    contentType: 'application/octet-stream',
    size: 100,
    ...overrides,
  };
}

describe('classifyForPreprocessing', () => {
  it.each([
    ['audio/mpeg upload', att({ contentType: 'audio/mpeg' }), 'audio'],
    ['flagged voice message', att({ contentType: 'audio/ogg', isVoiceMessage: true }), 'audio'],
    [
      'voice flag on a non-audio type',
      att({ contentType: 'video/webm', isVoiceMessage: true }),
      'audio',
    ],
    ['png image', att({ contentType: 'image/png' }), 'image'],
    ['plain video/webm (sniffed downstream)', att({ contentType: 'video/webm' }), 'file'],
    ['pdf', att({ contentType: 'application/pdf' }), 'file'],
  ] as const)('%s → %s', (_label, attachment, expected) => {
    expect(classifyForPreprocessing(attachment)).toBe(expected);
  });

  it('checks audio-or-voice before image: an image/* carrying the voice flag is audio', () => {
    expect(classifyForPreprocessing(att({ contentType: 'image/png', isVoiceMessage: true }))).toBe(
      'audio'
    );
  });
});

describe('planPreprocessing', () => {
  const voice = att({ name: 'voice.ogg', contentType: 'audio/ogg', isVoiceMessage: true });
  const mp3 = att({ name: 'song.mp3', contentType: 'audio/mpeg' });
  const png = att({ name: 'cat.png', contentType: 'image/png' });
  const pdf = att({ name: 'report.pdf', contentType: 'application/pdf' });

  it('buckets trigger attachments, keeping non-voice audio when no referenceNumber is set', () => {
    expect(planPreprocessing([voice, mp3, png, pdf], {})).toEqual({
      audio: [voice, mp3],
      images: [png],
      files: [pdf],
      skippedNonVoiceReferenceAudio: 0,
    });
  });

  it('keeps only voice messages in audio on a referenced message and counts the rest', () => {
    expect(planPreprocessing([voice, mp3, png, pdf], { referenceNumber: 1 })).toEqual({
      audio: [voice],
      images: [png],
      files: [pdf],
      skippedNonVoiceReferenceAudio: 1,
    });
  });

  it('treats referenceNumber 0 as a reference (the gate keys on presence, not truthiness)', () => {
    expect(planPreprocessing([mp3], { referenceNumber: 0 }).skippedNonVoiceReferenceAudio).toBe(1);
  });

  it('returns empty buckets for no attachments', () => {
    expect(planPreprocessing([], {})).toEqual({
      audio: [],
      images: [],
      files: [],
      skippedNonVoiceReferenceAudio: 0,
    });
  });
});
