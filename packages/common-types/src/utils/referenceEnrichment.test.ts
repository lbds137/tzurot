import { describe, it, expect, vi } from 'vitest';
import { INTERVALS } from '../constants/timing.js';
import { TEXT_LIMITS } from '../constants/discord.js';
import type { ReferencedMessage } from '../types/schemas/message.js';
import {
  appendVoiceTranscripts,
  buildDedupedReferenceStub,
  capDedupText,
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

// Defaults to non-bot: bot-authored stubs are now marker-only (empty content), so the
// dedup-content assertions below need a user-authored reference to keep their text.
function fullReference(content: string, botAuthored = false): ReferencedMessage {
  return {
    referenceNumber: 3,
    discordMessageId: 'msg-9',
    ...(botAuthored ? { webhookId: 'wh-1', authorIsBot: true } : {}),
    discordUserId: 'user-1',
    authorUsername: 'someone',
    authorDisplayName: 'Someone',
    content,
    embeds: '<embed>stuff</embed>',
    timestamp: '2026-06-01T11:59:00.000Z',
    locationContext: '<location>here</location>',
    attachments: [{ url: 'https://cdn/x.png', contentType: 'image/png', name: 'x.png' }],
    isForwarded: true,
  };
}

describe('capDedupText', () => {
  it('returns text at or under the limit unchanged (no ellipsis)', () => {
    const short = 'X'.repeat(TEXT_LIMITS.DEDUP_STUB_CONTENT);
    expect(capDedupText(short)).toBe(short);
    expect(capDedupText('hi')).toBe('hi');
    expect(capDedupText('')).toBe('');
  });

  it('caps over-limit text to DEDUP_STUB_CONTENT chars + ellipsis', () => {
    const long = 'X'.repeat(TEXT_LIMITS.DEDUP_STUB_CONTENT + 100);
    const capped = capDedupText(long);
    expect(capped).toBe('X'.repeat(TEXT_LIMITS.DEDUP_STUB_CONTENT) + '...');
    expect(capped).not.toContain('X'.repeat(TEXT_LIMITS.DEDUP_STUB_CONTENT + 1));
  });
});

describe('buildDedupedReferenceStub', () => {
  it('strips embeds/location/flags and folds the attachment marker into content', () => {
    const stub = buildDedupedReferenceStub(fullReference('short content'));
    expect(stub).toEqual({
      referenceNumber: 3,
      discordMessageId: 'msg-9',
      discordUserId: 'user-1',
      authorUsername: 'someone',
      authorDisplayName: 'Someone',
      // marker first (truncation-safe), then the original text
      content: '[image/png: x.png]\n\nshort content',
      embeds: '',
      timestamp: '2026-06-01T11:59:00.000Z',
      locationContext: '',
      isDeduplicated: true,
    });
  });

  it('renders attachment markers alone for an image-only reply-target (empty text)', () => {
    const stub = buildDedupedReferenceStub(fullReference(''));
    expect(stub.content).toBe('[image/png: x.png]');
  });

  it('emits one marker per attachment, using contentType + name', () => {
    const ref = fullReference('look at these');
    ref.attachments = [
      { url: 'https://cdn/a.jpg', contentType: 'image/jpeg', name: 'a.jpg' },
      { url: 'https://cdn/v.ogg', contentType: 'audio/ogg' }, // no name → 'attachment'
    ];
    const stub = buildDedupedReferenceStub(ref);
    expect(stub.content).toBe('[image/jpeg: a.jpg]\n[audio/ogg: attachment]\n\nlook at these');
  });

  it('leaves content untouched (no leading newlines) when there are no attachments', () => {
    const ref = fullReference('plain text');
    ref.attachments = undefined;
    const stub = buildDedupedReferenceStub(ref);
    expect(stub.content).toBe('plain text');
  });

  it('truncates the text portion but keeps the leading marker', () => {
    const long = 'x'.repeat(TEXT_LIMITS.DEDUP_STUB_CONTENT + 10);
    const stub = buildDedupedReferenceStub(fullReference(long));
    expect(stub.content).toBe(
      '[image/png: x.png]\n\n' + 'x'.repeat(TEXT_LIMITS.DEDUP_STUB_CONTENT) + '...'
    );
  });

  it('preserves all markers in full even when they alone exceed the content budget', () => {
    // Several long-named attachments whose markers TOGETHER blow past
    // DEDUP_STUB_CONTENT. buildDedupedReferenceStub must NOT truncate the
    // markers (only the text portion is truncated) — they carry the
    // filename→history correlation that downstream re-truncation
    // (formatDedupedQuote) is told to protect by keeping them first.
    const ref = fullReference('hi');
    const longName = (n: number) => `${'really-long-attachment-name-'.repeat(2)}${n}.png`;
    ref.attachments = [
      { url: 'https://cdn/1.png', contentType: 'image/png', name: longName(1) },
      { url: 'https://cdn/2.png', contentType: 'image/png', name: longName(2) },
      { url: 'https://cdn/3.png', contentType: 'image/png', name: longName(3) },
    ];
    const expectedMarkers = ref.attachments
      .map(att => `[${att.contentType}: ${att.name}]`)
      .join('\n');

    // Sanity-check the test actually exercises the over-budget case.
    expect(expectedMarkers.length).toBeGreaterThan(TEXT_LIMITS.DEDUP_STUB_CONTENT);

    const stub = buildDedupedReferenceStub(ref);
    // Every marker survives untruncated, markers-first, with the short text after.
    expect(stub.content).toBe(`${expectedMarkers}\n\nhi`);
  });

  it('emits a marker-only stub (empty content) for the bot’s own reply-target', () => {
    // A snippet of the bot's own prior text is the "continue this fragment" trigger;
    // the full message is in <chat_log> regardless, so bot-authored stubs carry no
    // preview and no attachment markers. The marker is prepended downstream.
    const stub = buildDedupedReferenceStub(fullReference('the bot said this earlier', true));
    expect(stub.content).toBe('');
  });

  it('preserves authorIsBot/webhookId so the formatter can derive role="assistant"', () => {
    const stub = buildDedupedReferenceStub(fullReference('x', true));
    expect(stub.authorIsBot).toBe(true);
    expect(stub.webhookId).toBe('wh-1');
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
