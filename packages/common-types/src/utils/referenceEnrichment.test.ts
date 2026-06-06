import { describe, it, expect, vi } from 'vitest';
import { INTERVALS } from '../constants/timing.js';
import { TEXT_LIMITS } from '../constants/discord.js';
import type { ReferencedMessage } from '../types/schemas/message.js';
import {
  appendVoiceTranscripts,
  buildDedupedReferenceStub,
  isDuplicateReference,
  type ReferenceDedupCandidate,
} from './referenceEnrichment.js';

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

function fullReference(content: string): ReferencedMessage {
  return {
    referenceNumber: 3,
    discordMessageId: 'msg-9',
    webhookId: 'wh-1',
    authorIsBot: true,
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

describe('buildDedupedReferenceStub', () => {
  it('keeps short content and strips embeds/location/attachments/flags', () => {
    const stub = buildDedupedReferenceStub(fullReference('short content'));
    expect(stub).toEqual({
      referenceNumber: 3,
      discordMessageId: 'msg-9',
      discordUserId: 'user-1',
      authorUsername: 'someone',
      authorDisplayName: 'Someone',
      content: 'short content',
      embeds: '',
      timestamp: '2026-06-01T11:59:00.000Z',
      locationContext: '',
      isDeduplicated: true,
    });
  });

  it('truncates content beyond the stub limit with an ellipsis', () => {
    const long = 'x'.repeat(TEXT_LIMITS.DEDUP_STUB_CONTENT + 10);
    const stub = buildDedupedReferenceStub(fullReference(long));
    expect(stub.content).toBe('x'.repeat(TEXT_LIMITS.DEDUP_STUB_CONTENT) + '...');
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
