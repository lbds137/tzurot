/**
 * `pnpm ops health:post-webhook` — chunks the weekly `pnpm ops health` report
 * and posts it to the audit-health Discord webhook as N sequential messages,
 * replacing the shell truncation in `.github/workflows/weekly-audit.yml`
 * (which sliced the report to a fixed byte count and silently dropped the
 * tail — including warnings — once the report grew past Discord's cap).
 *
 * Kept as a real ops command rather than workflow shell per the "no
 * standalone scripts" rule: chunking needs unit-testable string handling
 * (`splitMessage`), not a bash one-liner.
 */

import { readFileSync } from 'node:fs';
import chalk from 'chalk';
import { splitMessage } from '@tzurot/common-types/utils/discord';

const AUDIT_HEALTH_HEADER = '## Audit health';
const DEFAULT_REPORT_FILE = 'health-report.txt';

interface PostWebhookOptions {
  /** Report file to read. Defaults to `health-report.txt` (the aggregator's output). */
  file?: string;
}

/**
 * Slices the report from the `## Audit health` header onward, dropping the
 * aggregator's progress preamble. Fails open toward more information: if the
 * header is not found, the whole file is returned rather than posting
 * nothing.
 */
function sliceFromHealthHeader(report: string): string {
  const headerIndex = report.indexOf(AUDIT_HEALTH_HEADER);
  if (headerIndex === -1) {
    return report;
  }
  return report.slice(headerIndex);
}

async function postChunk(webhookUrl: string, chunk: string): Promise<void> {
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: chunk }),
  });
  if (!response.ok) {
    throw new Error(`Discord webhook responded ${response.status} ${response.statusText}`);
  }
}

/**
 * Reads the report, chunks it under Discord's message cap, and posts each
 * chunk sequentially. A MISSING file (ENOENT) / unset webhook URL / empty
 * report are documented degrades (exit 0, matching the shell guard this
 * replaces) — any other read error and any delivery failure exit nonzero,
 * left to the workflow step's `continue-on-error: true` to isolate from the
 * aggregator's own audit verdict.
 */
export async function runHealthWebhookPost(options: PostWebhookOptions = {}): Promise<void> {
  const filePath = options.file ?? DEFAULT_REPORT_FILE;
  const webhookUrl = process.env.DISCORD_AUDIT_WEBHOOK_URL;

  if (webhookUrl === undefined || webhookUrl === '') {
    console.log('DISCORD_AUDIT_WEBHOOK_URL not configured — report is in the step log only.');
    return;
  }

  let report: string;
  try {
    report = readFileSync(filePath, 'utf-8');
  } catch (error) {
    // Only a MISSING file is the intentional no-op (an earlier step failed
    // before the audit ran). Any other read error is a real failure —
    // mislabeling it "nothing to post" would swallow it behind exit 0.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      console.log(
        `No ${filePath} (an earlier step failed before the audit ran) — nothing to post.`
      );
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`Failed to read ${filePath}: ${message}`));
    process.exitCode = 1;
    return;
  }

  const sliced = sliceFromHealthHeader(report);
  const chunks = splitMessage(sliced);

  if (chunks.length === 0) {
    // splitMessage returns [] for empty content — an empty-but-present report
    // gets the same degrade messaging as a missing one, not "Posted 0 chunks".
    console.log(`Empty report in ${filePath} — nothing to post.`);
    return;
  }

  const deliveredAll = await postAllChunks(webhookUrl, chunks);
  if (!deliveredAll) {
    process.exitCode = 1;
    return;
  }

  console.log(
    chalk.green(`Posted ${chunks.length} chunk(s) to Discord (${sliced.length} chars total).`)
  );
}

/**
 * Posts chunks in order; on the first failure, posts a best-effort INCOMPLETE
 * trailer so the partial report in the channel does not read as complete —
 * the exact symptom this command exists to prevent. Returns whether every
 * content chunk was delivered.
 */
async function postAllChunks(webhookUrl: string, chunks: string[]): Promise<boolean> {
  for (const [index, chunk] of chunks.entries()) {
    try {
      // Sequential by design: chunks must post in order, not race.
      await postChunk(webhookUrl, chunk);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        chalk.red(
          `Failed to post health report to Discord at chunk ${index + 1}/${chunks.length}: ${message}`
        )
      );
      // "The report above" only exists when at least one chunk landed — a
      // first-chunk failure needs different wording or the trailer describes
      // a report that is not there.
      const situation =
        index === 0
          ? 'NO report chunks were delivered'
          : `the report above is INCOMPLETE (failed at chunk ${index + 1} of ${chunks.length})`;
      try {
        await postChunk(
          webhookUrl,
          `⚠️ Health report delivery failed — ${situation}. See the weekly-audit workflow log for the full report.`
        );
      } catch {
        // The trailer is best-effort by definition; the caller's nonzero exit
        // is the durable failure signal either way.
      }
      return false;
    }
  }
  return true;
}
