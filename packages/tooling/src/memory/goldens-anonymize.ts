/**
 * Goldens anonymization: entity detection for the review surface, and the
 * apply step that turns an owner-reviewed swap map + raw corpus into the
 * committable anonymized corpus.
 *
 * Deliberately entity-SWAPS only — a paraphrase would shift the embeddings
 * and quietly invalidate the retrieval A/B the goldens exist to measure.
 * Swapping a name token is a minimal, measurement-preserving edit.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** A sampled corpus row (the raw, unanonymized shape the miner emits). */
export interface CorpusRawRow {
  id: string;
  personalityId: string;
  createdAt: string;
  content: string;
  senders: string[];
}

export interface SwapEntry {
  from: string;
  to: string;
  count: number;
  /** 'swap' (default) applies the replacement; 'keep' leaves the entity as-is. */
  action?: 'swap' | 'keep';
}

export interface SwapMap {
  $comment: string;
  /** Memory ids to exclude from the anonymized corpus entirely. */
  dropRows: string[];
  swaps: SwapEntry[];
}

/** Common English sentence-starters that capitalized-token detection would false-positive on. */
const STOPWORDS = new Set([
  'The',
  'A',
  'An',
  'I',
  'It',
  'He',
  'She',
  'They',
  'We',
  'You',
  'And',
  'But',
  'Or',
  'So',
  'When',
  'While',
  'After',
  'Before',
  'Then',
  'There',
  'This',
  'That',
  'These',
  'Those',
  'What',
  'Why',
  'How',
  'Who',
  'Where',
  'If',
  'In',
  'On',
  'At',
  'As',
  'Not',
  'No',
  'Yes',
  'My',
  'Her',
  'His',
  'Their',
  'Our',
  'Your',
  'Its',
  'One',
  'Two',
  'Both',
  'Some',
  'All',
  'Now',
  'Today',
  'Later',
  'Once',
  'Even',
  'Still',
  'Just',
  'Maybe',
  'Perhaps',
  'Also',
  // Structural/discourse words observed as false positives on a real corpus
  // (message-transcript vocabulary and mid-sentence capitalized starters).
  'Let',
  'Because',
  'Referenced',
  'Reply',
  'Message',
  'Below',
  'Above',
  'More',
  'Less',
  'Every',
  'Each',
  'Very',
  'Much',
  'Many',
  'First',
  'Last',
  'Next',
  'Here',
  'From',
  'With',
  'Without',
  'About',
  'Though',
  'Although',
  'However',
  'Meanwhile',
  'Instead',
  'Rather',
  'Really',
  'Actually',
  'Finally',
  'Again',
  'Never',
  'Always',
  'Anyway',
  'Nothing',
  'Something',
  'Everything',
  'Anything',
  'Someone',
  'Everyone',
  'Anyone',
]);

/**
 * Candidate entities: runs of capitalized words (1-3 tokens, e.g. names and
 * places) plus Discord-flavored handles (@name). Frequency-ordered so the
 * review surface leads with what matters. This is a REVIEW AID, not the
 * privacy gate — the owner's pass over the report is the gate.
 */
export function extractEntityCandidates(contents: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  const capitalizedRun = /\b[A-Z][a-z]{2,}(?:\s[A-Z][a-z]{2,}){0,2}\b/g;
  const handle = /@[\w.]{3,32}/g;

  for (const content of contents) {
    for (const match of content.matchAll(capitalizedRun)) {
      // A sentence-starting stopword greedily absorbs the name that follows
      // ('When Morning Glory') — strip leading stopwords so the counted
      // candidate is the name itself.
      const words = match[0].split(' ');
      while (words.length > 1 && STOPWORDS.has(words[0])) {
        words.shift();
      }
      const candidate = words.join(' ');
      if (words.length > 1 || !STOPWORDS.has(candidate)) {
        counts.set(candidate, (counts.get(candidate) ?? 0) + 1);
      }
    }
    for (const match of content.matchAll(handle)) {
      counts.set(match[0], (counts.get(match[0]) ?? 0) + 1);
    }
  }
  return counts;
}

/** Cap the review table — the long tail of one-off capitalizations is noise. */
const MAX_PROPOSED_SWAPS = 200;
const MIN_ENTITY_COUNT = 2;

/**
 * How many detected candidates fall below the proposal frequency floor —
 * surfaced in the entity report so the reviewer knows the table's coverage.
 * Computed from the candidate counts alone (the swap list is NOT a candidate
 * subset: sender usernames get appended as brand-new entries).
 */
export function countBelowFloor(candidates: Map<string, number>): number {
  return [...candidates.values()].filter(count => count < MIN_ENTITY_COUNT).length;
}

/**
 * Frequency-ordered placeholder proposal. `senders` values are always
 * proposed (they're literal usernames) even below the frequency floor.
 */
export function proposeSwapMap(candidates: Map<string, number>, senders: string[]): SwapMap {
  const senderSet = new Set(senders.filter(sender => sender.length > 0));
  const entries = [...candidates.entries()]
    .filter(([from, count]) => count >= MIN_ENTITY_COUNT || senderSet.has(from))
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_PROPOSED_SWAPS);

  for (const sender of senderSet) {
    if (!entries.some(([from]) => from === sender)) {
      entries.push([sender, candidates.get(sender) ?? 0]);
    }
  }

  const swaps: SwapEntry[] = entries.map(([from, count], index) => ({
    from,
    to: placeholderFor(index),
    count,
  }));
  return {
    $comment:
      'Owner review gate: edit `to`, set action:"keep" to skip a swap, add ids to dropRows to exclude rows. Entity swaps only — never paraphrase (embedding shift invalidates the A/B).',
    dropRows: [],
    swaps,
  };
}

/** PersonA..PersonZ, then PersonA2... — stable by frequency rank. */
function placeholderFor(index: number): string {
  const letter = String.fromCharCode(65 + (index % 26));
  const cycle = Math.floor(index / 26);
  return `Person${letter}${cycle === 0 ? '' : String(cycle + 1)}`;
}

/** Escape a literal for use inside a RegExp. */
function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface AnonymizedRow {
  id: string;
  personalityId: string;
  createdAt: string;
  content: string;
  senders: string[];
}

export interface AnonymizeResult {
  rows: AnonymizedRow[];
  replacements: Map<string, number>;
  /** Swap-map `from` values still present after application (should be empty). */
  leftovers: string[];
}

/**
 * Apply the reviewed swap map: word-boundary, case-insensitive replacement in
 * content + senders; drop rows listed in dropRows; then re-scan for leftovers
 * so a swap that silently failed (regex edge) is loud, not latent.
 */
export function applySwapMap(corpus: CorpusRawRow[], swapMap: SwapMap): AnonymizeResult {
  const dropSet = new Set(swapMap.dropRows);
  const active = swapMap.swaps.filter(swap => swap.action !== 'keep');
  // Longest-first so 'Lila Winters' swaps before 'Lila' can split it.
  const ordered = [...active].sort((a, b) => b.from.length - a.from.length);
  const replacements = new Map<string, number>();

  const rows: AnonymizedRow[] = corpus
    .filter(row => !dropSet.has(row.id))
    .map(row => {
      let content = row.content;
      let senders = row.senders;
      for (const swap of ordered) {
        const pattern = new RegExp(`(?<![\\w])${escapeRegExp(swap.from)}(?![\\w])`, 'gi');
        const before = content;
        // Replacer FUNCTION so `to` is always literal — a hand-edited
        // placeholder containing '$' must never trigger $&/$1 substitution
        // semantics (silent corruption in the one tool meant to catch leakage).
        content = content.replace(pattern, () => swap.to);
        if (before !== content) {
          replacements.set(swap.from, (replacements.get(swap.from) ?? 0) + 1);
        }
        senders = senders.map(sender => sender.replace(pattern, () => swap.to));
      }
      return {
        id: row.id,
        personalityId: row.personalityId,
        createdAt: row.createdAt,
        content,
        senders,
      };
    });

  // Scan the FINAL state of every swapped field — senders carry literal
  // Discord usernames, the most direct PII in a row, so they get the same
  // backstop as content (a later swap's `to` can reintroduce an earlier
  // swap's `from`; this catches that class too).
  const leftovers = active
    .filter(swap => {
      const pattern = new RegExp(`(?<![\\w])${escapeRegExp(swap.from)}(?![\\w])`, 'i');
      return rows.some(
        row => pattern.test(row.content) || row.senders.some(sender => pattern.test(sender))
      );
    })
    .map(swap => swap.from);

  return { rows, replacements, leftovers };
}

export interface AnonymizeGoldensOptions {
  /** Working dir holding corpus-raw.json + the REVIEWED swap map. */
  inDir?: string;
  /** Reviewed swap-map filename inside inDir. */
  swapMapFile?: string;
  /** Output path for the committable corpus. */
  outFile?: string;
}

const DEFAULT_IN_DIR = 'reports/goldens-mining';
// `swap-map.json` (not the miner's `swap-map.proposed.json`) is DELIBERATE:
// the owner must actively promote the reviewed file — accepting the raw
// proposal unreviewed should take an explicit action, not a default.
const DEFAULT_SWAP_MAP = 'swap-map.json';
// Deliberately inside the gitignored /reports/ tree: the corpus is LOCAL-ONLY
// by policy. Owner call after reading real samples — the content is
// intrinsically sensitive beyond what entity swaps can launder (identifying
// narratives, third-party accounts), so it is never committed; the committed
// artifacts are the miner itself and the query goldens. The swaps remain
// defense-in-depth for the local artifact.
const DEFAULT_OUT_FILE = 'reports/goldens-mining/retrieval-corpus.json';

export async function anonymizeGoldens(options: AnonymizeGoldensOptions): Promise<void> {
  const inDir = options.inDir ?? DEFAULT_IN_DIR;
  const corpusPath = join(inDir, 'corpus-raw.json');
  const swapMapPath = join(inDir, options.swapMapFile ?? DEFAULT_SWAP_MAP);

  // Friendly failures for the two expected workflow gaps — a raw ENOENT stack
  // trace points at neither the miner nor the promote step.
  let corpusJson: string;
  try {
    corpusJson = readFileSync(corpusPath, 'utf-8');
  } catch {
    console.error(`No corpus at ${corpusPath} — run memory:mine-goldens first.`);
    process.exitCode = 1;
    return;
  }
  let swapMapJson: string;
  try {
    swapMapJson = readFileSync(swapMapPath, 'utf-8');
  } catch {
    console.error(
      `No swap map at ${swapMapPath} — promote your reviewed map first ` +
        '(cp swap-map.proposed.json swap-map.json; the rename is the explicit accept step).'
    );
    process.exitCode = 1;
    return;
  }
  const corpus = JSON.parse(corpusJson) as CorpusRawRow[];
  const swapMap = JSON.parse(swapMapJson) as SwapMap;

  const result = applySwapMap(corpus, swapMap);

  if (result.leftovers.length > 0) {
    console.error(
      `⚠️ ${result.leftovers.length} swap(s) still present after application: ${result.leftovers.join(', ')}`
    );
    process.exitCode = 1;
    return;
  }

  const outFile = options.outFile ?? DEFAULT_OUT_FILE;
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(
    outFile,
    JSON.stringify(
      {
        $comment:
          'LOCAL-ONLY anonymized retrieval-eval corpus mined from real persona memories (owner-reviewed entity swaps; see memory:mine-goldens). NEVER COMMIT — content is sensitive beyond entity swaps. Dates/personality ids preserved for the recency arm.',
        rows: result.rows,
      },
      null,
      2
    )
  );
  console.log(
    `Anonymized ${result.rows.length} rows (${swapMap.dropRows.length} dropped, ${result.replacements.size} entities swapped) → ${outFile}`
  );
}
