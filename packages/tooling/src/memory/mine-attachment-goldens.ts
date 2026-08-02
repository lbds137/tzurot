/**
 * Attachment-goldens mining: pull REAL attachment-bearing user turns (image
 * descriptions, voice transcripts) so the search-query allocation A/B can be
 * scored on the query shape it is actually about.
 *
 * Why a SEPARATE miner and output file: the conversation-goldens set is
 * already judged (fold qrels), and re-mining it against a moved DB state would
 * invalidate those judgments. Attachment goldens are ADDITIVE —
 * `attachment-goldens.json` beside `conversation-goldens.json` — and the
 * allocation arms only diverge on attachment-bearing queries anyway.
 *
 * Attachment text lives appended in `content` (VisionDescriptionWriter
 * upgrades the placeholder row post-vision: `message + '\n\n' + descriptions`).
 * `messageMetadata.attachmentDescriptions` has NO producer — the JSONB field
 * is schema-only — so candidates are found by content marker and split back
 * into (bare message, attachment block) at mine time.
 *
 * The mined output is LOCAL-ONLY (gitignored `reports/goldens-mining/`) — it
 * holds raw conversation content. What gets committed is THIS miner
 * (deterministic: same DB state → same sample), never the goldens.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import type { Environment } from '../utils/env-runner.js';
import { pickEvenlySpaced } from './sampling.js';
import {
  classifyQueryStyle,
  fetchPriorHistory,
  type ConversationGolden,
} from './mine-conversation-goldens.js';

/** Which enrichment the turn carries — drives per-kind sampling quotas. */
export type AttachmentKind = 'image' | 'voice' | 'mixed';

/**
 * A conversation golden whose turn carries attachment enrichment, pre-split.
 *
 * NOTE: unlike the base type's doc says, `message` here holds the FULL
 * enriched row content (bare message + attachment block) — what production's
 * history actually stores. The split parts live in `messageBare` /
 * `attachmentText` so the allocation eval can rebuild each arm's query;
 * `messageBare` is the naive-query baseline, not `message`.
 */
export interface AttachmentGolden extends ConversationGolden {
  attachmentKind: AttachmentKind;
  /** The user's own text, split from the enriched row (may be empty for image/voice-only turns). */
  messageBare: string;
  /** The appended attachment block: `[Image: …]` headers + descriptions / voice transcript wrappers. */
  attachmentText: string;
}

/**
 * First attachment header in enriched content. VisionDescriptionWriter joins
 * `message + '\n\n' + descriptions` (or descriptions alone), and each entry
 * opens with a bracketed type header — so the first header at a `\n\n`
 * boundary (or at position 0) is where the user's text ends. A user message
 * that itself contains such a line would split early; acceptable for an
 * eval-only miner, and the bare-message part is still inspectable in the JSON.
 */
const ATTACHMENT_HEADER_RE = /(?:^|\n\n)\[(?:Image|Sticker|Voice message|Audio|File):[^\]\n]*\]/;

/** Split enriched row content into the bare user message and the attachment block. */
export function splitEnrichedContent(
  content: string
): { messageBare: string; attachmentText: string } | null {
  const match = ATTACHMENT_HEADER_RE.exec(content);
  if (match === null) {
    return null;
  }
  const headerStart = match[0].startsWith('\n\n') ? match.index + 2 : match.index;
  return {
    messageBare: content.slice(0, match.index).trim(),
    attachmentText: content.slice(headerStart).trim(),
  };
}

/**
 * Classify the attachment block. Voice transcripts are wrapped in
 * `<voice_transcripts>`; images/stickers carry bracket headers with a
 * following description line. A block with both is 'mixed' (sampled under the
 * image quota — the image description is the long dominant part).
 */
export function classifyAttachmentKind(attachmentText: string): AttachmentKind {
  const hasVoice = attachmentText.includes('<voice_transcripts>');
  const hasImage = /\[(?:Image|Sticker): /.test(attachmentText);
  if (hasVoice && hasImage) {
    return 'mixed';
  }
  return hasVoice ? 'voice' : 'image';
}

export interface MineAttachmentGoldensOptions {
  env: Environment;
  personaId: string;
  /** Target golden count across kinds (default 24: 2/3 image+mixed, 1/3 voice). */
  sampleSize?: number;
  /** Raw prior-turn pool per golden (same bound as the conversation miner). */
  historyWindow?: number;
  outDir?: string;
}

const DEFAULT_SAMPLE_SIZE = 24;
const DEFAULT_HISTORY_WINDOW = 50;
const DEFAULT_OUT_DIR = 'reports/goldens-mining';
/** Time buckets for even spread across the retention window. */
const STRATA_BUCKETS = 8;
/** Image (+mixed) share of the sample — the long-description shape the allocation A/B targets. */
const IMAGE_QUOTA_SHARE = 2 / 3;

interface RawCandidateRow {
  id: string;
  channel_id: string;
  personality_id: string;
  content: string;
  message_metadata: unknown;
  created_at: Date;
}

interface AttachmentCandidate {
  id: string;
  channelId: string;
  personalityId: string;
  content: string;
  messageMetadata: unknown;
  createdAt: Date;
  kind: AttachmentKind;
  messageBare: string;
  attachmentText: string;
}

/** Deterministic per-kind even-time sample: image+mixed under one quota, voice under the other. */
export function sampleByKind(
  candidates: AttachmentCandidate[],
  sampleSize: number
): AttachmentCandidate[] {
  const imagePool = candidates.filter(c => c.kind !== 'voice');
  const voicePool = candidates.filter(c => c.kind === 'voice');
  const sortByTime = (pool: AttachmentCandidate[]): AttachmentCandidate[] =>
    pool
      .slice()
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  const imageQuota = Math.round(sampleSize * IMAGE_QUOTA_SHARE);
  const voiceQuota = sampleSize - imageQuota;
  return [
    ...pickEvenlySpaced(sortByTime(imagePool), imageQuota, STRATA_BUCKETS),
    ...pickEvenlySpaced(sortByTime(voicePool), voiceQuota, STRATA_BUCKETS),
  ];
}

/**
 * Mine attachment goldens from `conversation_history`. Candidates are
 * enriched-content user turns (image-description or voice-transcript markers);
 * each finalist gets the same prior-history window the conversation miner
 * captures, and finalists without enough prior history are dropped (2×
 * over-sampling backfills the loss).
 */
export async function mineAttachmentGoldens(options: MineAttachmentGoldensOptions): Promise<void> {
  const sampleSize = options.sampleSize ?? DEFAULT_SAMPLE_SIZE;
  const historyWindow = options.historyWindow ?? DEFAULT_HISTORY_WINDOW;
  const outDir = options.outDir ?? DEFAULT_OUT_DIR;

  const { getPrismaForEnv } = await import('./prisma-env.js');
  const { prisma, disconnect } = await getPrismaForEnv(options.env);

  try {
    const candidates = await fetchAttachmentCandidates(prisma, options.personaId);
    logKindDistribution('Candidate kind distribution', candidates);

    const finalists = sampleByKind(candidates, sampleSize * 2);
    // Per-kind caps mirror the sampling quotas: without them, the 2× image
    // over-sample (ordered first in `finalists`) backfills history-drops out
    // of VOICE's share and the sample collapses to one kind.
    const imageCap = Math.round(sampleSize * IMAGE_QUOTA_SHARE);
    const kindCap = (kind: AttachmentKind): number =>
      kind === 'voice' ? sampleSize - imageCap : imageCap;
    const perKindCount = new Map<AttachmentKind, number>();
    const countForCap = (kind: AttachmentKind): number =>
      kind === 'voice'
        ? (perKindCount.get('voice') ?? 0)
        : (perKindCount.get('image') ?? 0) + (perKindCount.get('mixed') ?? 0);
    const goldens: AttachmentGolden[] = [];
    let droppedNoHistory = 0;
    for (const candidate of finalists) {
      if (goldens.length >= sampleSize) {
        break;
      }
      if (countForCap(candidate.kind) >= kindCap(candidate.kind)) {
        continue;
      }
      const priorHistory = await fetchPriorHistory(prisma, candidate, historyWindow);
      if (priorHistory === null) {
        droppedNoHistory += 1;
        continue;
      }
      perKindCount.set(candidate.kind, (perKindCount.get(candidate.kind) ?? 0) + 1);
      goldens.push({
        id: candidate.id,
        channelId: candidate.channelId,
        personaId: options.personaId,
        personalityId: candidate.personalityId,
        message: candidate.content,
        messageMetadata: candidate.messageMetadata,
        createdAt: candidate.createdAt.toISOString(),
        style: classifyQueryStyle(candidate.messageBare),
        priorHistory,
        attachmentKind: candidate.kind,
        messageBare: candidate.messageBare,
        attachmentText: candidate.attachmentText,
      });
    }

    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      join(outDir, 'attachment-goldens.json'),
      `${JSON.stringify({ goldens }, null, 2)}\n`
    );

    console.log(
      `\nWrote ${goldens.length} attachment goldens to ${outDir}/attachment-goldens.json` +
        ' (LOCAL-ONLY, gitignored)'
    );
    console.log(`Dropped ${droppedNoHistory} candidates with too little prior history.`);
    logKindDistribution('Golden kind distribution', goldens);
    logAttachmentLengths(goldens);
  } finally {
    await disconnect();
  }
}

/** Fetch + split every enriched-content user turn for the persona. */
async function fetchAttachmentCandidates(
  prisma: PrismaClient,
  personaId: string
): Promise<AttachmentCandidate[]> {
  // Enriched image rows have a description line after the bracket header
  // (placeholder-only rows join headers inline with no newline); voice rows
  // carry the transcript wrapper. Bounded by the persona scope + retention
  // window, same as the conversation miner's sanctioned-unbounded query.
  const rows = await prisma.$queryRaw<RawCandidateRow[]>`
    SELECT id, channel_id, personality_id, content, message_metadata, created_at
    FROM conversation_history
    WHERE persona_id = ${personaId}::uuid
      AND role = 'user'
      AND deleted_at IS NULL
      AND (
        content ~ ${'\\[(Image|Sticker): [^\\]]*\\]\n'}
        OR content LIKE '%<voice_transcripts>%'
      )
  `;
  const candidates: AttachmentCandidate[] = [];
  for (const row of rows) {
    const split = splitEnrichedContent(row.content);
    if (split === null) {
      continue;
    }
    candidates.push({
      id: row.id,
      channelId: row.channel_id,
      personalityId: row.personality_id,
      content: row.content,
      messageMetadata: row.message_metadata,
      createdAt: new Date(row.created_at),
      kind: classifyAttachmentKind(split.attachmentText),
      messageBare: split.messageBare,
      attachmentText: split.attachmentText,
    });
  }
  return candidates;
}

/** Console-only kind histogram (no content — safe to print). */
function logKindDistribution(
  label: string,
  items: ({ kind: AttachmentKind } | { attachmentKind: AttachmentKind })[]
): void {
  const counts = new Map<AttachmentKind, number>();
  for (const item of items) {
    const kind = 'kind' in item ? item.kind : item.attachmentKind;
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  const summary = (['image', 'mixed', 'voice'] as const)
    .map(kind => `${kind}=${counts.get(kind) ?? 0}`)
    .join(', ');
  console.log(`${label}: ${summary}`);
}

/** Console-only length summary for the attachment blocks (counts, not content). */
function logAttachmentLengths(goldens: AttachmentGolden[]): void {
  if (goldens.length === 0) {
    return;
  }
  const lengths = goldens.map(g => g.attachmentText.length).sort((a, b) => a - b);
  const p50 = lengths[Math.floor(lengths.length / 2)];
  console.log(
    `Attachment block chars: min=${lengths[0]}, p50=${p50}, max=${lengths[lengths.length - 1]}`
  );
}
