/**
 * Dead Letter Queue Inspection
 *
 * View and manage failed BullMQ jobs.
 * Failed jobs are jobs that have exceeded their retry attempts.
 */

import { Queue } from 'bullmq';
import { parseRedisUrl, createBullMQRedisConfig } from '@tzurot/common-types';
import chalk from 'chalk';

import type { Environment } from '../utils/env-runner.js';

/** Default queue name used by Tzurot */
const DEFAULT_QUEUE_NAME = 'ai-requests';

interface DlqViewOptions {
  env?: Environment;
  queue?: string;
  limit?: number;
  json?: boolean;
}

interface FailedJobDetails {
  id: string | undefined;
  name: string;
  finishedOn: string | null;
  attemptsMade: number;
  failedReason: string | undefined;
  stacktrace: string[] | undefined;
  data: unknown;
  timestamp: string | null;
}

/**
 * Get Redis URL for environment
 */
async function getRedisUrl(env: Environment): Promise<string | null> {
  if (env === 'local') {
    return process.env.REDIS_URL ?? 'redis://localhost:6379';
  }

  const { execFileSync } = await import('node:child_process');
  const railwayEnv = env === 'prod' ? 'production' : 'development';

  try {
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
 * Format timestamp to ISO string
 */
function formatTimestamp(ts: number | undefined): string | null {
  if (!ts) {
    return null;
  }
  return new Date(ts).toISOString();
}

/**
 * Display failed jobs in human-readable format
 */
function displayFailedJobs(jobs: FailedJobDetails[]): void {
  if (jobs.length === 0) {
    console.log(chalk.green('✅ No failed jobs in queue'));
    return;
  }

  console.log(chalk.red(`\n❌ ${jobs.length} Failed Job(s)`));
  console.log(chalk.dim('─'.repeat(60)));

  for (const job of jobs) {
    console.log(`\n${chalk.red('Job ID:')} ${job.id ?? 'unknown'}`);
    console.log(`${chalk.dim('Name:')} ${job.name}`);
    console.log(`${chalk.dim('Failed at:')} ${job.finishedOn ?? 'unknown'}`);
    console.log(`${chalk.dim('Created:')} ${job.timestamp ?? 'unknown'}`);
    console.log(`${chalk.dim('Attempts:')} ${job.attemptsMade}`);

    if (job.failedReason) {
      console.log(`${chalk.red('Error:')} ${job.failedReason}`);
    }

    if (job.stacktrace && job.stacktrace.length > 0) {
      console.log(chalk.dim('Stacktrace (first 5 lines):'));
      const lines = job.stacktrace[0]?.split('\n').slice(0, 5) ?? [];
      for (const line of lines) {
        console.log(chalk.dim(`  ${line}`));
      }
    }

    // Show job data summary
    if (job.data) {
      const dataStr = JSON.stringify(job.data);
      const preview = dataStr.length > 200 ? dataStr.substring(0, 200) + '...' : dataStr;
      console.log(`${chalk.dim('Data:')} ${chalk.dim(preview)}`);
    }
  }

  console.log(chalk.dim('\n─'.repeat(60)));
  console.log(chalk.dim('Use --json for full job details'));
}

/**
 * View failed jobs in the dead letter queue
 */
export async function viewDlq(options: DlqViewOptions = {}): Promise<void> {
  const { env = 'dev', queue: queueName = DEFAULT_QUEUE_NAME, limit = 10, json = false } = options;

  if (!json) {
    console.log(chalk.cyan(`Viewing failed jobs in "${queueName}" on ${env}...`));
  }

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

    const failedJobs = await queue.getFailed(0, limit - 1);

    const jobDetails: FailedJobDetails[] = failedJobs.map(job => ({
      id: job.id,
      name: job.name,
      finishedOn: formatTimestamp(job.finishedOn),
      attemptsMade: job.attemptsMade,
      failedReason: job.failedReason,
      stacktrace: job.stacktrace,
      data: job.data as unknown,
      timestamp: formatTimestamp(job.timestamp),
    }));

    if (json) {
      console.log(JSON.stringify({ count: jobDetails.length, jobs: jobDetails }, null, 2));
    } else {
      displayFailedJobs(jobDetails);
    }
  } catch (error) {
    console.error(chalk.red('Failed to view failed jobs'));
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
