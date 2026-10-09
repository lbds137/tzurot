/**
 * `pnpm ops characters:import` — bulk-import character cards through the
 * exact same builder, schema, and gateway routes as the Discord
 * `/character import` command.
 *
 * Dry run by default: every card is validated up front (schema + duplicate
 * slugs among the selected files), and any failure aborts with ZERO gateway
 * calls. Only `--apply` writes anything, and only when no card was refused.
 *
 * Output never prints a card field VALUE — only slugs, relative file paths,
 * field NAMES, and counts (the values are the operator's private character
 * data, not something this tool's own logs should carry).
 */

import chalk from 'chalk';
import type { UserClient } from '@tzurot/clients';
import {
  validateEnvironment,
  showEnvironmentBanner,
  requireProductionConfirmation,
} from '../utils/env-runner.js';
import { getUserClientForEnv } from '../utils/gateway-client.js';
import {
  classifyBatch,
  type CardInput,
  type ClassifyContext,
  type Row,
  type Verdict,
} from './classify.js';
import { parseListFlag, loadAndValidateCards, type CharactersImportOptions } from './load-cards.js';
import { DEFAULT_AVATAR_STATE_PATH, prepareAvatarRun, type AvatarRun } from './avatars.js';

interface ImportDeps {
  getUserClient?: typeof getUserClientForEnv;
  /** Where `--avatars` records applied image hashes (tests override). */
  avatarStatePath?: string;
}

/** Mirrors `fetchUserPersonalities`'s `take: 100` cap on the user's PRIVATE
 *  owned/co-owned query (`services/api-gateway/src/routes/user/personality/list.ts`,
 *  the `isPublic: false` findMany) — every private row in a non-owner's list is one of that capped
 *  query's rows, so at or above this many PRIVATE rows the list may already
 *  be truncated and classifying against it could silently miss an owned row.
 *  The public query (`take: 500`) is covered separately by the 500-row abort
 *  above. The co-owner id lookup that feeds the private query (`personalityOwner.findMany`) is
 *  also capped at 100, and this tool cannot detect that truncation from the
 *  list response. */
const NON_OWNER_PRIVATE_ROSTER_CAP = 100;

/** Slugs to GET: every card slug, plus a rename source whose target is one
 *  of the selected cards. */
function slugsToFetch(cards: CardInput[], renameMap: Map<string, string>): string[] {
  const slugs = new Set<string>();
  for (const card of cards) {
    slugs.add(card.slug);
  }
  for (const [old, target] of renameMap) {
    if (cards.some(c => c.slug === target)) {
      slugs.add(old);
    }
  }
  return [...slugs];
}

interface FetchRowsResult {
  rowsBySlug: Map<string, Row>;
  /** Slugs whose GET returned 403 — a per-card refusal, not fatal. */
  forbiddenSlugs: Set<string>;
}

/** Fetch every needed row sequentially. A 403 is recorded in `forbiddenSlugs`
 *  (the card targeting that slug is refused, not the whole run); any other
 *  non-404 failure returns null (and reports) — the caller aborts
 *  immediately in that case. */
async function fetchRows(client: UserClient, slugs: string[]): Promise<FetchRowsResult | null> {
  const rowsBySlug = new Map<string, Row>();
  const forbiddenSlugs = new Set<string>();
  for (const slug of slugs) {
    const result = await client.getPersonality(slug);
    if (result.ok) {
      rowsBySlug.set(slug, result.data.personality);
    } else if (result.status === 403) {
      forbiddenSlugs.add(slug);
    } else if (result.status !== 404) {
      console.error(chalk.red(`Failed to fetch ${slug}: status ${String(result.status)}`));
      return null;
    }
  }
  return { rowsBySlug, forbiddenSlugs };
}

function formatIgnoredSuffix(ignored: string[]): string {
  return ignored.length > 0 ? ` (not applied by update: ${ignored.join(', ')})` : '';
}

function printVerdictLine(card: CardInput, verdict: Verdict): void {
  const label = verdict.kind.padEnd(9);
  let suffix = '';
  if (verdict.kind === 'changed') {
    suffix = `: ${verdict.fields.join(', ')}${formatIgnoredSuffix(verdict.ignored)}`;
  } else if (verdict.kind === 'refused') {
    suffix = `: ${verdict.reason}`;
  } else if (verdict.kind === 'unchanged') {
    suffix = formatIgnoredSuffix(verdict.ignored);
  }
  console.log(`  ${label}  ${card.slug}  ${card.file}${suffix}`);
}

interface Tally {
  new: number;
  changed: number;
  unchanged: number;
  refused: number;
}

function printReport(cards: CardInput[], verdicts: Verdict[]): Tally {
  const tally: Tally = { new: 0, changed: 0, unchanged: 0, refused: 0 };
  for (let i = 0; i < cards.length; i++) {
    const verdict = verdicts[i];
    printVerdictLine(cards[i], verdict);
    tally[verdict.kind]++;
  }
  console.log(
    `${String(cards.length)} cards: ${String(tally.new)} new, ${String(tally.changed)} changed, ` +
      `${String(tally.unchanged)} unchanged, ${String(tally.refused)} refused`
  );
  return tally;
}

/** Write every new/changed card in report order, stopping at the first
 *  failure. `onWritten` fires for each card whose write succeeded. Returns
 *  the written summary, or null if a write failed. */
async function writeCards(
  client: UserClient,
  cards: CardInput[],
  verdicts: Verdict[],
  onWritten: (card: CardInput) => void
): Promise<{ created: number; updated: number } | null> {
  let created = 0;
  let updated = 0;
  const written: string[] = [];
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const verdict = verdicts[i];
    if (verdict.kind === 'new') {
      const result = await client.createPersonality(
        card.payload as Parameters<UserClient['createPersonality']>[0]
      );
      if (!result.ok) {
        console.error(chalk.red(`Failed to create ${card.slug}: status ${String(result.status)}`));
        console.error(chalk.dim(`Already written: ${written.join(', ') || '(none)'}`));
        return null;
      }
      created++;
      onWritten(card);
      written.push(`created ${card.slug}`);
    } else if (verdict.kind === 'changed') {
      const result = await client.updatePersonality(verdict.targetSlug, card.payload);
      if (!result.ok) {
        console.error(
          chalk.red(`Failed to update ${verdict.targetSlug}: status ${String(result.status)}`)
        );
        console.error(chalk.dim(`Already written: ${written.join(', ') || '(none)'}`));
        return null;
      }
      updated++;
      onWritten(card);
      written.push(`updated ${verdict.targetSlug}`);
    }
  }
  return { created, updated };
}

interface GatewayState {
  client: UserClient;
  actingDiscordId: string;
  isBotOwner: boolean;
  summaries: ClassifyContext['summaries'];
  rowsBySlug: Map<string, Row>;
  forbiddenSlugs: Set<string>;
}

/** Resolve the client, list personalities, and fetch every needed row.
 *  Prints its own failures — a null return means the caller aborts. */
async function connectAndFetch(
  opts: CharactersImportOptions,
  cards: CardInput[],
  renameMap: Map<string, string>,
  getUserClient: typeof getUserClientForEnv
): Promise<GatewayState | null> {
  let resolved;
  try {
    resolved = getUserClient(opts.env, opts.asUser);
  } catch (error) {
    console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
    return null;
  }
  const { client, actingDiscordId, isBotOwner } = resolved;
  console.log(chalk.dim(`Acting as: ${isBotOwner ? 'bot owner' : '--as-user'}`));

  const listResult = await client.listPersonalities();
  if (!listResult.ok) {
    console.error(chalk.red(`Failed to list personalities: status ${String(listResult.status)}`));
    return null;
  }
  const summaries = listResult.data.personalities;
  if (summaries.length >= 500) {
    console.error(
      chalk.red(
        'The gateway list is capped at 500 rows; the duplicate/ownership guards would be ' +
          'incomplete against a larger roster. Aborting.'
      )
    );
    return null;
  }

  if (!isBotOwner) {
    const privateCount = summaries.filter(s => s.isPublic === false).length;
    if (privateCount >= NON_OWNER_PRIVATE_ROSTER_CAP) {
      console.error(
        chalk.red(
          `The list contains ${String(privateCount)} private personalities, at or above the ` +
            `gateway's ${String(NON_OWNER_PRIVATE_ROSTER_CAP)}-row cap on the non-owner private ` +
            'listing; the roster this run would classify against may be truncated. Aborting.'
        )
      );
      return null;
    }
  }

  const fetched = await fetchRows(client, slugsToFetch(cards, renameMap));
  if (fetched === null) {
    return null;
  }

  return {
    client,
    actingDiscordId,
    isBotOwner,
    summaries,
    rowsBySlug: fetched.rowsBySlug,
    forbiddenSlugs: fetched.forbiddenSlugs,
  };
}

/** Fold the avatar run (when `--avatars` is on) into the classified batch:
 *  refusals replace verdicts, and recreated rows get their image re-sent. */
function applyAvatarVerdicts(
  avatarRun: AvatarRun | null,
  cards: CardInput[],
  classified: Verdict[]
): { verdicts: Verdict[]; cards: CardInput[] } {
  if (avatarRun === null) {
    return { verdicts: classified, cards };
  }
  const verdicts = avatarRun.applyRefusals(classified);
  return { verdicts, cards: avatarRun.resendForNewRows(verdicts) };
}

export async function charactersImport(
  opts: CharactersImportOptions,
  deps?: ImportDeps
): Promise<void> {
  validateEnvironment(opts.env);
  showEnvironmentBanner(opts.env);

  if (opts.dir.length === 0) {
    console.error(chalk.red('--dir is required'));
    process.exitCode = 1;
    return;
  }

  const loaded = loadAndValidateCards(opts);
  if (loaded === null) {
    process.exitCode = 1;
    return;
  }
  const { renameMap } = loaded;

  let cards = loaded.cards;
  let avatarRun: AvatarRun | null = null;
  if (opts.avatars !== undefined) {
    avatarRun = prepareAvatarRun(
      opts.avatars,
      opts.env,
      cards,
      deps?.avatarStatePath ?? DEFAULT_AVATAR_STATE_PATH
    );
    if (avatarRun === null) {
      process.exitCode = 1;
      return;
    }
    cards = avatarRun.cards;
  }

  const getUserClient = deps?.getUserClient ?? getUserClientForEnv;
  const state = await connectAndFetch(opts, cards, renameMap, getUserClient);
  if (state === null) {
    process.exitCode = 1;
    return;
  }

  const ctx: ClassifyContext = {
    actingDiscordId: state.actingDiscordId,
    summaries: state.summaries,
    rowsBySlug: state.rowsBySlug,
    renameMap,
    createNew: parseListFlag(opts.createNew),
    allowForeign: parseListFlag(opts.allowForeign),
    isBotOwner: state.isBotOwner,
    forbiddenSlugs: state.forbiddenSlugs,
  };
  const classified = classifyBatch(cards, ctx);
  const finalized = applyAvatarVerdicts(avatarRun, cards, classified);
  const verdicts = finalized.verdicts;
  cards = finalized.cards;
  const tally = printReport(cards, verdicts);
  avatarRun?.printSummary(verdicts);

  if (opts.apply !== true) {
    console.log(chalk.dim('Dry run — nothing written. Re-run with --apply to write.'));
    return;
  }

  if (tally.refused > 0) {
    console.error(chalk.red('Refused cards block apply; nothing was written.'));
    process.exitCode = 1;
    return;
  }

  if (opts.env === 'prod' && opts.force !== true) {
    await requireProductionConfirmation('write character cards to production');
  }

  const writeResult = await writeCards(state.client, cards, verdicts, card =>
    avatarRun?.onWritten(card)
  );
  avatarRun?.persist();
  if (writeResult === null) {
    process.exitCode = 1;
    return;
  }
  console.log(
    `Wrote ${String(writeResult.created)} created, ${String(writeResult.updated)} updated.`
  );
}
