/**
 * Conversation-goldens mining: pull REAL user turns (with their preceding
 * conversation window) from `conversation_history` so the retrieval re-baseline
 * can reproduce the EXACT production folded query offline.
 *
 * Why this exists: production folds the last few conversation turns into the
 * embedded retrieval query (`extractRecentHistoryWindow` + `buildSearchQuery`),
 * and both retrieval arms consume that folded string. The earlier A/B measured
 * the BARE message, which production never does — so it never measured real
 * production retrieval. These goldens carry each target user message PLUS the
 * turns that preceded it, so the eval can build the true folded query and run a
 * paired bare-vs-folded A/B.
 *
 * The mined output is LOCAL-ONLY (gitignored `reports/goldens-mining/`) — it
 * holds raw conversation content, strictly more sensitive than an entity swap
 * can launder. What gets committed is THIS miner (deterministic: same DB state →
 * same sample), never the goldens.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import type { Environment } from '../utils/env-runner.js';
import { pickEvenlySpaced } from './sampling.js';

/** One prior turn in a target's fold window (the shape `extractRecentHistoryWindow` reads). */
export interface ConversationTurn {
  role: string;
  content: string;
  createdAt: string;
}

/** A retrieval golden: a real user message + the conversation that preceded it. */
export interface ConversationGolden {
  /** The target user message's id. */
  id: string;
  channelId: string;
  personaId: string;
  personalityId: string;
  /** The bare user message (the naive query). */
  message: string;
  /** The target's structured metadata (referenced messages / attachments) — for optional refs reconstruction. */
  messageMetadata: unknown;
  /** ISO timestamp of the target message. */
  createdAt: string;
  /** Coarse stratification label (see {@link classifyQueryStyle}). */
  style: QueryStyle;
  /** Up to `historyWindow` turns preceding the target, chronological — the fold input + guard timestamps. */
  priorHistory: ConversationTurn[];
}

/**
 * Coarse query-style buckets. This is a STRATIFICATION AID only — it ensures the
 * sample covers the shapes where folding should matter (short/reactive,
 * referential, compound), NOT a ground-truth label. The pooled judgment is the
 * real arbiter of whether folding helped; style just keeps the sample balanced.
 */
export type QueryStyle = 'short-reactive' | 'referential' | 'compound' | 'standalone';

export const QUERY_STYLES: readonly QueryStyle[] = [
  'short-reactive',
  'referential',
  'compound',
  'standalone',
] as const;

/** A message this short carries no retrievable meaning on its own — folding is its only hope. */
const SHORT_REACTIVE_MAX_WORDS = 4;

/** First-token demonstratives/pronouns: the message leans on an antecedent the bare text lacks. */
const REFERENTIAL_RE =
  /^(?:what about|how about|that|this|it|those|these|they|them|he|she|him|her)\b/i;

/** Coordinating conjunctions that join independent clauses (a compound signal when the message is long). */
const COMPOUND_CONJ_RE = /\b(?:and|but|because|so|then|also|plus|while|whereas)\b/i;

/** Minimum words before a conjunction counts as "compound" rather than incidental. */
const COMPOUND_MIN_WORDS = 12;

/**
 * Classify a message into a coarse style bucket for stratified sampling.
 *
 * Priority order matters: short-reactive (by length) → referential (leads with a
 * demonstrative) → compound (multi-clause) → standalone. The order puts the
 * folding-relevant shapes first so a message that qualifies for several lands in
 * the most interesting bucket.
 */
export function classifyQueryStyle(message: string): QueryStyle {
  const trimmed = message.trim();
  const words = trimmed.split(/\s+/).filter(word => word.length > 0);
  if (words.length <= SHORT_REACTIVE_MAX_WORDS) {
    return 'short-reactive';
  }
  if (REFERENTIAL_RE.test(trimmed)) {
    return 'referential';
  }
  const sentenceEnders = (trimmed.match(/[.!?]+/g) ?? []).length;
  if (
    sentenceEnders >= 2 ||
    (COMPOUND_CONJ_RE.test(trimmed) && words.length >= COMPOUND_MIN_WORDS)
  ) {
    return 'compound';
  }
  return 'standalone';
}

/** A classified candidate turn (content dropped — only what sampling needs). */
export interface StyleCandidate {
  id: string;
  createdAt: Date;
  style: QueryStyle;
}

/**
 * Per-style time-stratified sample. Each style is sampled independently up to
 * `perStyleQuota`, so every style is represented even when one dominates the raw
 * distribution. Returns selected candidate ids in style-then-time order.
 */
export function stratifiedStyleSample(
  candidates: StyleCandidate[],
  options: { perStyleQuota: number; buckets: number }
): string[] {
  const byStyle = new Map<QueryStyle, StyleCandidate[]>();
  for (const candidate of candidates) {
    const list = byStyle.get(candidate.style) ?? [];
    list.push(candidate);
    byStyle.set(candidate.style, list);
  }
  const selected: string[] = [];
  for (const style of QUERY_STYLES) {
    const pool = (byStyle.get(style) ?? [])
      .slice()
      // id tie-break keeps the sample deterministic even when createdAt collides
      // (bulk inserts / db-sync backfills) — the miner advertises a diffable re-mine.
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
    selected.push(
      ...pickEvenlySpaced(pool, options.perStyleQuota, options.buckets).map(
        candidate => candidate.id
      )
    );
  }
  return selected;
}

export interface MineConversationGoldensOptions {
  env: Environment;
  personaId: string;
  /** Target golden count across all styles (default 40). */
  sampleSize?: number;
  /** Raw prior-turn POOL captured per golden (default 50 = production's DEFAULT_MAX_MESSAGES
   * over-fetch bound). The fold slices only its tail (LTM_SEARCH_HISTORY_TURNS=3), so this is
   * the pool the fold draws from, NOT the fold size itself. */
  historyWindow?: number;
  outDir?: string;
}

const DEFAULT_SAMPLE_SIZE = 40;
const DEFAULT_HISTORY_WINDOW = 50;
const DEFAULT_OUT_DIR = 'reports/goldens-mining';
/** Below this, a message is degenerate noise (a stray keystroke), not a real reactive turn. */
const MIN_MESSAGE_CHARS = 3;
/** A golden needs at least this many prior turns for folding to change anything. */
const MIN_PRIOR_TURNS = 2;
/** Time buckets within a style — spreads the sample across the persona's history. */
const STRATA_BUCKETS = 8;

interface RawCandidateRow {
  id: string;
  channel_id: string;
  personality_id: string;
  content: string;
  message_metadata: unknown;
  created_at: Date;
}

interface RawTurnRow {
  role: string;
  content: string;
  created_at: Date;
}

/** A classified candidate user turn with the content needed to build a golden. */
interface Candidate {
  id: string;
  channelId: string;
  personalityId: string;
  content: string;
  messageMetadata: unknown;
  createdAt: Date;
  style: QueryStyle;
}

/**
 * Fetch the turns preceding a target in the same CHANNEL — the exact substrate
 * production folds. Production's history source (`ConversationHistoryService.
 * getChannelHistory`) is channel-scoped with NO personalityId filter ("fetch ALL
 * channel messages across all personalities"), so the fold sees cross-persona
 * context. Scoping this by personality would silently diverge from prod on
 * multi-persona channels — exactly the cross-persona pronoun case folding most
 * helps. `extractRecentHistoryWindow` slices the tail of this window. Returns null
 * when there is too little history to fold.
 */
async function fetchPriorHistory(
  prisma: PrismaClient,
  candidate: Candidate,
  historyWindow: number
): Promise<ConversationTurn[] | null> {
  const priorRows = await prisma.$queryRaw<RawTurnRow[]>`
    SELECT role, content, created_at
    FROM conversation_history
    WHERE channel_id = ${candidate.channelId}
      AND deleted_at IS NULL
      AND (created_at, id) < (${candidate.createdAt}, ${candidate.id}::uuid)
    ORDER BY created_at DESC, id DESC
    LIMIT ${historyWindow}
  `;
  if (priorRows.length < MIN_PRIOR_TURNS) {
    return null;
  }
  return priorRows
    .map(row => ({
      role: row.role,
      content: row.content,
      createdAt: new Date(row.created_at).toISOString(),
    }))
    .reverse();
}

/**
 * Walk the over-sampled candidate ids, keeping one golden per candidate that has
 * enough prior history, up to `sampleSize` total and `perStyleQuota` per style.
 */
async function collectGoldens(
  prisma: PrismaClient,
  orderedIds: string[],
  candidateById: Map<string, Candidate>,
  opts: { personaId: string; sampleSize: number; perStyleQuota: number; historyWindow: number }
): Promise<{ goldens: ConversationGolden[]; droppedNoHistory: number }> {
  const goldens: ConversationGolden[] = [];
  const perStyleCount = new Map<QueryStyle, number>();
  let droppedNoHistory = 0;

  for (const id of orderedIds) {
    if (goldens.length >= opts.sampleSize) {
      break;
    }
    const candidate = candidateById.get(id);
    if (candidate === undefined) {
      continue;
    }
    const styleCount = perStyleCount.get(candidate.style) ?? 0;
    if (styleCount >= opts.perStyleQuota) {
      continue;
    }
    const priorHistory = await fetchPriorHistory(prisma, candidate, opts.historyWindow);
    if (priorHistory === null) {
      droppedNoHistory += 1;
      continue;
    }
    goldens.push({
      id: candidate.id,
      channelId: candidate.channelId,
      personaId: opts.personaId,
      personalityId: candidate.personalityId,
      message: candidate.content,
      messageMetadata: candidate.messageMetadata,
      createdAt: candidate.createdAt.toISOString(),
      style: candidate.style,
      priorHistory,
    });
    perStyleCount.set(candidate.style, styleCount + 1);
  }

  return { goldens, droppedNoHistory };
}

/**
 * Mine conversation goldens from `conversation_history`. Fetches candidate user
 * turns, classifies + stratifies by style, then for each finalist pulls the
 * preceding conversation window (the fold input). Finalists without enough prior
 * history are dropped; over-sampling per style backfills the loss.
 */
export async function mineConversationGoldens(
  options: MineConversationGoldensOptions
): Promise<void> {
  const sampleSize = options.sampleSize ?? DEFAULT_SAMPLE_SIZE;
  const historyWindow = options.historyWindow ?? DEFAULT_HISTORY_WINDOW;
  const outDir = options.outDir ?? DEFAULT_OUT_DIR;

  const { getPrismaForEnv } = await import('./prisma-env.js');
  const { prisma, disconnect } = await getPrismaForEnv(options.env);

  try {
    // Candidate user turns — the persona_id scope + 30-day retention window is the
    // bound (≈ a few thousand rows). Deliberately NO LIMIT: stratification needs the
    // full time range, so a LIMIT would bias the sample toward the DB's return order
    // (the same sanctioned-unbounded pattern as mine-goldens.ts; revisit if retention
    // ever grows unbounded). content feeds style classification; message_metadata
    // rides along here (not a per-finalist round-trip) since it's on the same row.
    // Chunked/normal all included: the fold operates on whatever the message was.
    const rawCandidates = await prisma.$queryRaw<RawCandidateRow[]>`
      SELECT id, channel_id, personality_id, content, message_metadata, created_at
      FROM conversation_history
      WHERE persona_id = ${options.personaId}::uuid
        AND role = 'user'
        AND deleted_at IS NULL
        AND length(content) >= ${MIN_MESSAGE_CHARS}
    `;

    const candidateById = new Map<string, Candidate>(
      rawCandidates.map(row => [
        row.id,
        {
          id: row.id,
          channelId: row.channel_id,
          personalityId: row.personality_id,
          content: row.content,
          messageMetadata: row.message_metadata,
          createdAt: new Date(row.created_at),
          style: classifyQueryStyle(row.content),
        },
      ])
    );
    const styleCandidates: StyleCandidate[] = [...candidateById.values()].map(candidate => ({
      id: candidate.id,
      createdAt: candidate.createdAt,
      style: candidate.style,
    }));
    console.log(`Candidate user turns: ${styleCandidates.length}`);
    logStyleDistribution('Candidate style distribution', styleCandidates);

    // Over-sample per style (2×) so prior-history drops don't starve a style below
    // quota. perStyleQuota distributes sampleSize across the 4 styles; the default 40
    // is exact (10 each). A sampleSize not divisible by 4 slightly favors earlier
    // styles in QUERY_STYLES order (the total-cap break in collectGoldens can short
    // the last style) — acceptable for a sampler where balance beats an exact count.
    const perStyleQuota = Math.ceil(sampleSize / QUERY_STYLES.length);
    const overSampleIds = stratifiedStyleSample(styleCandidates, {
      perStyleQuota: perStyleQuota * 2,
      buckets: STRATA_BUCKETS,
    });

    const { goldens, droppedNoHistory } = await collectGoldens(
      prisma,
      overSampleIds,
      candidateById,
      { personaId: options.personaId, sampleSize, perStyleQuota, historyWindow }
    );

    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      join(outDir, 'conversation-goldens.json'),
      `${JSON.stringify({ goldens }, null, 2)}\n`
    );

    console.log(
      `\nWrote ${goldens.length} conversation goldens to ${outDir}/conversation-goldens.json` +
        ' (LOCAL-ONLY, gitignored)'
    );
    console.log(`Dropped ${droppedNoHistory} candidates with < ${MIN_PRIOR_TURNS} prior turns.`);
    logStyleDistribution(
      'Golden style distribution',
      goldens.map(golden => ({
        id: golden.id,
        createdAt: new Date(golden.createdAt),
        style: golden.style,
      }))
    );
  } finally {
    await disconnect();
  }
}

/** Console-only style histogram (no content — safe to print). */
function logStyleDistribution(label: string, candidates: StyleCandidate[]): void {
  const counts = new Map<QueryStyle, number>();
  for (const candidate of candidates) {
    counts.set(candidate.style, (counts.get(candidate.style) ?? 0) + 1);
  }
  const summary = QUERY_STYLES.map(style => `${style}=${counts.get(style) ?? 0}`).join(', ');
  console.log(`${label}: ${summary}`);
}
