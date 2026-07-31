import { describe, it, expect, vi } from 'vitest';
import { INTERVALS } from '../constants/timing.js';
import type { ReferencedMessage } from '../types/schemas/message.js';
import {
  appendVoiceTranscripts,
  isBotAuthoredReference,
  isDuplicateReference,
  stripBotVoiceAttachments,
  type ReferenceDedupCandidate,
} from './referenceEnrichment.js';
import type { AttachmentMetadata } from '../types/schemas/discord.js';

const NOW = new Date('2026-06-01T12:00:00Z').getTime();

function candidate(partial: Partial<ReferenceDedupCandidate> = {}): ReferenceDedupCandidate {
  return {
    discordMessageId: 'msg-1',
    timestampMs: NOW - 1_000,
    isWebhookOrBotAuthored: false,
    ...partial,
  };
}

describe('isDuplicateReference', () => {
  it('matches exactly on a history message id', () => {
    expect(
      isDuplicateReference(candidate(), { messageIds: new Set(['msg-1']), timestamps: [] }, NOW)
    ).toBe(true);
  });

  it('does not match a human-authored message outside history', () => {
    expect(
      isDuplicateReference(
        candidate(),
        { messageIds: new Set(['other']), timestamps: [new Date(NOW - 1_000)] },
        NOW
      )
    ).toBe(false);
  });

  it('time-fallback matches a recent webhook message within tolerance', () => {
    expect(
      isDuplicateReference(
        candidate({ isWebhookOrBotAuthored: true }),
        {
          messageIds: new Set(['other']),
          // Within MESSAGE_TIMESTAMP_TOLERANCE of the candidate's timestamp.
          timestamps: [new Date(NOW - 1_000 + INTERVALS.MESSAGE_TIMESTAMP_TOLERANCE - 1)],
        },
        NOW
      )
    ).toBe(true);
  });

  it('time-fallback rejects when the timestamp gap exceeds tolerance', () => {
    expect(
      isDuplicateReference(
        candidate({ isWebhookOrBotAuthored: true }),
        {
          messageIds: new Set(),
          timestamps: [new Date(NOW - 1_000 + INTERVALS.MESSAGE_TIMESTAMP_TOLERANCE)],
        },
        NOW
      )
    ).toBe(false);
  });

  it('time-fallback skips messages older than the dedup window', () => {
    const oldTimestamp = NOW - INTERVALS.MESSAGE_AGE_DEDUP_WINDOW;
    expect(
      isDuplicateReference(
        candidate({ isWebhookOrBotAuthored: true, timestampMs: oldTimestamp }),
        { messageIds: new Set(), timestamps: [new Date(oldTimestamp)] },
        NOW
      )
    ).toBe(false);
  });

  it('skips the time fallback entirely when nowMs is undefined', () => {
    expect(
      isDuplicateReference(
        candidate({ isWebhookOrBotAuthored: true }),
        { messageIds: new Set(), timestamps: [new Date(NOW - 1_000)] },
        undefined
      )
    ).toBe(false);
  });

  it('still exact-matches by id when nowMs is undefined', () => {
    expect(
      isDuplicateReference(
        candidate(),
        { messageIds: new Set(['msg-1']), timestamps: [] },
        undefined
      )
    ).toBe(true);
  });
});

describe('isBotAuthoredReference', () => {
  const base: ReferencedMessage = {
    referenceNumber: 1,
    discordMessageId: 'm1',
    discordUserId: 'u1',
    authorUsername: 'someone',
    authorDisplayName: 'Someone',
    content: 'hi',
    embeds: '',
    timestamp: '2026-06-01T11:59:00.000Z',
    locationContext: '',
  };

  it('is true when authorIsBot is set', () => {
    expect(isBotAuthoredReference({ ...base, authorIsBot: true })).toBe(true);
  });
  it('is true for a non-empty webhookId (authorIsBot unset)', () => {
    expect(isBotAuthoredReference({ ...base, webhookId: 'wh-1' })).toBe(true);
  });
  it('is false for a plain user reference', () => {
    expect(isBotAuthoredReference(base)).toBe(false);
  });
  it('is false for an empty webhookId', () => {
    expect(isBotAuthoredReference({ ...base, webhookId: '' })).toBe(false);
  });
  it('is false (not a crash) for a null webhookId — the raw Discord.js Message shape', () => {
    // The structural param widening exists exactly for this: discord.js types
    // Message.webhookId as string | null, unlike ReferencedMessage's optional.
    expect(isBotAuthoredReference({ authorIsBot: false, webhookId: null })).toBe(false);
  });
});

describe('stripBotVoiceAttachments', () => {
  const audio: AttachmentMetadata = {
    url: 'https://cdn/v.ogg',
    contentType: 'audio/ogg',
    name: 'lilith-tts.ogg',
  };
  const image: AttachmentMetadata = {
    url: 'https://cdn/x.png',
    contentType: 'image/png',
    name: 'x.png',
  };

  function refWith(
    partial: Partial<Pick<ReferencedMessage, 'authorIsBot' | 'webhookId' | 'attachments'>>
  ): ReferencedMessage {
    return {
      referenceNumber: 1,
      discordMessageId: 'msg-1',
      discordUserId: 'user-1',
      authorUsername: 'someone',
      authorDisplayName: 'Someone',
      content: 'hi',
      embeds: '',
      timestamp: '2026-06-01T11:59:00.000Z',
      locationContext: '',
      ...partial,
    };
  }

  it('drops a bot-authored reply’s own audio attachment', () => {
    const result = stripBotVoiceAttachments(refWith({ authorIsBot: true, attachments: [audio] }));
    expect(result.attachments).toEqual([]);
  });

  it('drops audio on a webhook-authored reply (authorIsBot unset)', () => {
    const result = stripBotVoiceAttachments(refWith({ webhookId: 'wh-1', attachments: [audio] }));
    expect(result.attachments).toEqual([]);
  });

  it('keeps a bot-authored image (real content, not TTS delivery)', () => {
    const result = stripBotVoiceAttachments(refWith({ authorIsBot: true, attachments: [image] }));
    expect(result.attachments).toEqual([image]);
  });

  it('strips only the audio from a bot-authored mixed attachment set', () => {
    const result = stripBotVoiceAttachments(
      refWith({ authorIsBot: true, attachments: [audio, image] })
    );
    expect(result.attachments).toEqual([image]);
  });

  it('keeps a user-authored voice message (genuine content, transcribed elsewhere)', () => {
    const ref = refWith({ attachments: [audio] }); // no authorIsBot, no webhookId
    expect(stripBotVoiceAttachments(ref)).toBe(ref);
  });

  it('returns the same reference when a bot reply has no audio to strip', () => {
    const ref = refWith({ authorIsBot: true, attachments: [image] });
    expect(stripBotVoiceAttachments(ref)).toBe(ref);
  });

  it('returns the same reference when there are no attachments', () => {
    const ref = refWith({ authorIsBot: true });
    expect(stripBotVoiceAttachments(ref)).toBe(ref);
  });
});

describe('appendVoiceTranscripts', () => {
  const voiceAttachment = {
    url: 'https://cdn/voice.ogg',
    contentType: 'audio/ogg',
    name: 'voice.ogg',
    isVoiceMessage: true,
  };

  it('returns content unchanged when there are no attachments', async () => {
    const retrieve = vi.fn();
    const result = await appendVoiceTranscripts({
      content: 'hello',
      attachments: [],
      discordMessageId: 'm1',
      retrieve,
    });
    expect(result).toBe('hello');
    expect(retrieve).not.toHaveBeenCalled();
  });

  it('skips non-voice attachments', async () => {
    const retrieve = vi.fn();
    const result = await appendVoiceTranscripts({
      content: 'hello',
      attachments: [{ url: 'https://cdn/x.png', contentType: 'image/png', name: 'x.png' }],
      discordMessageId: 'm1',
      retrieve,
    });
    expect(result).toBe('hello');
    expect(retrieve).not.toHaveBeenCalled();
  });

  it('appends a found transcript to existing content', async () => {
    const retrieve = vi.fn().mockResolvedValue('the transcript');
    const result = await appendVoiceTranscripts({
      content: 'hello',
      attachments: [voiceAttachment],
      discordMessageId: 'm1',
      retrieve,
    });
    expect(retrieve).toHaveBeenCalledWith('m1', 'https://cdn/voice.ogg');
    expect(result).toBe('hello\n\n[Voice transcript]: the transcript');
  });

  it('uses the transcript as the whole content when content is empty', async () => {
    const retrieve = vi.fn().mockResolvedValue('only words');
    const result = await appendVoiceTranscripts({
      content: '',
      attachments: [voiceAttachment],
      discordMessageId: 'm1',
      retrieve,
    });
    expect(result).toBe('[Voice transcript]: only words');
  });

  it('returns content unchanged when no transcript is found', async () => {
    const retrieve = vi.fn().mockResolvedValue(null);
    const result = await appendVoiceTranscripts({
      content: 'hello',
      attachments: [voiceAttachment],
      discordMessageId: 'm1',
      retrieve,
    });
    expect(result).toBe('hello');
  });

  it('joins multiple transcripts into one block', async () => {
    const retrieve = vi
      .fn()
      .mockResolvedValueOnce('first part')
      .mockResolvedValueOnce('second part');
    const result = await appendVoiceTranscripts({
      content: '',
      attachments: [voiceAttachment, { ...voiceAttachment, url: 'https://cdn/voice2.ogg' }],
      discordMessageId: 'm1',
      retrieve,
    });
    expect(result).toBe('[Voice transcript]: first part\n\nsecond part');
  });
});
