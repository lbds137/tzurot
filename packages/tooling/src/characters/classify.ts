/**
 * Pure classification for `pnpm ops characters:import`: given a parsed card
 * and a snapshot of what the gateway already knows (the list + the fetched
 * rows), decide whether the card is a create, an update, an unchanged
 * no-op, or refused — and, for an update, which fields the write would
 * actually change.
 *
 * No I/O here on purpose: every gateway call the CLI shell makes is resolved
 * up front into `ClassifyContext`, so this module never touches a client, a
 * Railway variable, or the filesystem (its test file reads `update.ts` only
 * for the SIMPLE_FIELDS drift pin).
 */

import {
  PersonalityUpdateSchema,
  type PersonalityFull,
  type PersonalitySummary,
} from '@tzurot/common-types/schemas/api/personality';

export type Row = PersonalityFull;
export type Summary = PersonalitySummary;

/** One parsed card, ready to classify. */
export interface CardInput {
  /** The card's own slug (post-normalization), as it appears in the JSON. */
  slug: string;
  /** Path to the source file, relative to `--dir` — for display only. */
  file: string;
  /** `buildImportPayload(card, card.slug, undefined, undefined)`. */
  payload: Record<string, unknown>;
}

/** Everything classification needs about the gateway's current state. */
export interface ClassifyContext {
  actingDiscordId: string;
  /** `listPersonalities()` result — every row visible to the acting user. */
  summaries: Summary[];
  /** GET results for every slug looked up (card slugs + rename sources);
   *  a slug absent from this map means the gateway returned 404 for it. */
  rowsBySlug: Map<string, Row>;
  /** old slug -> new slug, from `--rename-map`. */
  renameMap: Map<string, string>;
  /** Card slugs allowed to create despite matching an owned row's name. */
  createNew: Set<string>;
  /** Card slugs allowed to update a row owned by someone else. */
  allowForeign: Set<string>;
  /** Whether the acting user is the bot owner (`getUserClientForEnv`'s
   *  result) — the gateway only allows a slug-changing rename for the bot
   *  owner (`checkSlugUpdatePermission`, `update.ts`). */
  isBotOwner: boolean;
  /** Slugs whose GET returned 403 for the acting user. Each such card is
   *  refused on its own; the run continues. */
  forbiddenSlugs: Set<string>;
}

export type Verdict =
  | { kind: 'new' }
  | { kind: 'changed'; targetSlug: string; fields: string[]; ignored: string[] }
  | { kind: 'unchanged'; targetSlug: string; ignored: string[] }
  | { kind: 'refused'; reason: string };

/** The update route's own `simpleFields` list (`update.ts` `buildUpdateData`) —
 *  every field it forwards verbatim from the parsed body when defined.
 *  Exported so `classify.test.ts`'s drift test can diff it against the
 *  route's own array literal. */
export const SIMPLE_FIELDS = [
  'slug',
  'characterInfo',
  'personalityTraits',
  'personalityTone',
  'personalityAge',
  'personalityAppearance',
  'personalityLikes',
  'personalityDislikes',
  'conversationalGoals',
  'conversationalExamples',
  'errorMessage',
  'voiceEnabled',
  'definitionPublic',
] as const;

/** Sorted-keys JSON comparison — sufficient for the JSON-shaped values here
 *  (tags arrays, customFields records); order-insensitive on object keys. */
function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b)
    );
    return Object.fromEntries(entries.map(([k, v]) => [k, sortKeys(v)]));
  }
  return value;
}

/** The shape `PersonalityUpdateSchema.parse` returns — split out of
 *  `diffAgainstRow` into per-group helpers to stay under the complexity budget. */
type ParsedUpdate = ReturnType<typeof PersonalityUpdateSchema.parse>;

/** `update.ts`'s plain field-forwarding loop: every `SIMPLE_FIELDS` member
 *  that's present and differs from the row. */
function diffSimpleFields(parsed: ParsedUpdate, row: Row): string[] {
  const fields: string[] = [];
  for (const field of SIMPLE_FIELDS) {
    const value = parsed[field];
    if (value !== undefined && !deepEqual(value, row[field as keyof Row])) {
      fields.push(field);
    }
  }
  return fields;
}

/** `name` and the derived `displayName` — mirrors `update.ts`'s two
 *  successive `if` blocks (name-sets-displayName-when-absent, then an
 *  explicit displayName overrides it). This mirror is maintained BY HAND —
 *  unlike `SIMPLE_FIELDS`, there is no structural drift test comparing it
 *  against `update.ts`'s own logic; `classify.test.ts`'s scenario tests
 *  (name-only, displayName-only, both, neither) are what pin its current
 *  behavior. */
function diffNameFields(parsed: ParsedUpdate, row: Row): string[] {
  const fields: string[] = [];
  if (parsed.name !== undefined && parsed.name !== row.name) {
    fields.push('name');
  }

  if (parsed.displayName !== undefined) {
    const hasDisplayName = parsed.displayName !== null && parsed.displayName !== '';
    const effective = hasDisplayName ? parsed.displayName : (parsed.name ?? row.name);
    if (effective !== row.displayName) {
      fields.push('displayName');
    }
  } else if (parsed.name !== undefined && parsed.name !== row.displayName) {
    fields.push('displayName');
  }
  return fields;
}

/** Tags, customFields (value-compared), and the two media fields, which are
 *  never diffable — a non-null string always counts as a change. */
function diffListAndMediaFields(parsed: ParsedUpdate, row: Row): string[] {
  const fields: string[] = [];
  if (parsed.tags !== undefined && !deepEqual(parsed.tags, row.tags)) {
    fields.push('tags');
  }
  if (parsed.customFields !== undefined && !deepEqual(parsed.customFields, row.customFields)) {
    fields.push('customFields');
  }
  if (typeof parsed.avatarData === 'string') {
    fields.push('avatarData');
  }
  if (typeof parsed.voiceReferenceData === 'string') {
    fields.push('voiceReferenceData');
  }
  return fields;
}

/** The outcome of diffing a payload against a row: either the schema
 *  accepted it (with the resulting field/ignored lists), or it didn't and
 *  the caller should refuse the card instead of throwing mid-batch. */
export type DiffResult =
  { ok: true; fields: string[]; ignored: string[] } | { ok: false; reason: string };

/**
 * Diff a parsed import payload against the row an update would target,
 * mirroring `update.ts` `buildUpdateData` field-by-field so the report never
 * claims a write the route wouldn't actually make. Uses `safeParse` — a card
 * that fails the update schema is refused, not a thrown exception that would
 * abort the whole batch.
 */
export function diffAgainstRow(payload: Record<string, unknown>, row: Row): DiffResult {
  const result = PersonalityUpdateSchema.safeParse(payload);
  if (!result.success) {
    const firstIssue = result.error.issues[0];
    const path = firstIssue !== undefined ? firstIssue.path.join('.') : '(root)';
    return { ok: false, reason: `payload rejected by the update schema (${path})` };
  }
  const parsed = result.data;
  const fields = [
    ...diffSimpleFields(parsed, row),
    ...diffNameFields(parsed, row),
    ...diffListAndMediaFields(parsed, row),
  ];
  // The update route never writes isPublic — reported separately so the
  // report can say so instead of silently dropping the intent.
  const ignored =
    parsed.isPublic !== undefined && parsed.isPublic !== row.isPublic ? ['isPublic'] : [];

  return { ok: true, fields, ignored };
}

/** `old` slug whose rename-map entry targets `newSlug`, if any. */
function findRenameSource(newSlug: string, renameMap: Map<string, string>): string | undefined {
  for (const [old, target] of renameMap) {
    if (target === newSlug) {
      return old;
    }
  }
  return undefined;
}

function findSummary(summaries: Summary[], slug: string): Summary | undefined {
  return summaries.find(s => s.slug === slug);
}

/** Trim + lowercase for a name/displayName equality check that ignores case
 *  and incidental whitespace (the duplicate guard's own comparison). */
function normalizeForCompare(value: string): string {
  return value.trim().toLowerCase();
}

/** `payload.name`/`payload.displayName` candidate strings, trimmed, non-empty. */
function candidateNames(payload: Record<string, unknown>): string[] {
  return [payload.name, payload.displayName]
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map(normalizeForCompare);
}

/** `row.name`/`row.displayName` candidate strings, trimmed, non-empty. */
function summaryNames(summary: Summary): string[] {
  return [summary.name, summary.displayName]
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map(normalizeForCompare);
}

function classifyAgainstRow(
  card: CardInput,
  targetSlug: string,
  row: Row,
  ctx: ClassifyContext
): Verdict {
  const summary = findSummary(ctx.summaries, targetSlug);
  if (summary === undefined) {
    return { kind: 'refused', reason: 'owner unknown (not in list)' };
  }
  const isForeign = summary.ownerDiscordId !== ctx.actingDiscordId;
  if (isForeign && !ctx.allowForeign.has(card.slug)) {
    return { kind: 'refused', reason: 'owned by another user' };
  }

  const diff = diffAgainstRow(card.payload, row);
  if (!diff.ok) {
    return { kind: 'refused', reason: diff.reason };
  }
  const { fields, ignored } = diff;
  return fields.length > 0
    ? { kind: 'changed', targetSlug, fields, ignored }
    : { kind: 'unchanged', targetSlug, ignored };
}

function classifyNew(card: CardInput, ctx: ClassifyContext): Verdict {
  const candidates = candidateNames(card.payload);
  const duplicate = ctx.summaries
    .filter(s => s.ownerDiscordId === ctx.actingDiscordId)
    .find(s => summaryNames(s).some(name => candidates.includes(name)));

  if (duplicate !== undefined && !ctx.createNew.has(card.slug)) {
    return { kind: 'refused', reason: `duplicate of ${duplicate.slug}` };
  }
  return { kind: 'new' };
}

/**
 * Classify one card against the gateway snapshot in `ctx`. See the module
 * doc for the shape; rule order (rename, then existing-row, then new) mirrors
 * the CLI spec: a card that both renames and would otherwise look new is
 * always a rename.
 */
export function classifyCard(card: CardInput, ctx: ClassifyContext): Verdict {
  const renameSource = findRenameSource(card.slug, ctx.renameMap);
  if (renameSource !== undefined) {
    // `checkSlugUpdatePermission` (update.ts) allows a slug change only for
    // the bot owner; refuse here so the report never promises a rename the
    // gateway would 403.
    if (!ctx.isBotOwner) {
      return { kind: 'refused', reason: 'slug changes need the bot owner' };
    }
    if (ctx.forbiddenSlugs.has(renameSource)) {
      return { kind: 'refused', reason: 'not visible to the acting user' };
    }
    const sourceRow = ctx.rowsBySlug.get(renameSource);
    if (sourceRow === undefined) {
      return { kind: 'refused', reason: `rename source ${renameSource} not found` };
    }
    if (ctx.forbiddenSlugs.has(card.slug)) {
      return {
        kind: 'refused',
        reason: `rename target ${card.slug} not visible to the acting user`,
      };
    }
    if (ctx.rowsBySlug.has(card.slug)) {
      return { kind: 'refused', reason: `rename target ${card.slug} already exists` };
    }
    return classifyAgainstRow(card, renameSource, sourceRow, ctx);
  }

  if (ctx.forbiddenSlugs.has(card.slug)) {
    return { kind: 'refused', reason: 'not visible to the acting user' };
  }

  const existingRow = ctx.rowsBySlug.get(card.slug);
  if (existingRow !== undefined) {
    return classifyAgainstRow(card, card.slug, existingRow, ctx);
  }

  return classifyNew(card, ctx);
}

/**
 * Classify every card in report order, applying two same-batch guards on top
 * of `classifyCard`'s single-card result (which stays pure — no batch state):
 *
 * - A `new` card whose normalized name/displayName matches an EARLIER card in
 *   the same batch that was also classified `new` is refused as a likely
 *   duplicate, unless the later card's slug is in `--create-new`.
 * - A `changed`/`unchanged` card whose verdict targets a slug an EARLIER
 *   card in the same batch already claimed (two cards writing the same row —
 *   directly, or one direct and one via `--rename-map`) is refused; no
 *   override flag, since one of the two writes would always clobber the
 *   other's classification.
 */
export function classifyBatch(cards: CardInput[], ctx: ClassifyContext): Verdict[] {
  const priorNewCards: { slug: string; names: string[] }[] = [];
  const claimedTargets = new Map<string, string>(); // targetSlug -> claiming card's slug
  const verdicts: Verdict[] = [];
  for (const card of cards) {
    const verdict = classifyCard(card, ctx);
    if (verdict.kind === 'changed' || verdict.kind === 'unchanged') {
      const priorCardSlug = claimedTargets.get(verdict.targetSlug);
      if (priorCardSlug !== undefined) {
        verdicts.push({
          kind: 'refused',
          reason: `same target as ${priorCardSlug} (same batch)`,
        });
        continue;
      }
      claimedTargets.set(verdict.targetSlug, card.slug);
      verdicts.push(verdict);
      continue;
    }
    if (verdict.kind !== 'new') {
      verdicts.push(verdict);
      continue;
    }
    const candidates = candidateNames(card.payload);
    const duplicate = priorNewCards.find(p => p.names.some(name => candidates.includes(name)));
    if (duplicate !== undefined && !ctx.createNew.has(card.slug)) {
      verdicts.push({
        kind: 'refused',
        reason: `duplicate of ${duplicate.slug} (same batch)`,
      });
      continue;
    }
    priorNewCards.push({ slug: card.slug, names: candidates });
    verdicts.push(verdict);
  }
  return verdicts;
}
