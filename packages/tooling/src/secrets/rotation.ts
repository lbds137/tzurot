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
 *   stage 1 (stage):     stage a decrypt-only NEXT key on both services, redeploy
 *                        each and wait for its superseded deployment to be
 *                        removed, then swap through the Railway API
 *                        (skipDeploys): PREVIOUS=old on both, CURRENT=NEXT on
 *                        both, delete NEXT; then redeploy both reusing their
 *                        running image (byok-prepare-stage.ts; stage 2 does not
 *                        depend on that last redeploy having happened).
 *   stage 2 (reencrypt): redeploy api-gateway then ai-worker and wait for each
 *                        new deployment to reach SUCCESS, then re-encrypt every
 *                        user_api_keys/user_credentials row still on the
 *                        previous key; verify sweep (byok-reencrypt-stage.ts).
 *   stage 3 (finalize):  refuse with no open window or PREVIOUS equal to CURRENT
 *                        (`--resume` finishes an interrupted stage 3), verify
 *                        again, delete PREVIOUS (and a leftover NEXT equal to
 *                        CURRENT) on both services through the Railway API,
 *                        redeploy them reusing their running image,
 *                        and stamp the ledger only when both redeploys were
 *                        accepted.
 *
 * Secret VALUES never reach stdout; only names, counts, and hashes-free
 * confirmations are printed.
 */

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
import {
  assertRailwayServiceDeploymentReady,
  deleteRailwayVariable,
  redeployRailwayServiceReusingImage,
  redeployRailwayServiceReusingImageWithSource,
  requireRailwayApiToken,
  upsertRailwayVariable,
} from '../deployment/railway-api.js';
import { getRailwayDatabaseUrl, getRailwayEnvName } from '../utils/env-runner.js';
import { assertByokServicesConsistent, assertNoPendingNext } from './byok-consistency.js';
import {
  assertFinalizeWindowState,
  classifyFinalizeWindow,
  deleteByokVariable,
  resolveServiceIds,
} from './byok-finalize-helpers.js';
import { stageByokWindow } from './byok-prepare-stage.js';
import { reencryptByokRows } from './byok-reencrypt-stage.js';
import {
  assertByokServicesDeploymentReady,
  BYOK_SERVICES,
  CURRENT_VAR,
  GATEWAY_SERVICE,
  finalizeRedeployFailureMessage,
  NEXT_VAR,
  PREVIOUS_VAR,
  type ByokServiceIds,
} from './byok-stage-helpers.js';
import { listRailwayLiveDeploymentIds } from '../deployment/railway-deployment-status.js';
import { checkDeployedCodeDecryptsWithNext } from './deployed-code-gate.js';
import { waitForDeploymentRemoved } from './deployment-removal-wait.js';
import type { RedeployFailure } from './redeploy-repair-text.js';
import { redeployAndWaitForService } from './service-redeploy-wait.js';

/** Default rotation intervals (owner decision: 180d BYOK, 365d the rest). */
export const DEFAULT_INTERVALS: Record<string, number> = {
  'byok-encryption-key': 180,
};
export const DEFAULT_INTERVAL_DAYS = 365;

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
    orderBy: { id: 'asc' };
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
 * an absent variable and an empty one both mean unset at runtime. PREVIOUS
 * reads must use this: before the first rotation ever (or after stage 3
 * deletes it), the variable does not exist.
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
  /** The read hit ROW_CAP — tallies describe an incomplete view. */
  capped: boolean;
}

/** Re-encrypt one table's rows from previous → current key. */
async function reencryptTable(
  prisma: Awaited<ReturnType<typeof createPrismaClient>>['prisma'],
  table: 'userApiKey' | 'userCredential',
  currentKey: Buffer,
  previousKey: Buffer
): Promise<ReencryptTally> {
  const delegate = delegateFor(prisma, table);
  // orderBy: deterministic sweep order so a (hypothetical) capped run makes
  // forward progress across re-runs instead of re-reading an arbitrary page.
  const rows = await delegate.findMany({
    select: { id: true, iv: true, content: true, tag: true },
    orderBy: { id: 'asc' },
    take: ROW_CAP,
  });
  const capped = warnIfCapped(rows.length, `reencrypt ${table}`);

  const tally: ReencryptTally = {
    alreadyCurrent: 0,
    reencrypted: 0,
    unreadable: 0,
    changedConcurrently: 0,
    capped,
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
      orderBy: { id: 'asc' },
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

/** Stage 2's row work: re-encrypt both tables, print the tallies, then verify. */
async function reencryptAndVerifyRows(
  prisma: Awaited<ReturnType<typeof createPrismaClient>>['prisma'],
  currentKey: Buffer,
  previousKey: Buffer
): Promise<void> {
  for (const table of ['userApiKey', 'userCredential'] as const) {
    const tally = await reencryptTable(prisma, table, currentKey, previousKey);
    console.log(
      `  ${table}: ${tally.reencrypted} re-encrypted, ${tally.alreadyCurrent} already current, ${tally.changedConcurrently} changed concurrently (skipped), ${tally.unreadable} unreadable${tally.capped ? ' [READ CAPPED — incomplete]' : ''}`
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
}

function resolveByokIds(env: SecretsEnv): ByokServiceIds {
  return Object.fromEntries(
    BYOK_SERVICES.map(svc => [svc, resolveServiceIds(env, svc)])
  ) as ByokServiceIds;
}

async function redeployByokServices(
  env: SecretsEnv,
  ids: ByokServiceIds,
  buildFailureMessage: (failures: RedeployFailure[]) => string
): Promise<void> {
  const failures: RedeployFailure[] = [];
  for (const svc of BYOK_SERVICES) {
    try {
      await redeployRailwayServiceReusingImage({ ...ids[svc], serviceName: svc, env });
      console.log(chalk.green(`  redeployed ${svc} (${env})`));
    } catch (error) {
      failures.push({ name: svc, error });
    }
  }
  if (failures.length === 0) {
    return;
  }
  for (const failure of failures) {
    const detail = failure.error instanceof Error ? failure.error.message : 'unknown error';
    console.log(chalk.red(`  failed to redeploy ${failure.name} (${env}): ${detail}`));
  }
  const message = buildFailureMessage(failures);
  console.log(chalk.red(`\n${message}`));
  throw new Error(message);
}

async function finalizeByokWindow(env: SecretsEnv, resume: boolean): Promise<void> {
  requireRailwayApiToken(env);

  const currentRaw = getServiceVariable(env, GATEWAY_SERVICE, CURRENT_VAR);
  const currentKey = parseEncryptionKeyMaterial(currentRaw, CURRENT_VAR);
  const previousByService = BYOK_SERVICES.map(svc => readServiceVariable(env, svc, PREVIOUS_VAR));
  assertFinalizeWindowState({ env, resume, current: currentRaw, previousByService });
  // A NEXT that differs from CURRENT refuses here, before any row check or delete:
  // with PREVIOUS gone (`--resume`) it can only be an unfinished stage 1.
  assertNoPendingNext({
    env,
    read: getServiceVariableOrEmpty,
    current: currentRaw,
    windowOpen: classifyFinalizeWindow({ current: currentRaw, previousByService }) === 'open',
  });
  const remaining = await withEnvPrisma(env, prisma => countNonCurrentRows(prisma, currentKey));
  if (remaining > 0) {
    throw new Error(
      `${remaining} row(s) still not on the current key — re-run stage 2 before finalizing.`
    );
  }

  const ids = resolveByokIds(env);
  await assertByokServicesDeploymentReady(env, ids, assertRailwayServiceDeploymentReady);

  // Deleted through the API because the CLI rejects an empty value, and the delete
  // does not redeploy by itself, so the explicit redeploy below is what closes the
  // window in the running services. Both are observed Railway behaviour, not pinned
  // by a test.
  const deleteArgs = {
    env,
    ids,
    readRaw: readServiceVariable,
    deleteVariable: deleteRailwayVariable,
  };
  await deleteByokVariable({ ...deleteArgs, varName: PREVIOUS_VAR, previousAlreadyDeleted: false });
  // Only a NEXT equal to CURRENT reaches here (a leftover of an interrupted swap).
  await deleteByokVariable({ ...deleteArgs, varName: NEXT_VAR, previousAlreadyDeleted: true });

  await redeployByokServices(env, ids, failures =>
    finalizeRedeployFailureMessage({ env, failures })
  );

  await markSecretRotated({ env, name: 'byok-encryption-key' });
  console.log(
    chalk.green(
      '\nStage 3 complete — PREVIOUS (and any leftover NEXT) deleted, redeploys requested, ledger stamped. The window is closed in the running services once both new deployments are live.'
    )
  );
}

/** Staged BYOK key rotation. See module doc for the three stages. */
export async function rotateByokKey(options: {
  env: SecretsEnv;
  stage: string;
  resume?: boolean;
}): Promise<void> {
  const { env, stage, resume = false } = options;

  // Cheap argument validation first…
  const KNOWN_STAGES = new Set(['1', 'stage', '2', 'reencrypt', '3', 'finalize']);
  if (!KNOWN_STAGES.has(stage)) {
    throw new Error(`Unknown stage "${stage}" — use 1|stage, 2|reencrypt, or 3|finalize.`);
  }
  const isFinalizeStage = stage === '3' || stage === 'finalize';
  if (resume && !isFinalizeStage) {
    throw new Error(`--resume is only valid for stage 3 (finalize), got stage "${stage}".`);
  }
  // …then the IO-touching guard: every stage refuses to run on a split-brain
  // variable state — reads below use api-gateway's copy, which is only
  // trustworthy when both services agree.
  const isStage1 = stage === '1' || stage === 'stage';
  // Stage 1 repairs a NEXT mismatch by regenerating it, so only stages 2 and 3 compare NEXT.
  assertByokServicesConsistent(env, getServiceVariableOrEmpty, { compareNext: !isStage1 });

  if (isStage1) {
    await stageByokWindow({
      env,
      getServiceVariable,
      getServiceVariableOrEmpty,
      resolveByokIds,
      assertServiceDeploymentReady: assertRailwayServiceDeploymentReady,
      upsertVariable: upsertRailwayVariable,
      deleteVariable: deleteRailwayVariable,
      redeployAndWait: redeployAndWaitForService,
      redeployWithSource: redeployRailwayServiceReusingImageWithSource,
      waitForDeploymentRemoved,
      listLiveDeploymentIds: listRailwayLiveDeploymentIds,
      checkDeployedCode: checkDeployedCodeDecryptsWithNext,
      redeployServices: redeployByokServices,
    });
    return;
  }

  if (stage === '2' || stage === 'reencrypt') {
    await reencryptByokRows({
      env,
      getServiceVariable,
      getServiceVariableOrEmpty,
      resolveByokIds,
      assertServiceDeploymentReady: assertRailwayServiceDeploymentReady,
      redeployAndWait: redeployAndWaitForService,
      assertServicesConsistent: e =>
        assertByokServicesConsistent(e, getServiceVariableOrEmpty, { compareNext: true }),
      reencryptAndVerify: (currentKey, previousKey) =>
        withEnvPrisma(env, prisma => reencryptAndVerifyRows(prisma, currentKey, previousKey)),
    });
    return;
  }

  if (isFinalizeStage) {
    await finalizeByokWindow(env, resume);
    return;
  }

  // Unreachable: KNOWN_STAGES gates every path above.
  throw new Error(`Unhandled stage "${stage}"`);
}
