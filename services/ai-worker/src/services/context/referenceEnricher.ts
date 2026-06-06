/**
 * Worker-side reference enrichment.
 *
 * Re-derives the enriched `referencedMessages` payload surface from the raw
 * envelope's pre-enrichment snapshots, mirroring bot-client's
 * ReferenceFormatter loop. Reference numbers are adopted from the wire
 * verbatim (numbering happened at crawl time and is dedup-independent for
 * non-forwarded references), so this function only re-runs the two DB-coupled
 * decisions:
 *
 * - dedup-vs-history (shared `isDuplicateReference` kernel, against the
 *   WORKER's assembled history) → collapse to the shared stub shape
 * - voice-transcript append (shared kernel, DB-only retrieval — the bot's
 *   Redis-cache tier has no worker equivalent, an accepted burn-in
 *   divergence source)
 *
 * Forwarded references are passed through untouched: snapshot expansion
 * happened at capture, snapshots carry no transcripts by contract, and the
 * raw==enriched property holds for them on the bot side too. Dedup takes
 * precedence over the forwarded pass-through (a forwarded ref found in
 * history gets stubbed) — the same ordering the bot-side formatter loop
 * applies (isDeduplicated is checked before the forwarded branch).
 *
 * Known accepted divergence: dedup DISAGREEMENT. The worker dedups against
 * its own assembled history, which can differ from the bot's by fetch-timing
 * drift — a reference one side stubs and the other keeps full surfaces as a
 * per-number dedup mismatch in the shadow diff. Counts always align by
 * construction: a bot-deduped forward ships ONE raw container ref (the raw
 * side never expanded it), a kept forward ships its per-snapshot refs, and
 * the worker enriches exactly the list it received.
 */

import {
  appendVoiceTranscripts,
  buildDedupedReferenceStub,
  isDuplicateReference,
  type ConversationMessage,
  type ReferencedMessage,
  type TranscriptRetrieveFn,
} from '@tzurot/common-types';

export interface EnrichRawReferencesParams {
  /** Pre-enrichment snapshots from the raw envelope, in wire order. */
  rawReferences: ReferencedMessage[];
  /** The worker-assembled conversation history to dedup against. */
  history: ConversationMessage[];
  /** DB-tier transcript lookup (typically dataSource.getMessageByDiscordId content). */
  retrieveTranscript: TranscriptRetrieveFn;
  /**
   * Anchor for the time-based dedup window — the job's enqueue timestamp
   * (the closest stand-in for the bot's crawl-time wall clock). Undefined
   * disables the time fallback; exact-id dedup still applies.
   */
  nowMs: number | undefined;
}

/** Derive the dedup-history view once per enrichment run. */
function buildDedupHistory(history: ConversationMessage[]): {
  messageIds: Set<string>;
  timestamps: Date[];
} {
  return {
    messageIds: new Set(history.flatMap(m => m.discordMessageId ?? []).filter(id => id.length > 0)),
    timestamps: history.map(m => m.createdAt),
  };
}

/**
 * Enrich raw reference snapshots into the final payload shape. Order and
 * reference numbers are preserved from the wire.
 */
export async function enrichRawReferences(
  params: EnrichRawReferencesParams
): Promise<ReferencedMessage[]> {
  const { rawReferences, history, retrieveTranscript, nowMs } = params;
  const dedupHistory = buildDedupHistory(history);

  const enriched: ReferencedMessage[] = [];
  for (const raw of rawReferences) {
    const duplicate = isDuplicateReference(
      {
        discordMessageId: raw.discordMessageId,
        timestampMs: new Date(raw.timestamp).getTime(),
        isWebhookOrBotAuthored:
          (raw.webhookId !== undefined && raw.webhookId.length > 0) || raw.authorIsBot === true,
      },
      dedupHistory,
      nowMs
    );

    if (duplicate) {
      enriched.push(buildDedupedReferenceStub(raw));
      continue;
    }

    if (raw.isForwarded === true) {
      // Snapshot/container references: raw == enriched by contract.
      enriched.push({ ...raw });
      continue;
    }

    const content = await appendVoiceTranscripts({
      content: raw.content,
      attachments: raw.attachments ?? [],
      discordMessageId: raw.discordMessageId,
      retrieve: retrieveTranscript,
    });
    enriched.push({ ...raw, content });
  }

  return enriched;
}
