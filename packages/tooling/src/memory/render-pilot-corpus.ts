/**
 * Corpus stage: pulls a personality's sampled memories and linked facts from
 * Postgres (read-only), splits each memory's stored content back into its
 * template parts, resolves the `{user}`/`{assistant}` placeholder family, and
 * computes corpus-level stats.
 */

import { PLACEHOLDERS } from '@tzurot/common-types/constants/message';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { UsageError } from '../utils/errors.js';

/** One memory's stored content, split back into its template parts. */
export interface SplitMemoryResult {
  user: string;
  assistant: string;
  referenced: string | null;
}

// The stored template is `{user}: <userMessage>\n{assistant}: <aiResponse>`
// (LongTermMemoryService.ts), and a referenced block is appended as
// `\n\n[Referenced content: <text>]` (MemoryPersistenceService.ts). The `]`
// is the LAST character of the whole content when the block is present.
const REFERENCED_BLOCK_RE = /\n\n\[Referenced content: ([\s\S]*)\]$/;
const USER_PREFIX = '{user}: ';
const ASSISTANT_SEPARATOR = '\n{assistant}: ';

/**
 * Split a stored memory's `content` back into user text, assistant text, and
 * an optional referenced-content block. Returns `null` when the content does
 * not match the stored template, OR when the separator appears more than
 * once (ambiguous split point) — the caller counts these as `unparseable`
 * and excludes the row.
 */
export function splitMemoryContent(content: string): SplitMemoryResult | null {
  let remainder = content;
  let referenced: string | null = null;

  const refMatch = REFERENCED_BLOCK_RE.exec(remainder);
  if (refMatch !== null) {
    referenced = refMatch[1];
    remainder = remainder.slice(0, refMatch.index);
  }

  if (!remainder.startsWith(USER_PREFIX)) {
    return null;
  }
  const separatorIndex = remainder.indexOf(ASSISTANT_SEPARATOR);
  if (separatorIndex === -1) {
    return null;
  }
  // The stored template contains exactly one `\n{assistant}: ` separator, so
  // a second occurrence means the content is ambiguous (typically a user
  // message quoting the template) — the row is excluded as `unparseable`
  // rather than mis-split at an arbitrary boundary.
  if (remainder.includes(ASSISTANT_SEPARATOR, separatorIndex + ASSISTANT_SEPARATOR.length)) {
    return null;
  }

  return {
    user: remainder.slice(USER_PREFIX.length, separatorIndex),
    assistant: remainder.slice(separatorIndex + ASSISTANT_SEPARATOR.length),
    referenced,
  };
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Resolve every `{user}`/`{assistant}` placeholder variant (case-insensitive,
 * longest-first) to the subject/assistant name — mirrors ai-worker's
 * `replacePromptPlaceholders` for the full token set it handles, MINUS the
 * Discord-username disambiguation (tooling has no Discord username in
 * scope; a name collision here simply renders both sides identically).
 * Uses a closure replacer so a name containing `$&` is inserted literally.
 */
export function resolvePlaceholders(
  text: string,
  subjectName: string,
  assistantName: string
): string {
  let result = text;

  const userPlaceholders = [...PLACEHOLDERS.USER].sort((a, b) => b.length - a.length);
  for (const placeholder of userPlaceholders) {
    result = result.replace(new RegExp(escapeRegExp(placeholder), 'gi'), () => subjectName);
  }

  const assistantPlaceholders = [...PLACEHOLDERS.ASSISTANT].sort((a, b) => b.length - a.length);
  for (const placeholder of assistantPlaceholders) {
    result = result.replace(new RegExp(escapeRegExp(placeholder), 'gi'), () => assistantName);
  }

  return result;
}

/** One row of the corpus after split + placeholder resolution. */
export interface CorpusFact {
  id: string;
  statement: string;
  salience: number;
  tier: string;
}

export interface CorpusRow {
  id: string;
  createdAt: string;
  contentChars: number;
  split: SplitMemoryResult;
  subjectName: string;
  facts: CorpusFact[];
}

export interface CorpusStats {
  rows: number;
  unparseable: number;
  excludedChunked: number;
  /** Total rows matching the personality/visibility/type WHERE clause, before the largest/latest bound. */
  eligibleTotal: number;
  rowsWithReferenced: number;
  rowsWithoutFacts: number;
  factsPerRowMean: number;
  userCharsP50: number;
  userCharsP95: number;
  assistantCharsP50: number;
  assistantCharsP95: number;
}

export interface CorpusPersonality {
  id: string;
  name: string;
  displayName: string;
  personalityTraits: string;
  personalityTone: string | null;
  conversationalExamples: string | null;
}

export interface CorpusResult {
  personality: CorpusPersonality;
  rows: CorpusRow[];
  stats: CorpusStats;
}

/** Raw row shape returned by the memory sampling query. */
interface RawMemoryRow {
  id: string;
  persona_id: string | null;
  content: string;
  created_at: Date;
  content_chars: number;
}

/** Raw row shape returned by the linked-facts query. */
interface RawFactRow {
  id: string;
  statement: string;
  salience: number;
  tier: string;
  source_memory_ids: string[];
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) {
    return 0;
  }
  const index = Math.min(sortedAsc.length - 1, Math.floor(p * sortedAsc.length));
  return sortedAsc[index];
}

/**
 * Union two already-bounded, already-sorted row sets by id, deduping rows
 * that appear in both (a large-and-recent row). Both inputs come from
 * server-side `ORDER BY ... LIMIT` queries — this function no longer sorts
 * or slices, only dedupes.
 */
export function selectSampleRows(
  byLargest: RawMemoryRow[],
  byLatest: RawMemoryRow[]
): RawMemoryRow[] {
  const seen = new Set<string>();
  const union: RawMemoryRow[] = [];
  for (const row of [...byLargest, ...byLatest]) {
    if (!seen.has(row.id)) {
      seen.add(row.id);
      union.push(row);
    }
  }
  return union;
}

/** Group linked facts by the source memory id each one cites. */
export function groupFactsByMemoryId(facts: RawFactRow[]): Map<string, CorpusFact[]> {
  const byMemoryId = new Map<string, CorpusFact[]>();
  for (const fact of facts) {
    const corpusFact: CorpusFact = {
      id: fact.id,
      statement: fact.statement,
      salience: fact.salience,
      tier: fact.tier,
    };
    for (const memoryId of fact.source_memory_ids) {
      const existing = byMemoryId.get(memoryId);
      if (existing === undefined) {
        byMemoryId.set(memoryId, [corpusFact]);
      } else {
        existing.push(corpusFact);
      }
    }
  }
  for (const list of byMemoryId.values()) {
    list.sort((a, b) => b.salience - a.salience);
  }
  return byMemoryId;
}

/** Build corpus stats from the finished row set plus the counts gathered while building it. */
export function computeCorpusStats(
  rows: CorpusRow[],
  unparseable: number,
  excludedChunked: number,
  eligibleTotal: number
): CorpusStats {
  const rowsWithReferenced = rows.filter(r => r.split.referenced !== null).length;
  const rowsWithoutFacts = rows.filter(r => r.facts.length === 0).length;
  const totalFacts = rows.reduce((sum, r) => sum + r.facts.length, 0);

  const userChars = rows.map(r => r.split.user.length).sort((a, b) => a - b);
  const assistantChars = rows.map(r => r.split.assistant.length).sort((a, b) => a - b);

  return {
    rows: rows.length,
    unparseable,
    excludedChunked,
    eligibleTotal,
    rowsWithReferenced,
    rowsWithoutFacts,
    factsPerRowMean: rows.length > 0 ? totalFacts / rows.length : 0,
    userCharsP50: percentile(userChars, 0.5),
    userCharsP95: percentile(userChars, 0.95),
    assistantCharsP50: percentile(assistantChars, 0.5),
    assistantCharsP95: percentile(assistantChars, 0.95),
  };
}

export interface BuildCorpusOptions {
  slug: string;
  largest: number;
  latest: number;
}

/** Result of the three bounded corpus queries: totals plus the deduped sample. */
interface CorpusSampleFetch {
  eligibleTotal: number;
  excludedChunked: number;
  sample: RawMemoryRow[];
}

/**
 * Three bounded queries instead of fetching every eligible row's full
 * content to select 40 in-process: a count-only query for the corpus-level
 * totals, plus two server-side ORDER BY ... LIMIT queries for the actual
 * sample. Content is only pulled for the rows the sample keeps.
 */
async function fetchSampleRows(
  prisma: PrismaClient,
  personalityId: string,
  options: BuildCorpusOptions
): Promise<CorpusSampleFetch> {
  const countRows = await prisma.$queryRaw<{ eligible: number; chunked: number }[]>`
    SELECT count(*)::int AS eligible,
           count(*) FILTER (WHERE chunk_group_id IS NOT NULL)::int AS chunked
    FROM memories
    WHERE personality_id = ${personalityId}::uuid
      AND visibility = 'normal'
      AND type = 'memory'
  `;

  const rawByLargest = await prisma.$queryRaw<RawMemoryRow[]>`
    SELECT id, persona_id, content, created_at, length(content)::int AS content_chars
    FROM memories
    WHERE personality_id = ${personalityId}::uuid
      AND visibility = 'normal'
      AND type = 'memory'
      AND chunk_group_id IS NULL
    ORDER BY length(content) DESC
    LIMIT ${options.largest}
  `;
  const rawByLatest = await prisma.$queryRaw<RawMemoryRow[]>`
    SELECT id, persona_id, content, created_at, length(content)::int AS content_chars
    FROM memories
    WHERE personality_id = ${personalityId}::uuid
      AND visibility = 'normal'
      AND type = 'memory'
      AND chunk_group_id IS NULL
    ORDER BY created_at DESC
    LIMIT ${options.latest}
  `;
  // Normalize the raw-query timestamp to a real Date once, up front — house
  // precedent (mine-goldens.ts) wraps every raw-query created_at this way
  // rather than trusting the driver to hand back a Date instance.
  const byLargest = rawByLargest.map(row => ({ ...row, created_at: new Date(row.created_at) }));
  const byLatest = rawByLatest.map(row => ({ ...row, created_at: new Date(row.created_at) }));

  return {
    eligibleTotal: countRows[0]?.eligible ?? 0,
    excludedChunked: countRows[0]?.chunked ?? 0,
    sample: selectSampleRows(byLargest, byLatest),
  };
}

/**
 * Fetch and shape one personality's corpus. Read-only: `personality`,
 * `memories`, `memory_facts` are all SELECTed, never written.
 */
export async function buildCorpus(
  prisma: PrismaClient,
  options: BuildCorpusOptions
): Promise<CorpusResult> {
  const personality = await prisma.personality.findUnique({
    where: { slug: options.slug },
    select: {
      id: true,
      name: true,
      displayName: true,
      personalityTraits: true,
      personalityTone: true,
      conversationalExamples: true,
    },
  });
  if (personality === null) {
    throw new UsageError(`Unknown personality slug: '${options.slug}'`);
  }
  const assistantName =
    personality.displayName !== null && personality.displayName.length > 0
      ? personality.displayName
      : personality.name;

  const { eligibleTotal, excludedChunked, sample } = await fetchSampleRows(
    prisma,
    personality.id,
    options
  );

  const personaIds = [
    ...new Set(sample.map(row => row.persona_id).filter((id): id is string => id !== null)),
  ];
  const personaNames = await loadPersonaNames(prisma, personaIds);

  const memoryIds = sample.map(row => row.id);
  const rawFacts =
    memoryIds.length === 0
      ? []
      : await prisma.$queryRaw<RawFactRow[]>`
          SELECT id, statement, salience, tier, source_memory_ids
          FROM memory_facts
          WHERE personality_id = ${personality.id}::uuid
            AND forgotten = false
            AND superseded_at IS NULL
            AND source_memory_ids && ${memoryIds}::text[]
        `;
  const factsByMemoryId = groupFactsByMemoryId(rawFacts);

  let unparseable = 0;
  const rows: CorpusRow[] = [];
  for (const row of sample) {
    const split = splitMemoryContent(row.content);
    if (split === null) {
      unparseable += 1;
      continue;
    }
    const subjectName =
      row.persona_id !== null ? (personaNames.get(row.persona_id) ?? 'User') : 'User';
    const facts = (factsByMemoryId.get(row.id) ?? []).map(fact => ({
      ...fact,
      statement: resolvePlaceholders(fact.statement, subjectName, assistantName),
    }));
    rows.push({
      id: row.id,
      createdAt: row.created_at.toISOString(),
      contentChars: row.content_chars,
      subjectName,
      facts,
      split: {
        user: resolvePlaceholders(split.user, subjectName, assistantName),
        assistant: resolvePlaceholders(split.assistant, subjectName, assistantName),
        referenced:
          split.referenced === null
            ? null
            : resolvePlaceholders(split.referenced, subjectName, assistantName),
      },
    });
  }

  return {
    personality: {
      id: personality.id,
      name: personality.name,
      displayName: assistantName,
      personalityTraits: personality.personalityTraits,
      personalityTone: personality.personalityTone,
      conversationalExamples: personality.conversationalExamples,
    },
    rows,
    stats: computeCorpusStats(rows, unparseable, excludedChunked, eligibleTotal),
  };
}

/** `preferredName` wins over `name` (citext) when non-null. */
async function loadPersonaNames(
  prisma: PrismaClient,
  personaIds: string[]
): Promise<Map<string, string>> {
  if (personaIds.length === 0) {
    return new Map();
  }
  const personas = await prisma.persona.findMany({
    where: { id: { in: personaIds } },
    select: { id: true, name: true, preferredName: true },
    // Bounded by the id list itself — personaIds is already a deduped,
    // in-memory-derived set, not an unbounded query.
    take: personaIds.length,
  });
  const byId = new Map<string, string>();
  for (const persona of personas) {
    byId.set(
      persona.id,
      persona.preferredName !== null && persona.preferredName.length > 0
        ? persona.preferredName
        : persona.name
    );
  }
  return byId;
}
