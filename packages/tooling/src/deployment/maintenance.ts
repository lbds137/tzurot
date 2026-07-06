/**
 * Maintenance-mode toggle (`pnpm ops maintenance <on|off|status> --env <env>`).
 *
 * Sets/clears the shared Redis flag that bot-client and api-gateway check at
 * their front doors (see `common-types/MaintenanceFlag`) AND pauses ai-worker's
 * BullMQ queues. The destructive-migration sequence is:
 *
 *   pnpm ops maintenance on --env prod        # friendly rejections + queues pause + drain
 *   pnpm ops release:premigrate --allow-destructive
 *   <merge the release PR — Railway auto-deploys into the ready schema>
 *   pnpm ops maintenance off --env prod       # queues resume, flag clears
 *
 * PAUSE is the load-bearing primitive, covering what the flag alone cannot:
 * - `ai-requests`: waiting/delayed jobs (incl. failed-and-backing-off retries)
 *   PARK in the paused queue instead of being processed mid-migration, and
 *   resume afterward — no job loss, no schema exposure.
 * - `scheduled-jobs`: ai-worker's repeatable cron jobs (pending-memory
 *   processing every 10min, hourly cleanups) hit Prisma on a fixed schedule
 *   with no flag check; pausing the queue stops their ticks from being
 *   processed during the window.
 *
 * After pausing, `on` waits only for ACTIVE jobs (already being processed) to
 * finish. `--skip-drain` skips that wait; a drain timeout WARNs rather than
 * fails, since a stuck job is the operator's call to override.
 */

import type { Redis } from 'ioredis';
import type { Queue } from 'bullmq';
import { SCHEDULED_QUEUE_NAME } from '@tzurot/common-types/constants/queue';
import { MaintenanceFlag } from '@tzurot/common-types/services/MaintenanceFlag';
import chalk from 'chalk';

import {
  getRailwayRedisUrl,
  createInspectorQueue,
  createInspectorRedis,
  DEFAULT_QUEUE_NAME,
} from '../inspect/bullmqConnection.js';
import type { Environment } from '../utils/env-runner.js';

export type MaintenanceAction = 'on' | 'off' | 'status';

export interface MaintenanceOptions {
  env: Environment;
  /** Skip the active-drain wait after enabling (accept in-flight job failures). */
  skipDrain?: boolean;
  /** Max seconds to wait for active jobs to finish (default 120). */
  drainTimeoutSec?: number;
}

/** Injectable seams so tests mock the network without child-process gymnastics. */
export interface MaintenanceDeps {
  getRedisUrl: (env: Environment) => Promise<string | null>;
  createRedis: (redisUrl: string) => Redis;
  createQueue: (redisUrl: string, queueName: string) => Queue;
  sleep: (ms: number) => Promise<void>;
}

const DEFAULT_DRAIN_TIMEOUT_SEC = 120;
const DRAIN_POLL_INTERVAL_MS = 2_000;

/**
 * How long other service replicas may keep serving a stale "inactive" flag
 * after `enable()` (their MaintenanceFlag read-cache TTL). The queue pause +
 * drain must not START until this window closes, so a replica with a stale
 * cache can't slip a new job past an already-completed drain reading. Mirrors
 * MaintenanceFlag's DEFAULT_CACHE_TTL_MS.
 */
const FLAG_CONVERGENCE_MS = 5_000;

export const defaultMaintenanceDeps: MaintenanceDeps = {
  getRedisUrl: getRailwayRedisUrl,
  createRedis: createInspectorRedis,
  createQueue: createInspectorQueue,
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
};

interface NamedQueue {
  name: string;
  queue: Queue;
}

/**
 * Wait for ACTIVE jobs across all paused queues to finish. Only active counts
 * gate the drain: with the queues paused, waiting/delayed jobs (including
 * failed-and-backing-off retries and cron ticks that come due) PARK instead of
 * being processed, so they are not schema-exposed — they resume after `off`.
 * Returns true when drained, false on timeout (WARN — the operator decides
 * whether to proceed).
 */
async function waitForActiveDrain(
  queues: NamedQueue[],
  timeoutSec: number,
  sleep: MaintenanceDeps['sleep']
): Promise<boolean> {
  const deadline = timeoutSec * 1_000;
  let waited = 0;
  for (;;) {
    const counts = await Promise.all(queues.map(async q => q.queue.getActiveCount()));
    const total = counts.reduce((sum, n) => sum + n, 0);
    if (total === 0) {
      return true;
    }
    const pending = queues.map((q, i) => `${q.name}: ${counts[i]} active`).join(', ');
    if (waited >= deadline) {
      console.log(
        chalk.yellow(
          `⚠️  Drain timed out after ${timeoutSec}s (${pending}) — ` +
            'those jobs may fail during the migration. Proceed at your own judgment.'
        )
      );
      return false;
    }
    console.log(chalk.dim(`   Waiting for in-flight jobs to finish (${pending})…`));
    await sleep(DRAIN_POLL_INTERVAL_MS);
    waited += DRAIN_POLL_INTERVAL_MS;
  }
}

async function printStatus(flag: MaintenanceFlag, queues: NamedQueue[]): Promise<void> {
  const status = await flag.status();
  if (status.active) {
    console.log(chalk.yellow(`🔧 Maintenance mode: ON (since ${status.since ?? 'unknown'})`));
  } else {
    console.log(chalk.green('✅ Maintenance mode: OFF'));
  }
  for (const { name, queue } of queues) {
    const [active, waiting, delayed, paused] = await Promise.all([
      queue.getActiveCount(),
      queue.getWaitingCount(),
      queue.getDelayedCount(),
      queue.isPaused(),
    ]);
    const pausedLabel = paused ? chalk.yellow('PAUSED') : 'running';
    console.log(
      chalk.dim(
        `   ${name}: ${pausedLabel} — ${active} active, ${waiting} waiting, ${delayed} delayed`
      )
    );
  }
}

/**
 * Run the maintenance command. Returns the process exit code (0 = success)
 * rather than calling process.exit, so tests can assert on it.
 */
export async function runMaintenance(
  action: MaintenanceAction,
  options: MaintenanceOptions,
  deps: MaintenanceDeps = defaultMaintenanceDeps
): Promise<number> {
  const redisUrl = await deps.getRedisUrl(options.env);
  if (redisUrl === null) {
    return 1;
  }

  const redis = deps.createRedis(redisUrl);
  const queues: NamedQueue[] = [
    { name: DEFAULT_QUEUE_NAME, queue: deps.createQueue(redisUrl, DEFAULT_QUEUE_NAME) },
    { name: SCHEDULED_QUEUE_NAME, queue: deps.createQueue(redisUrl, SCHEDULED_QUEUE_NAME) },
  ];
  const flag = new MaintenanceFlag(redis);

  try {
    return await runAction(action, options, flag, queues, deps);
  } catch (error) {
    // Redis unreachable, auth failure, etc. — friendly message + exit 1
    // instead of an unhandled rejection's raw stack trace.
    console.error(
      chalk.red(
        `❌ Maintenance ${action} failed: ${error instanceof Error ? error.message : String(error)}`
      )
    );
    return 1;
  } finally {
    // All handles hold sockets open; without closing, the CLI process hangs.
    await Promise.all(queues.map(async q => q.queue.close().catch(() => undefined)));
    redis.disconnect();
  }
}

async function runAction(
  action: MaintenanceAction,
  options: MaintenanceOptions,
  flag: MaintenanceFlag,
  queues: NamedQueue[],
  deps: MaintenanceDeps
): Promise<number> {
  switch (action) {
    case 'on': {
      await flag.enable();
      console.log(
        chalk.yellow(`🔧 Maintenance mode ENABLED on ${options.env}`) +
          chalk.dim(' — services converge within their 5s flag-cache window.')
      );
      // Let every replica's flag cache expire BEFORE pausing + draining, so a
      // stale-cached replica can't enqueue past a completed drain reading.
      console.log(
        chalk.dim(`   Waiting ${FLAG_CONVERGENCE_MS / 1_000}s for services to observe the flag…`)
      );
      await deps.sleep(FLAG_CONVERGENCE_MS);
      await Promise.all(queues.map(async q => q.queue.pause()));
      console.log(
        chalk.dim(
          `   Queues paused (${queues.map(q => q.name).join(', ')}) — ` +
            'waiting/delayed jobs and cron ticks park until "off".'
        )
      );
      if (options.skipDrain === true) {
        console.log(chalk.dim('   Active-drain wait skipped (--skip-drain).'));
      } else {
        const drained = await waitForActiveDrain(
          queues,
          options.drainTimeoutSec ?? DEFAULT_DRAIN_TIMEOUT_SEC,
          deps.sleep
        );
        if (drained) {
          console.log(chalk.green('✅ Quiesced — safe to run the destructive migration.'));
        }
      }
      return 0;
    }
    case 'off': {
      await Promise.all(queues.map(async q => q.queue.resume()));
      await flag.disable();
      console.log(
        chalk.green(`✅ Maintenance mode DISABLED on ${options.env}`) +
          chalk.dim(' — queues resumed; traffic returns within the 5s flag-cache window.')
      );
      return 0;
    }
    case 'status': {
      await printStatus(flag, queues);
      return 0;
    }
  }
}
