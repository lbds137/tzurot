/**
 * Queue Inspection
 *
 * Inspect BullMQ queue state for debugging async operations.
 */

import { Queue } from 'bullmq';
import { parseRedisUrl, createBullMQRedisConfig } from '@tzurot/common-types';
import chalk from 'chalk';

import type { Environment } from '../utils/env-runner.js';

/** Default queue name used by Tzurot */
const DEFAULT_QUEUE_NAME = 'ai-requests';

interface InspectQueueOptions {
  env?: Environment;
  queue?: string;
  failedLimit?: number;
  verbose?: boolean;
}

interface QueueStats {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
}

/**
 * Get Redis URL for environment
 */
async function getRedisUrl(env: Environment): Promise<string | null> {
  if (env === 'local') {
    // Try local .env
    return process.env.REDIS_URL ?? 'redis://localhost:6379';
  }

  // For dev/prod, use Railway CLI
  const { execFileSync } = await import('node:child_process');

  const railwayEnv = env === 'prod' ? 'production' : 'development';

  try {
    // Get Redis URL from Railway using execFileSync (no shell injection)
    const result = execFileSync(
      'railway',
      ['variables', '--json', '--service', 'redis', '--environment', railwayEnv],
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );

    const vars = JSON.parse(result) as Record<string, string>;
    return vars.REDIS_URL ?? null;
  } catch {
    console.error(chalk.red(`Failed to get Redis URL from Railway (${env})`));
    console.error(chalk.dim('Make sure you are logged in: railway login'));
    return null;
  }
}

/**
 * Format job data for display
 */
function formatJobData(data: unknown, maxLength = 200): string {
  const str = JSON.stringify(data, null, 2);
  if (str.length > maxLength) {
    return str.substring(0, maxLength) + chalk.dim('...');
  }
  return str;
}

/**
 * Display queue stats section
 */
function displayQueueStats(stats: QueueStats): void {
  console.log(chalk.yellow('📊 Queue Stats'));
  console.log(chalk.dim('─'.repeat(50)));
  console.log(
    `   Waiting:   ${stats.waiting > 0 ? chalk.yellow(stats.waiting) : chalk.dim(stats.waiting)}`
  );
  console.log(
    `   Active:    ${stats.active > 0 ? chalk.cyan(stats.active) : chalk.dim(stats.active)}`
  );
  console.log(`   Completed: ${chalk.green(stats.completed)}`);
  console.log(
    `   Failed:    ${stats.failed > 0 ? chalk.red(stats.failed) : chalk.dim(stats.failed)}`
  );
  console.log(
    `   Delayed:   ${stats.delayed > 0 ? chalk.yellow(stats.delayed) : chalk.dim(stats.delayed)}`
  );
  console.log(
    `   Paused:    ${stats.paused > 0 ? chalk.yellow(stats.paused) : chalk.dim(stats.paused)}`
  );
  console.log('');
}

interface FailedJob {
  id?: string;
  name: string;
  finishedOn?: number;
  attemptsMade: number;
  failedReason?: string;
  data: unknown;
}

/**
 * Display failed jobs section
 */
function displayFailedJobs(jobs: FailedJob[], verbose: boolean): void {
  for (const job of jobs) {
    console.log(`   ${chalk.red('Job ID:')} ${job.id}`);
    console.log(`   ${chalk.dim('Name:')} ${job.name}`);
    console.log(
      `   ${chalk.dim('Failed at:')} ${job.finishedOn ? new Date(job.finishedOn).toISOString() : 'unknown'}`
    );
    console.log(`   ${chalk.dim('Attempts:')} ${job.attemptsMade}`);

    if (job.failedReason) {
      console.log(`   ${chalk.red('Error:')} ${job.failedReason}`);
    }

    if (verbose && job.data) {
      console.log(`   ${chalk.dim('Data:')}`);
      const dataStr = formatJobData(job.data);
      for (const line of dataStr.split('\n')) {
        console.log(`     ${chalk.dim(line)}`);
      }
    }

    console.log('');
  }
}

interface ActiveJob {
  id?: string;
  name: string;
  processedOn?: number;
}

/**
 * Display active jobs section
 */
function displayActiveJobs(jobs: ActiveJob[]): void {
  console.log(chalk.yellow('🔄 Active Jobs'));
  console.log(chalk.dim('─'.repeat(50)));

  for (const job of jobs) {
    console.log(`   ${chalk.cyan('Job ID:')} ${job.id}`);
    console.log(`   ${chalk.dim('Name:')} ${job.name}`);
    console.log(
      `   ${chalk.dim('Started:')} ${job.processedOn ? new Date(job.processedOn).toISOString() : 'unknown'}`
    );
    console.log('');
  }
}

/**
 * Display queue summary
 */
function displayQueueSummary(stats: QueueStats): void {
  console.log(chalk.cyan('═'.repeat(50)));

  if (stats.failed > 0) {
    console.log(chalk.yellow(`⚠️  ${stats.failed} failed job(s) in queue`));
  }

  if (stats.active > 0) {
    console.log(chalk.cyan(`🔄 ${stats.active} job(s) currently processing`));
  }

  if (stats.waiting > 0) {
    console.log(chalk.dim(`⏳ ${stats.waiting} job(s) waiting`));
  }

  if (stats.failed === 0 && stats.active === 0 && stats.waiting === 0) {
    console.log(chalk.green('✅ Queue is empty and healthy'));
  }

  console.log(chalk.cyan('═'.repeat(50)));
}

/**
 * Fetch queue stats from BullMQ
 */
async function fetchQueueStats(queue: Queue): Promise<QueueStats> {
  const counts = await queue.getJobCounts();
  return {
    waiting: counts.waiting ?? 0,
    active: counts.active ?? 0,
    completed: counts.completed ?? 0,
    failed: counts.failed ?? 0,
    delayed: counts.delayed ?? 0,
    paused: counts.paused ?? 0,
  };
}

/**
 * Inspect queue state
 */
export async function inspectQueue(options: InspectQueueOptions = {}): Promise<void> {
  const {
    env = 'dev',
    queue: queueName = DEFAULT_QUEUE_NAME,
    failedLimit = 5,
    verbose = false,
  } = options;

  console.log(chalk.cyan(`Inspecting queue "${queueName}" on ${env}...`));
  console.log('');

  const redisUrl = await getRedisUrl(env);
  if (!redisUrl) {
    process.exitCode = 1;
    return;
  }

  let queue: Queue | null = null;

  try {
    const parsedUrl = parseRedisUrl(redisUrl);
    const redisConfig = createBullMQRedisConfig({
      ...parsedUrl,
      family: env === 'local' ? 4 : 6,
    });

    queue = new Queue(queueName, { connection: redisConfig });
    const stats = await fetchQueueStats(queue);

    displayQueueStats(stats);

    if (stats.failed > 0) {
      console.log(chalk.yellow(`❌ Recent Failed Jobs (showing up to ${failedLimit})`));
      console.log(chalk.dim('─'.repeat(50)));
      const failedJobs = await queue.getFailed(0, failedLimit - 1);
      displayFailedJobs(failedJobs, verbose);
    }

    if (stats.active > 0 && verbose) {
      const activeJobs = await queue.getActive(0, 4);
      displayActiveJobs(activeJobs);
    }

    displayQueueSummary(stats);
  } catch (error) {
    console.error(chalk.red('Failed to inspect queue'));
    if (error instanceof Error) {
      console.error(chalk.dim(error.message));
    }
    process.exitCode = 1;
  } finally {
    if (queue) {
      await queue.close();
    }
  }
}
