import { describe, it, expect, vi } from 'vitest';
import { TEXT_LIMITS } from '@tzurot/common-types/constants/discord';
import { MessageRole } from '@tzurot/common-types/constants/message';
import { type ConversationMessage } from '@tzurot/common-types/types/conversationMessage';
import { type ReferencedMessage } from '@tzurot/common-types/types/schemas/message';
import { enrichRawReferences } from './referenceEnricher.js';

const NOW = new Date('2026-06-01T12:00:00Z').getTime();

function rawRef(partial: Partial<ReferencedMessage> = {}): ReferencedMessage {
  return {
    referenceNumber: 1,
    discordMessageId: 'ref-1',
    discordUserId: 'user-1',
    authorUsername: 'someone',
    authorDisplayName: 'Someone',
    content: 'referenced content',
    embeds: '',
    timestamp: new Date(NOW - 5_000).toISOString(),
    locationContext: '<location>here</location>',
    ...partial,
  };
}

function historyRow(discordMessageId: string, createdAt: Date): ConversationMessage {
  return {
    id: `db-${discordMessageId}`,
    role: MessageRole.User,
    content: 'history row',
    createdAt,
    discordMessageId: [discordMessageId],
  } as ConversationMessage;
}

const noTranscript = vi.fn().mockResolvedValue(null);

describe('enrichRawReferences', () => {
  it('passes a non-duplicate regular reference through with its number intact', async () => {
    const result = await enrichRawReferences({
      rawReferences: [rawRef({ referenceNumber: 7 })],
      history: [],
      retrieveTranscript: noTranscript,
      nowMs: NOW,
    });
    expect(result).toHaveLength(1);
    expect(result[0].referenceNumber).toBe(7);
    expect(result[0].content).toBe('referenced content');
    expect(result[0].isDeduplicated).toBeUndefined();
  });

  it('stubs a reference whose id is in the assembled history', async () => {
    const result = await enrichRawReferences({
      rawReferences: [rawRef({ content: 'x'.repeat(TEXT_LIMITS.DEDUP_STUB_CONTENT + 5) })],
      history: [historyRow('ref-1', new Date(NOW - 5_000))],
      retrieveTranscript: noTranscript,
      nowMs: NOW,
    });
    expect(result[0].isDeduplicated).toBe(true);
    expect(result[0].content).toBe('x'.repeat(TEXT_LIMITS.DEDUP_STUB_CONTENT) + '...');
    expect(result[0].embeds).toBe('');
    expect(result[0].locationContext).toBe('');
  });

  it('keeps the image attachment marker when stubbing a duplicate image-only reply-target', async () => {
    const result = await enrichRawReferences({
      rawReferences: [
        rawRef({
          content: '', // image-only message — without the marker the stub is blank
          attachments: [
            { url: 'https://cdn/board.png', contentType: 'image/png', name: 'board.png' },
          ],
        }),
      ],
      history: [historyRow('ref-1', new Date(NOW - 5_000))],
      retrieveTranscript: noTranscript,
      nowMs: NOW,
    });
    expect(result[0].isDeduplicated).toBe(true);
    expect(result[0].content).toBe('[image/png: board.png]');
  });

  it('emits a marker-only stub for the bot’s own deduped voice reply-target', async () => {
    const result = await enrichRawReferences({
      rawReferences: [
        rawRef({
          webhookId: 'wh-1', // personality reply delivered via webhook
          content: 'You are allowed to be furious about this',
          attachments: [
            { url: 'https://cdn/v.ogg', contentType: 'audio/ogg', name: 'lilith-tts.ogg' },
          ],
        }),
      ],
      history: [historyRow('ref-1', new Date(NOW - 5_000))],
      retrieveTranscript: noTranscript,
      nowMs: NOW,
    });
    expect(result[0].isDeduplicated).toBe(true);
    // A bot-authored reply-target is the model's own prior line; a snippet of it is a
    // "continue this fragment" trigger, and the full message is in <chat_log>. So the
    // bot's deduped stub is marker-only — no audio marker AND no text preview. (The
    // audio-strip still applies to non-deduped bot quotes, which keep their text.)
    expect(result[0].content).toBe('');
  });

  it('stubs a recent webhook reference via the time fallback', async () => {
    const result = await enrichRawReferences({
      rawReferences: [rawRef({ webhookId: 'wh-1' })],
      history: [historyRow('different-id', new Date(NOW - 5_000))],
      retrieveTranscript: noTranscript,
      nowMs: NOW,
    });
    expect(result[0].isDeduplicated).toBe(true);
  });

  it('uses authorIsBot to gate the time fallback for non-webhook bot authors', async () => {
    const result = await enrichRawReferences({
      rawReferences: [rawRef({ authorIsBot: true })],
      history: [historyRow('different-id', new Date(NOW - 5_000))],
      retrieveTranscript: noTranscript,
      nowMs: NOW,
    });
    expect(result[0].isDeduplicated).toBe(true);
  });

  it('skips the time fallback when nowMs is undefined', async () => {
    const result = await enrichRawReferences({
      rawReferences: [rawRef({ webhookId: 'wh-1' })],
      history: [historyRow('different-id', new Date(NOW - 5_000))],
      retrieveTranscript: noTranscript,
      nowMs: undefined,
    });
    expect(result[0].isDeduplicated).toBeUndefined();
  });

  it('passes forwarded references through untouched (no transcripts by contract)', async () => {
    const retrieve = vi.fn();
    const forwarded = rawRef({
      isForwarded: true,
      attachments: [
        { url: 'https://cdn/v.ogg', contentType: 'audio/ogg', name: 'v.ogg', isVoiceMessage: true },
      ],
    });
    const result = await enrichRawReferences({
      rawReferences: [forwarded],
      history: [],
      retrieveTranscript: retrieve,
      nowMs: NOW,
    });
    expect(result[0]).toEqual(forwarded);
    expect(result[0]).not.toBe(forwarded); // copy, not the same object
    expect(retrieve).not.toHaveBeenCalled();
  });

  it('stubs a forwarded reference found in history (dedup precedes pass-through)', async () => {
    const result = await enrichRawReferences({
      rawReferences: [rawRef({ isForwarded: true, content: 'forwarded snapshot content' })],
      history: [historyRow('ref-1', new Date(NOW - 60_000))],
      retrieveTranscript: noTranscript,
      nowMs: NOW,
    });
    // Mirrors the bot-side formatter loop: isDeduplicated branch wins over
    // the forwarded branch, so the stub drops the isForwarded flag too.
    expect(result[0].isDeduplicated).toBe(true);
    expect(result[0].isForwarded).toBeUndefined();
    expect(result[0].content).toBe('forwarded snapshot content');
  });

  it('appends DB transcripts to regular references with voice attachments', async () => {
    const retrieve = vi.fn().mockResolvedValue('worker-side transcript');
    const result = await enrichRawReferences({
      rawReferences: [
        rawRef({
          attachments: [
            {
              url: 'https://cdn/v.ogg',
              contentType: 'audio/ogg',
              name: 'v.ogg',
              isVoiceMessage: true,
            },
          ],
        }),
      ],
      history: [],
      retrieveTranscript: retrieve,
      nowMs: NOW,
    });
    expect(retrieve).toHaveBeenCalledWith('ref-1', 'https://cdn/v.ogg');
    expect(result[0].content).toBe(
      'referenced content\n\n[Voice transcript]: worker-side transcript'
    );
  });

  it('preserves wire order across mixed stub/full decisions', async () => {
    const result = await enrichRawReferences({
      rawReferences: [
        rawRef({ referenceNumber: 1, discordMessageId: 'in-history' }),
        rawRef({ referenceNumber: 2, discordMessageId: 'not-in-history' }),
        rawRef({ referenceNumber: 3, discordMessageId: 'fwd', isForwarded: true }),
      ],
      history: [historyRow('in-history', new Date(NOW - 60_000))],
      retrieveTranscript: noTranscript,
      nowMs: NOW,
    });
    expect(result.map(r => r.referenceNumber)).toEqual([1, 2, 3]);
    expect(result.map(r => r.isDeduplicated ?? false)).toEqual([true, false, false]);
  });
});
