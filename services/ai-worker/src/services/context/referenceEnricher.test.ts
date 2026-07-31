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

  it('flags a reference whose id is in the assembled history, and changes nothing else', async () => {
    const raw = rawRef({ content: 'x'.repeat(TEXT_LIMITS.DEDUP_STUB_CONTENT + 40) });
    const result = await enrichRawReferences({
      rawReferences: [raw],
      history: [historyRow('ref-1', new Date(NOW - 5_000))],
      retrieveTranscript: noTranscript,
      nowMs: NOW,
    });
    // The enricher sets the FLAG and nothing else. Emptying the content,
    // capping the preview and dropping embeds/location used to happen here, in
    // a field-by-field rebuild — which is exactly how fields nobody remembered
    // to list went missing. It is a render-time projection now, so everything
    // downstream still has the full reference to project FROM.
    expect(result[0].isDeduplicated).toBe(true);
    expect(result[0].content).toBe('x'.repeat(TEXT_LIMITS.DEDUP_STUB_CONTENT + 40));
    expect(result[0].embeds).toBe(raw.embeds);
    expect(result[0].locationContext).toBe(raw.locationContext);
  });

  it('keeps the attachments on a deduped reference so the renderer can still draw them', async () => {
    // The regression this pins: the old stub STRIPPED `attachments`, so the
    // renderer had only preprocessing results to go on and an attachment whose
    // vision call never ran was simply invisible.
    const attachments = [
      { url: 'https://cdn/board.png', contentType: 'image/png', name: 'board.png' },
    ];
    const result = await enrichRawReferences({
      rawReferences: [rawRef({ content: '', attachments })],
      history: [historyRow('ref-1', new Date(NOW - 5_000))],
      retrieveTranscript: noTranscript,
      nowMs: NOW,
    });
    expect(result[0].isDeduplicated).toBe(true);
    expect(result[0].attachments).toEqual(attachments);
  });

  it('strips the bot’s own TTS audio before the dedup decision', async () => {
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
    // A personality reply's `audio/*` attachment is TTS *delivery* of its own
    // text, not content the model attached — so it is dropped here, on both
    // render branches. Withholding the TEXT preview is a separate decision and
    // lives with the renderer (`dedupeReference` keys it on role="assistant"),
    // which is why the content survives this step intact.
    expect(result[0].attachments).toEqual([]);
    expect(result[0].content).toBe('You are allowed to be furious about this');
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
    // Dedup wins over the forwarded pass-through, as it does on the bot side —
    // but the forwarded flag SURVIVES now. The old stub rebuilt the reference
    // without it, so a forwarded reference that also deduped silently lost its
    // forwarded-ness: the third instance of the dropped-field class.
    expect(result[0].isDeduplicated).toBe(true);
    expect(result[0].isForwarded).toBe(true);
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
