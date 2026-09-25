import { GhApiError, ghCall } from './ghCall.js';
import { REPO } from './github-api.js';

export const REVIEW_COUNT_TIMEOUT_MS = 15_000;

/** The workflow whose runs ARE the review cycles — one run per reviewed push. */
export const REVIEW_WORKFLOW_FILE = 'claude-code-review.yml';

/**
 * Thresholds for the review-round advisories `reportReviewRounds` prints.
 * Module-local: nothing outside this file reads them.
 */
const REVIEW_ROUND_DEFAULTS = {
  /**
   * claude-review cycles on one PR at which the gate prints the hand-off
   * warning. Mirrors the ~6-round hard cap in /tzurot-review-response § 5a —
   * measured marathons (13, 10 and 8 rounds in one mined window) were
   * self-fed, with later rounds fixing earlier rounds' fixes, and nothing
   * mechanical surfaced the cap while it was being crossed. Firing AT 6 —
   * one cycle before the skill's "past ~6" hand-off point — is deliberate:
   * the warning must land while the decision is still ahead, so do not
   * "correct" this to > 6.
   */
  REVIEW_ROUND_WARN_THRESHOLD: 6,
  /**
   * Review-cycle count at and above which the dispatch-posture reminder
   * prints. One completed cycle is already a round of findings to apply, and
   * `/tzurot-review-response` § 3a routes review-round fixes through a worker
   * dispatch regardless of driver — so the reminder fires on the first cycle
   * rather than waiting for the round-cap threshold above.
   */
  REVIEW_ROUND_DISPATCH_REMINDER_THRESHOLD: 1,
} as const;

/**
 * Count claude-review cycles on the PR by counting the review WORKFLOW's runs
 * for the PR's head branch — not `claude[bot]` issue comments, which the
 * `@claude` mention workflow also posts from the same login, so a chatty
 * review thread would inflate a comment-based count past the cap. A rerun
 * bumps a run's attempt counter rather than creating a run, so reruns don't
 * inflate this either. The runs query is scoped by BRANCH NAME, not PR, so it
 * is ALSO floored at the PR's creation time: without that floor a reused
 * branch name carries every prior same-name PR's runs into the count. That is
 * not the rare case it reads as — a release PR's head ref is `develop`, which
 * every release reuses by design, so an unfloored count returns the repo's
 * entire release-review history (hundreds of cycles against a real count of
 * one) and trips the cap warning on every release. Accepted gap that remains,
 * the more common one on an actively-steered PR: the count
 * cannot see OWNER INTERVENTIONS, which reset the skill's own round cap —
 * six pushes with the owner actively directing throughout still counts as
 * six. The warning text says "counts reviewed pushes" for exactly that
 * reason; the §5a judgment stays with the reader. The 1:1 push-to-run
 * assumption also rests on claude-code-review.yml triggering ONLY on
 * pull_request [opened, synchronize] — another trigger (dispatch, schedule)
 * would silently inflate this count. Throws on
 * any gh/parse failure; the caller decides how loud an unavailable count
 * should be.
 */
export function countReviewCycles(prNumber: number): number {
  const [headRef = '', createdAt = ''] = ghCall(
    [
      'pr',
      'view',
      String(prNumber),
      '--json',
      'headRefName,createdAt',
      '--jq',
      '[.headRefName, .createdAt] | @tsv',
    ],
    REVIEW_COUNT_TIMEOUT_MS
  )
    .trim()
    .split('\t');
  if (headRef === '') {
    throw new GhApiError(`PR #${prNumber} has no head branch name`);
  }
  // Shape-checked rather than merely non-empty because it is interpolated raw
  // below: `encodeURIComponent` would percent-encode the colons, and only the
  // unencoded form was probed against the live API. The absence of fractional
  // seconds is an EXTERNAL-FORMAT assumption about `gh pr view --json
  // createdAt` — probed against live PRs, not read off a doc — so a GitHub
  // change here would start failing this check. That degrades safely: the
  // throw reaches reportReviewRounds, which fails open to its "unavailable"
  // line rather than silently reinstating an unfloored count.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(createdAt)) {
    throw new GhApiError(`PR #${prNumber} has no usable creation timestamp: '${createdAt}'`);
  }
  const raw = ghCall(
    [
      'api',
      // `.total_count` is the API's own full count, so pagination cannot
      // silently truncate it the way an array-length count would past page 1.
      // `%3E%3D` is `>=`, the API's own range-filter syntax.
      `repos/${REPO}/actions/workflows/${REVIEW_WORKFLOW_FILE}/runs` +
        `?branch=${encodeURIComponent(headRef)}&created=%3E%3D${createdAt}&per_page=1`,
      '--jq',
      '.total_count',
    ],
    REVIEW_COUNT_TIMEOUT_MS
  );
  // Number('') is 0, not NaN — an empty stdout would read as "checked, zero
  // rounds", the silent-skip shape this whole path exists to avoid.
  const trimmed = raw.trim();
  const total = trimmed === '' ? Number.NaN : Number(trimmed);
  if (Number.isNaN(total)) {
    throw new GhApiError(`unparseable review-cycle count: ${trimmed.slice(0, 120)}`);
  }
  return total;
}

/**
 * Print the § 5a hand-off warning when the PR's review-cycle count has
 * reached the cap, and — at any successfully-read count of at least one
 * cycle — the dispatch-posture reminder ahead of it. Both are advisory and
 * fail-open BY DESIGN: the gate's job is CI state, and a count hiccup must
 * not turn a green gate red — but the unavailability is still printed on its
 * own line, because a silent skip would read as "under the cap" (the same
 * silence-looks-like-success shape the sentinels exist to remove). Nothing
 * beyond that unavailability line prints when the count could not be read:
 * there is no count to compare against either threshold.
 */
export function reportReviewRounds(
  prNumber: number,
  log: (message: string) => void,
  count: (pr: number) => number = countReviewCycles
): void {
  let cycles: number;
  try {
    cycles = count(prNumber);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    log(`⚠️  review-cycle count unavailable (${detail}) — the round-cap check did not run.`);
    return;
  }
  if (cycles >= REVIEW_ROUND_DEFAULTS.REVIEW_ROUND_DISPATCH_REMINDER_THRESHOLD) {
    log(
      "📋 REVIEW ROUNDS ARE DISPATCH WORK: batch this round's findings into ONE " +
        'worker dispatch (/tzurot-review-response § 3a); inline application is the ' +
        'exception, not the default.'
    );
  }
  if (cycles >= REVIEW_ROUND_DEFAULTS.REVIEW_ROUND_WARN_THRESHOLD) {
    log(
      `⚠️  REVIEW_ROUND_CAP: ${cycles} claude-review cycles on PR #${prNumber} — ` +
        'at the ~6-round cap. This counts reviewed pushes and cannot see owner ' +
        'interventions (which reset the cap), so judge before acting: if the rounds ' +
        'were self-fed, hand the open findings to a fresh-context implementer or the ' +
        'owner (/tzurot-review-response § 5a).'
    );
  }
}
