/**
 * `pnpm ops health:post-webhook` — chunks the weekly `pnpm ops health` report
 * and posts it to the audit-health Discord webhook as N sequential messages,
 * replacing the shell truncation in `.github/workflows/weekly-audit.yml`
 * (which sliced the report to a fixed byte count and silently dropped the
 * tail — including warnings — once the report grew past Discord's cap).
 *
 * Kept as a real ops command rather than workflow shell per the "no
 * standalone scripts" rule: chunking needs unit-testable string handling
 * (`splitMessageByLines`), not a bash one-liner.
 */

import { readFileSync } from 'node:fs';
import chalk from 'chalk';
import { splitMessageByLines } from '@tzurot/common-types/utils/discord';

const AUDIT_HEALTH_HEADER = '## Audit health';
const DEFAULT_REPORT_FILE = 'health-report.txt';

/** Retry budget for a 429'd chunk: the first attempt plus this many retries. */
const MAX_RETRIES = 2;
/** Wait applied when Discord sends no usable `Retry-After` header. */
const DEFAULT_RETRY_DELAY_MS = 1_000;
/** Ceiling on any honored `Retry-After`, so a garbled header cannot hang the workflow. */
const MAX_RETRY_DELAY_MS = 60_000;

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

/**
 * Resolves the POST target: the configured webhook plus `?wait=true`. Per
 * Discord's webhook-execute documentation the flag makes the response wait on
 * server-side confirmation of the send rather than returning 204 immediately,
 * which is what gives the sequential loop below its ordering guarantee — not
 * probed against the live API here, so treat the ordering claim as documented
 * rather than verified. Built through `URL` rather than string concatenation
 * because the configured webhook may already carry a query string. Returns
 * null when the configured value is not a parseable absolute URL.
 */
function resolveWebhookTarget(webhookUrl: string): string | null {
  try {
    const url = new URL(webhookUrl);
    url.searchParams.set('wait', 'true');
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Reads Discord's `Retry-After` (seconds, possibly fractional) into a bounded
 * millisecond wait. An absent, non-numeric, or negative header falls back to
 * `DEFAULT_RETRY_DELAY_MS`; anything larger than `MAX_RETRY_DELAY_MS` is
 * clamped down to it.
 */
function retryDelayMs(response: Response): number {
  const header = response.headers.get('Retry-After');
  const seconds = header === null ? Number.NaN : Number.parseFloat(header);
  if (!Number.isFinite(seconds) || seconds < 0) {
    return DEFAULT_RETRY_DELAY_MS;
  }
  return Math.min(seconds * 1000, MAX_RETRY_DELAY_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * POSTs one chunk. A 429 is retried up to `MAX_RETRIES` times after the
 * header-derived wait; every other non-ok status is terminal on the first
 * response. Exhausting the retries throws the same error shape as any other
 * failure, so the caller's INCOMPLETE-trailer path is unchanged.
 */
async function postChunk(postUrl: string, chunk: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(postUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // The bot's own Discord client sets `allowedMentions` globally; this raw
      // fetch inherits nothing, so a report body containing @everyone or a role
      // mention would ping the channel without this.
      body: JSON.stringify({ content: chunk, allowed_mentions: { parse: [] } }),
    });
    if (response.ok) {
      return;
    }
    if (response.status === 429 && attempt < MAX_RETRIES) {
      await sleep(retryDelayMs(response));
      continue;
    }
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

  // Resolved once, before any POST: a malformed webhook URL is a config
  // failure, not a degrade — posting nothing while exiting 0 would hide it.
  const postUrl = resolveWebhookTarget(webhookUrl);
  if (postUrl === null) {
    console.error(chalk.red('DISCORD_AUDIT_WEBHOOK_URL is not a valid URL — nothing was posted.'));
    process.exitCode = 1;
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
  // Line-aware, not `splitMessage`: the report is blank-line-separated
  // sections whose bodies are unbroken runs of markdown bullets. Any one of
  // those runs over the cap is a single `splitMessage` "paragraph", which it
  // re-joins with spaces at every internal newline. Code-fence preservation
  // is not in play — neither `health.ts` nor `health-extras.ts` emits a ```
  // fence (grepped: zero occurrences in both).
  // Trimmed emptiness, not just zero length. Two shapes reach here with
  // nothing to say: an empty chunk, which splitMessageByLines emits when a
  // blank source line lands alone at a forced boundary (it preserves the line
  // rather than dropping it, and leaves this decision to the caller), and a
  // whitespace-only chunk, where splitMessageByLines and splitMessage
  // deliberately differ — splitMessage returns [] for all-blank input while
  // this one returns the blank lines intact. Neither is transmittable, and a
  // blank line's fidelity does not survive a chat render anyway, so both
  // degrade through the same `chunks.length === 0` gate below rather than
  // POSTing content Discord would reject.
  const chunks = splitMessageByLines(sliced).filter(chunk => chunk.trim().length > 0);

  if (chunks.length === 0) {
    // splitMessageByLines returns [] for empty content — an empty-but-present report
    // gets the same degrade messaging as a missing one, not "Posted 0 chunks".
    console.log(`Empty report in ${filePath} — nothing to post.`);
    return;
  }

  const deliveredAll = await postAllChunks(postUrl, chunks);
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
async function postAllChunks(postUrl: string, chunks: string[]): Promise<boolean> {
  for (const [index, chunk] of chunks.entries()) {
    try {
      // Sequential by design: chunks must post in order, not race.
      await postChunk(postUrl, chunk);
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
          postUrl,
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
