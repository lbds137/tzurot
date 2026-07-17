/**
 * Secret-rotation tooling: the per-environment rotation ledger plus the
 * staged BYOK encryption-key rotation.
 *
 * Ledger: `secret_rotations` rows (name, rotatedAt, intervalDays) live in
 * each environment's own database (excluded from db-sync). The gateway's
 * internal /secret-rotations route computes overdue state from them; the
 * bot-client nag scheduler posts to the owner channel when anything is due.
 *
 * BYOK rotation is STAGED because services must hold both keys while rows
 * migrate (dual-key window — see common-types/utils/encryption.ts):
 *   stage 1 (stage):     mint new key; set CURRENT=new, PREVIOUS=old on
 *                        api-gateway + ai-worker; wait for redeploys.
 *   stage 2 (reencrypt): re-encrypt every user_api_keys/user_credentials row
 *                        still on the previous key; verify sweep.
 *   stage 3 (finalize):  verify again, clear PREVIOUS (set to "" — the
 *                        Railway CLI cannot delete variables), stamp ledger.
 *
 * Secret VALUES never reach stdout; only names, counts, and hashes-free
 * confirmations are printed. Known limitation: `railway variables --set` has
 * no stdin form, so key material transits this process's argv (visible via
 * /proc/<pid>/cmdline to same-privilege processes for the call's duration) —
 * same exposure as every existing setup-railway-variables path.
 */

import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import chalk from 'chalk';
import { createPrismaClient } from '@tzurot/common-types/services/prisma';
import { DB_POOL_DEFAULTS } from '@tzurot/common-types/services/poolConfig';
import {
  decryptWithKey,
  encryptWithKey,
  parseEncryptionKeyMaterial,
  type EncryptedData,
} from '@tzurot/common-types/utils/encryption';
import { getRailwayDatabaseUrl, getRailwayEnvName } from '../utils/env-runner.js';

/** Default rotation intervals (owner decision: 180d BYOK, 365d the rest). */
export const DEFAULT_INTERVALS: Record<string, number> = {
  'byok-encryption-key': 180,
};
export const DEFAULT_INTERVAL_DAYS = 365;

const GATEWAY_SERVICE = 'api-gateway';
const BYOK_SERVICES = [GATEWAY_SERVICE, 'ai-worker'] as const;
const CURRENT_VAR = 'API_KEY_ENCRYPTION_KEY';
const PREVIOUS_VAR = 'API_KEY_ENCRYPTION_KEY_PREVIOUS';
/** Bounded reads; both tables are one row per (user, provider/service). */
const ROW_CAP = 50_000;

/**
 * A capped read means rows beyond the cap were NEVER examined — finalizing
 * on a capped verify could orphan them permanently. Loud, and returned so
 * callers can refuse.
 */
export function warnIfCapped(count: number, label: string): boolean {
  if (count < ROW_CAP) {
    return false;
  }
  console.log(
    chalk.red(
      `⚠️  ${label}: read hit the ${ROW_CAP}-row cap — rows beyond it were NOT examined. Do not finalize; raise the cap and re-run.`
    )
  );
  return true;
}

export type SecretsEnv = 'dev' | 'prod';

interface EncryptedRow extends EncryptedData {
  id: string;
}

/**
 * The slice of a Prisma delegate the rotation needs. user_api_keys and
 * user_credentials share the iv/content/tag column shape, but their generated
 * delegates form an uncallable union (each member's generics are incompatible
 * with the other's), so the table selector casts each arm down to this
 * structural interface instead.
 */
interface EncryptedRowDelegate {
  findMany(args: {
    select: { id: true; iv: true; content: true; tag: true };
    take: number;
  }): Promise<EncryptedRow[]>;
  updateMany(args: {
    where: { id: string; iv: string; content: string; tag: string };
    data: EncryptedData;
  }): Promise<{ count: number }>;
}

function delegateFor(
  prisma: ReturnType<typeof createPrismaClient>['prisma'],
  table: 'userApiKey' | 'userCredential'
): EncryptedRowDelegate {
  return table === 'userApiKey' ? prisma.userApiKey : prisma.userCredential;
}

/** Read one variable from a Railway service (value stays in-process). */
export function getServiceVariable(env: SecretsEnv, service: string, key: string): string {
  const value = readServiceVariable(env, service, key);
  if (value === undefined) {
    throw new Error(`${key} not found on ${service} (${env})`);
  }
  return value;
}

/**
 * Absent-tolerant read: a variable that has NEVER been created returns '' —
 * the same "unset" the runtime contract uses for a cleared variable (the
 * Railway CLI cannot delete, only set to empty). PREVIOUS reads must use
 * this: before the first rotation ever, the variable does not exist.
 */
export function getServiceVariableOrEmpty(env: SecretsEnv, service: string, key: string): string {
  return readServiceVariable(env, service, key) ?? '';
}

function readServiceVariable(env: SecretsEnv, service: string, key: string): string | undefined {
  const output = execFileSync(
    'railway',
    ['variables', '--environment', getRailwayEnvName(env), '--service', service, '--json'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  );
  const parsed = JSON.parse(output) as Record<string, string>;
  return parsed[key];
}

/** Set variables on a Railway service without echoing values. */
export function setServiceVariables(
  env: SecretsEnv,
  service: string,
  vars: Record<string, string>
): void {
  const args = ['variables', '--environment', getRailwayEnvName(env), '--service', service];
  for (const [key, value] of Object.entries(vars)) {
    args.push('--set', `${key}=${value}`);
  }
  execFileSync('railway', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  console.log(chalk.green(`  set ${Object.keys(vars).join(', ')} on ${service} (${env})`));
}

/** Open a Prisma client against the target environment's database. */
async function withEnvPrisma<T>(
  env: SecretsEnv,
  fn: (prisma: Awaited<ReturnType<typeof createPrismaClient>>['prisma']) => Promise<T>
): Promise<T> {
  const previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = getRailwayDatabaseUrl(env);
  const { prisma, dispose } = createPrismaClient({ max: DB_POOL_DEFAULTS.TRANSIENT_MAX });
  try {
    return await fn(prisma);
  } finally {
    await dispose();
    process.env.DATABASE_URL = previousUrl;
  }
}

/** Upsert a ledger row: the secret was rotated NOW. */
export async function markSecretRotated(options: {
  env: SecretsEnv;
  name: string;
  intervalDays?: number;
}): Promise<void> {
  const { env, name } = options;
  const intervalDays = options.intervalDays ?? DEFAULT_INTERVALS[name] ?? DEFAULT_INTERVAL_DAYS;

  await withEnvPrisma(env, async prisma => {
    await prisma.secretRotation.upsert({
      where: { name },
      create: { name, rotatedAt: new Date(), intervalDays },
      // Preserve an operator-customized interval: an un-flagged rotation
      // (incl. every stage-3 finalize) must not reset it to the default map.
      update: {
        rotatedAt: new Date(),
        ...(options.intervalDays !== undefined ? { intervalDays } : {}),
      },
    });
  });
  console.log(chalk.green(`✅ ledger: ${name} marked rotated (interval ${intervalDays}d, ${env})`));
}

/** Print the ledger with overdue state. */
export async function showRotationStatus(options: { env: SecretsEnv }): Promise<void> {
  const rows = await withEnvPrisma(options.env, prisma =>
    prisma.secretRotation.findMany({ orderBy: { name: 'asc' }, take: 100 })
  );
  if (rows.length === 0) {
    console.log(chalk.yellow('Ledger is empty — seed it with secrets:mark-rotated <name>.'));
    return;
  }
  const now = Date.now();
  for (const row of rows) {
    const dueAt = row.rotatedAt.getTime() + row.intervalDays * 24 * 60 * 60 * 1000;
    const overdueDays = Math.max(0, Math.floor((now - dueAt) / (24 * 60 * 60 * 1000)));
    const state = overdueDays > 0 ? chalk.red(`OVERDUE ${overdueDays}d`) : chalk.green('ok');
    console.log(
      `  ${row.name.padEnd(28)} rotated ${row.rotatedAt.toISOString().slice(0, 10)}  every ${String(row.intervalDays).padStart(3)}d  ${state}`
    );
  }
}

interface ReencryptTally {
  alreadyCurrent: number;
  reencrypted: number;
  unreadable: number;
  /** Rows whose ciphertext changed between snapshot and write (concurrent
   *  user update/delete) — skipped, never overwritten; a re-run reclassifies
   *  them (a mid-window user write already used the CURRENT key). */
  changedConcurrently: number;
}

/** Re-encrypt one table's rows from previous → current key. */
async function reencryptTable(
  prisma: Awaited<ReturnType<typeof createPrismaClient>>['prisma'],
  table: 'userApiKey' | 'userCredential',
  currentKey: Buffer,
  previousKey: Buffer
): Promise<ReencryptTally> {
  const delegate = delegateFor(prisma, table);
  const rows = await delegate.findMany({
    select: { id: true, iv: true, content: true, tag: true },
    take: ROW_CAP,
  });
  warnIfCapped(rows.length, `reencrypt ${table}`);

  const tally: ReencryptTally = {
    alreadyCurrent: 0,
    reencrypted: 0,
    unreadable: 0,
    changedConcurrently: 0,
  };
  for (const row of rows) {
    try {
      decryptWithKey(row, currentKey);
      tally.alreadyCurrent += 1;
      continue;
    } catch {
      // Not on the current key — fall through to the previous key.
    }
    let next: EncryptedData;
    try {
      const plaintext = decryptWithKey(row, previousKey);
      next = encryptWithKey(plaintext, currentKey);
    } catch {
      // Matches NEITHER key — pre-existing corruption or a key we no longer
      // hold. Left untouched; surfaced in the tally for manual triage.
      tally.unreadable += 1;
      continue;
    }
    // Optimistic-concurrency guard: match the FULL snapshot ciphertext, not
    // just the id. count 0 = the user updated (services encrypt with the
    // current key mid-window, so a re-run sees it as alreadyCurrent) or
    // deleted the row between snapshot and write — never overwrite either.
    const result = await delegate.updateMany({
      where: { id: row.id, iv: row.iv, content: row.content, tag: row.tag },
      data: { iv: next.iv, content: next.content, tag: next.tag },
    });
    if (result.count === 1) {
      tally.reencrypted += 1;
    } else {
      tally.changedConcurrently += 1;
    }
  }
  return tally;
}

/** Verify every row decrypts with the CURRENT key alone. Returns failures. */
async function countNonCurrentRows(
  prisma: Awaited<ReturnType<typeof createPrismaClient>>['prisma'],
  currentKey: Buffer
): Promise<number> {
  let failures = 0;
  for (const table of ['userApiKey', 'userCredential'] as const) {
    const delegate = delegateFor(prisma, table);
    const rows = await delegate.findMany({
      select: { id: true, iv: true, content: true, tag: true },
      take: ROW_CAP,
    });
    // A capped verify cannot prove completeness — count it as a failure so
    // stage 3 refuses to close the window on a truncated view.
    if (warnIfCapped(rows.length, `verify ${table}`)) {
      failures += 1;
    }
    for (const row of rows) {
      try {
        decryptWithKey(row, currentKey);
      } catch {
        failures += 1;
      }
    }
  }
  return failures;
}

/** Staged BYOK key rotation. See module doc for the three stages. */
export async function rotateByokKey(options: { env: SecretsEnv; stage: string }): Promise<void> {
  const { env, stage } = options;

  if (stage === '1' || stage === 'stage') {
    // A second stage-1 while a window is open would demote the CURRENT key to
    // PREVIOUS and DISCARD the original previous key — permanently orphaning
    // every row still encrypted under it. Refuse; the open window must be
    // finished (stage 2 then 3) first.
    const openPrevious = getServiceVariableOrEmpty(env, GATEWAY_SERVICE, PREVIOUS_VAR);
    if (openPrevious !== '') {
      throw new Error(
        'A rotation window is already open (PREVIOUS is set) — run stage 2 then stage 3 to close it before starting a new rotation.'
      );
    }
    const current = getServiceVariable(env, GATEWAY_SERVICE, CURRENT_VAR);
    parseEncryptionKeyMaterial(current, CURRENT_VAR); // sanity before touching anything
    const next = crypto.randomBytes(32).toString('hex');
    for (const service of BYOK_SERVICES) {
      setServiceVariables(env, service, { [CURRENT_VAR]: next, [PREVIOUS_VAR]: current });
    }
    console.log(
      chalk.cyan(
        '\nStage 1 complete. Both services now hold current+previous keys.\n' +
          'Wait for the redeploys to finish, then run stage 2 (reencrypt).'
      )
    );
    return;
  }

  if (stage === '2' || stage === 'reencrypt') {
    const currentKey = parseEncryptionKeyMaterial(
      getServiceVariable(env, GATEWAY_SERVICE, CURRENT_VAR),
      CURRENT_VAR
    );
    const previousRaw = getServiceVariableOrEmpty(env, GATEWAY_SERVICE, PREVIOUS_VAR);
    if (previousRaw === '') {
      throw new Error('No rotation window is open (PREVIOUS is empty) — run stage 1 first.');
    }
    const previousKey = parseEncryptionKeyMaterial(previousRaw, PREVIOUS_VAR);

    await withEnvPrisma(env, async prisma => {
      for (const table of ['userApiKey', 'userCredential'] as const) {
        const tally = await reencryptTable(prisma, table, currentKey, previousKey);
        console.log(
          `  ${table}: ${tally.reencrypted} re-encrypted, ${tally.alreadyCurrent} already current, ${tally.changedConcurrently} changed concurrently (skipped), ${tally.unreadable} unreadable`
        );
        if (tally.unreadable > 0) {
          console.log(
            chalk.yellow(
              `  ⚠️  ${tally.unreadable} row(s) match neither key — triage before finalizing.`
            )
          );
        }
      }
      const remaining = await countNonCurrentRows(prisma, currentKey);
      if (remaining === 0) {
        console.log(chalk.green('\nAll rows verified on the current key. Run stage 3 (finalize).'));
      } else {
        console.log(chalk.red(`\n${remaining} row(s) still not on the current key.`));
      }
    });
    return;
  }

  if (stage === '3' || stage === 'finalize') {
    const currentKey = parseEncryptionKeyMaterial(
      getServiceVariable(env, GATEWAY_SERVICE, CURRENT_VAR),
      CURRENT_VAR
    );
    const remaining = await withEnvPrisma(env, prisma => countNonCurrentRows(prisma, currentKey));
    if (remaining > 0) {
      throw new Error(
        `${remaining} row(s) still not on the current key — re-run stage 2 before finalizing.`
      );
    }
    for (const service of BYOK_SERVICES) {
      setServiceVariables(env, service, { [PREVIOUS_VAR]: '' });
    }
    await markSecretRotated({ env, name: 'byok-encryption-key' });
    console.log(chalk.green('\nStage 3 complete — rotation window closed, ledger stamped.'));
    return;
  }

  throw new Error(`Unknown stage "${stage}" — use 1|stage, 2|reencrypt, or 3|finalize.`);
}
