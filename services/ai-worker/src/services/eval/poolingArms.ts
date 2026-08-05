/**
 * Shared pooling arm runners for the eval harnesses.
 *
 * `denseArm` (embed → pgvector, the production retrieval path) and `ftsArm`
 * (OR-of-lexemes lexical retrieval) were born inside the fold-aware pooling
 * runner; the attachment-allocation A/B pools with the same runners, so they
 * live here — one implementation both harnesses share, with the chunk-dedup
 * and pool-depth behavior pinned by unit test instead of duplicated per eval.
 *
 * The constants are harness tuning, shared so every A/B pools at the same
 * depth: cross-experiment numbers stay comparable only while POOL_K matches.
 */

import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import type { PgvectorMemoryAdapter } from '../PgvectorMemoryAdapter.js';
import type { PooledCandidate } from './qrelsReconciliation.js';

/** Pool depth per arm — TREC-style shallow pools judge fine at 10. */
export const POOL_K = 10;
/** Over-fetch before chunk-dedup so a deduped arm still fills K distinct candidates. */
export const OVERFETCH = POOL_K * 2;
/** Floor threshold: let ranking (not the production cutoff) decide the pool. */
export const SCORE_FLOOR = 0.01;

export interface RetrievedRow {
  corpusId: string;
  createdAtMs: number;
  content: string;
}

/** The one adapter capability the dense arm needs — structural, so tests can fake it. */
export type DenseRetriever = Pick<PgvectorMemoryAdapter, 'queryMemories'>;

/**
 * Dense arm: the production retrieval path (embed → pgvector), persona-wide.
 * Over-fetches then dedups by chunk group (falling back to id) so chunk siblings
 * collapse to one candidate and the arm still yields K distinct rows — without the
 * over-fetch, a top-K crowded with same-source chunks would under-fill the pool.
 */
export async function denseArm(
  adapter: DenseRetriever,
  personaId: string,
  query: string
): Promise<RetrievedRow[]> {
  const hits = await adapter.queryMemories(query, {
    personaId,
    limit: OVERFETCH,
    scoreThreshold: SCORE_FLOOR,
  });
  const seen = new Set<string>();
  const rows: RetrievedRow[] = [];
  for (const hit of hits) {
    const meta = hit.metadata as {
      id?: string;
      chunkGroupId?: string | null;
      createdAt?: number;
    };
    const corpusId = meta.chunkGroupId ?? meta.id;
    if (corpusId === undefined || corpusId === null || seen.has(corpusId)) {
      continue;
    }
    seen.add(corpusId);
    rows.push({ corpusId, createdAtMs: meta.createdAt ?? 0, content: hit.pageContent });
    if (rows.length >= POOL_K) {
      break;
    }
  }
  return rows;
}

interface FtsRow {
  id: string;
  content: string;
  created_at: Date;
  chunk_group_id: string | null;
}

/**
 * FTS arm: OR-of-lexemes over the query text (plainto_tsquery ANDs every word,
 * which a conversational message never satisfies). Scoped by persona_id +
 * visibility ONLY — matching the dense arm's `buildWhereConditions` exactly
 * (which has no `type` filter), so both arms see the same candidate universe
 * (incl. any knowledge-type rows). Long queries balloon the term set, so FTS on
 * a rich query is near-degenerate — pooled for candidate diversity; the
 * decisive arms are dense.
 */
export async function ftsArm(
  prisma: Pick<PrismaClient, '$queryRaw'>,
  personaId: string,
  text: string
): Promise<RetrievedRow[]> {
  const orQuery = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 1)
    .join(' | ');
  if (orQuery.length === 0) {
    return [];
  }
  const rows = await prisma.$queryRaw<FtsRow[]>`
    SELECT id, content, created_at, chunk_group_id
    FROM memories
    WHERE persona_id = ${personaId}::uuid
      AND visibility = 'normal'
      AND to_tsvector('english', content) @@ to_tsquery('english', ${orQuery})
    ORDER BY ts_rank(to_tsvector('english', content), to_tsquery('english', ${orQuery})) DESC
    LIMIT ${OVERFETCH * 2}
  `;
  const seen = new Set<string>();
  const out: RetrievedRow[] = [];
  for (const row of rows) {
    const corpusId = row.chunk_group_id ?? row.id;
    if (seen.has(corpusId)) {
      continue;
    }
    seen.add(corpusId);
    out.push({ corpusId, createdAtMs: new Date(row.created_at).getTime(), content: row.content });
    if (out.length >= POOL_K) {
      break;
    }
  }
  return out;
}

/**
 * Oldest prior-history timestamp, for the non-circularity guard's temporal
 * cutoff. Empty history → MAX_SAFE_INTEGER: no window exists, so nothing should
 * classify as in-window (no real timestamp exceeds it) — and unlike
 * Math.min()'s Infinity it survives JSON persistence (Infinity stringifies to
 * null in the pool file).
 */
export function oldestHistoryMs(priorHistory: { createdAt: string }[]): number {
  return priorHistory.length === 0
    ? Number.MAX_SAFE_INTEGER
    : Math.min(...priorHistory.map(turn => new Date(turn.createdAt).getTime()));
}

/** Sort candidates by best (lowest) rank across all arms for sheet readability. */
export function armSortKey(candidate: PooledCandidate): number {
  // Null ranks are "arm did not surface it" — dropping them keeps a
  // non-surfacing arm from sorting the candidate to the top (null would
  // coerce to 0 through Math.min).
  const ranks = Object.values(candidate.ranks).filter((rank): rank is number => rank !== null);
  return ranks.length === 0 ? 99 : Math.min(...ranks);
}

/** `label#rank` badge for the judgment sheet, or null when the arm missed the candidate. */
export function rankBadge(candidate: PooledCandidate, arm: string, label: string): string | null {
  const rank = candidate.ranks[arm];
  // Absent AND null both mean the arm missed this candidate.
  return rank === undefined || rank === null ? null : `${label}#${rank}`;
}
