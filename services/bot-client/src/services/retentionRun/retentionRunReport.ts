/**
 * Owner-channel embeds for the retention job's live-run and rehearsal modes,
 * plus the gates deciding whether each is worth posting at all — a quiet
 * outcome is logged, not posted, so the owner channel doesn't get an hourly
 * "nothing happened" message.
 */

import { EmbedBuilder } from 'discord.js';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import type { RetentionPreviewResponse } from '@tzurot/common-types/schemas/api/internal';
import { clampEmbedText, EMBED_CAPS } from '../../utils/embedLimits.js';
import { formatRetentionUserLines } from './retentionRows.js';
import type { LiveRunOutcome, NotifyStepOutcome, PurgeSkipReason } from './types.js';

/**
 * True when a live run produced anything worth an owner's attention: a
 * purge/notify signal (purged/failed/halted, notify failed/refused/enqueued),
 * an unmet erasure obligation from the reconcile sweep (a failed sweep
 * call, any row still failing its off-DB cleanup, or the iteration cap hit
 * with rows never attempted) — the latter reports every day the row
 * persists, with no extra cooldown of its own — or the preview alone
 * flagging that the cohort exceeds the breaker warning share of the
 * userbase, independent of anything the purge/notify/reconcile steps did.
 */
export function shouldReportLiveRun(outcome: LiveRunOutcome): boolean {
  return (
    outcome.purge.purged.length > 0 ||
    outcome.purge.failed > 0 ||
    outcome.purge.halt !== null ||
    outcome.notify.kind === 'failed' ||
    (outcome.notify.kind === 'ok' && outcome.notify.status === 'refused_breaker') ||
    (outcome.notify.kind === 'ok' && outcome.notify.batchesEnqueued > 0) ||
    outcome.reconcile.kind === 'failed' ||
    outcome.reconcile.stillFailing > 0 ||
    (outcome.reconcile.kind === 'ok' && outcome.reconcile.remaining > 0) ||
    outcome.preview.totals.breakerWarning
  );
}

/** Log-safe fields (ids/counts only) for a quiet run's summary line. */
export function summarizeLiveRun(
  outcome: LiveRunOutcome
): Record<string, number | string | boolean | null> {
  return {
    attempted: outcome.purge.attempted,
    purged: outcome.purge.purged.length,
    charactersDeleted: outcome.purge.charactersDeleted,
    charactersReHomed: outcome.purge.charactersReHomed,
    failed: outcome.purge.failed,
    halt: outcome.purge.halt?.kind ?? null,
    notifyStatus: outcome.notify.kind === 'ok' ? outcome.notify.status : 'failed',
    notifyCohortSize: outcome.notify.kind === 'ok' ? outcome.notify.cohortSize : 0,
    reconcileSettled: outcome.reconcile.settled,
    reconcileStillFailing: outcome.reconcile.stillFailing,
    reconcileRemaining: outcome.reconcile.kind === 'ok' ? outcome.reconcile.remaining : 0,
    reconcileIterations: outcome.reconcile.iterations,
    breakerWarning: outcome.preview.totals.breakerWarning,
    eligibleCount: outcome.preview.totals.eligibleCount,
  };
}

const PURGE_SKIP_LABELS: Record<PurgeSkipReason | 'unspecified', string> = {
  already_gone: 'already gone',
  no_longer_eligible: 'active again',
  outside_allowlist: 'outside the allowlist',
  unscoped_non_production: 'unscoped non-production',
  // Never rendered: a trip becomes a halt, not a skip (retentionLiveRun.test.ts,
  // grep `skippedByReason.breaker_tripped`); kept because the Record is exhaustive.
  breaker_tripped: 'breaker tripped',
  unspecified: 'unspecified',
};

function purgedLine(outcome: LiveRunOutcome): string {
  return (
    `**Purged:** ${String(outcome.purge.purged.length)} of ` +
    `${String(outcome.preview.totals.eligibleCount)} eligible · characters: ` +
    `${String(outcome.purge.charactersDeleted)} deleted, ` +
    `${String(outcome.purge.charactersReHomed)} re-homed to the Orphaned Characters bucket`
  );
}

function skippedLine(outcome: LiveRunOutcome): string | null {
  const entries = Object.entries(outcome.purge.skippedByReason).filter(
    (entry): entry is [PurgeSkipReason | 'unspecified', number] => (entry[1] ?? 0) > 0
  );
  if (entries.length === 0) {
    return null;
  }
  const parts = entries.map(([reason, n]) => `${PURGE_SKIP_LABELS[reason]} ×${String(n)}`);
  return `**Skipped:** ${parts.join(' · ')}`;
}

function failedLine(outcome: LiveRunOutcome): string | null {
  if (outcome.purge.failed === 0) {
    return null;
  }
  const parts = Object.entries(outcome.purge.failureKinds).map(
    ([kind, n]) => `${kind} ×${String(n)}`
  );
  const base = `**Failed:** ${String(outcome.purge.failed)} (${parts.join(', ')})`;
  const timedOut = outcome.purge.failureKinds.timeout ?? 0;
  return timedOut > 0
    ? `${base} — a timed-out purge may still have committed; the next preview is authoritative.`
    : base;
}

function haltLine(outcome: LiveRunOutcome): string | null {
  const { halt } = outcome.purge;
  if (halt === null) {
    return null;
  }
  if (halt.kind === 'breaker_tripped') {
    return (
      `🛑 **Halted — circuit breaker tripped.** ${halt.detail}\n` +
      'The daily job never overrides the breaker: review with ' +
      '`pnpm ops retention:preview --env prod`, then purge by hand with ' +
      '`--breaker-override` if the churn is real.'
    );
  }
  if (halt.kind === 'lease_lost') {
    return (
      '🛑 **Halted — the run lease was lost** (another run took it over); the ' +
      'remaining accounts wait for the next run.'
    );
  }
  return (
    `🛑 **Aborted after ${String(halt.consecutiveFailures)} consecutive failures** — ` +
    'the remaining accounts wait for the next run.'
  );
}

function liveNotifyLine(notify: NotifyStepOutcome): string {
  if (notify.kind === 'failed') {
    return `**Notify failed:** ${notify.error}`;
  }
  if (notify.status === 'refused_breaker') {
    return `**Notify refused by the breaker:** ${notify.breakerDetail ?? ''}`;
  }
  if (notify.status === 'enqueued') {
    const batchWord = notify.batchesEnqueued === 1 ? 'batch' : 'batches';
    return (
      `**Notify:** warning DMs queued for ${String(notify.cohortSize)} users ` +
      `(${String(notify.batchesEnqueued)} ${batchWord})`
    );
  }
  if (notify.status === 'empty') {
    return '**Notify:** nobody is awaiting a warning';
  }
  return `**Notify:** ${notify.status}`;
}

function breakerWarningLine(preview: RetentionPreviewResponse): string | null {
  if (!preview.totals.breakerWarning) {
    return null;
  }
  return (
    '⚠️ The cohort exceeds the breaker warning share of the userbase ' +
    `(${String(preview.totals.percentOfUserbase)}%).`
  );
}

function reconcileLine(outcome: LiveRunOutcome): string {
  const { reconcile } = outcome;
  if (reconcile.kind === 'failed') {
    return (
      `**Off-DB cleanup failed:** ${reconcile.error} ` +
      `(${String(reconcile.settled)} settled before it failed)`
    );
  }
  const remainingSuffix =
    reconcile.remaining > 0 ? `, ${String(reconcile.remaining)} not yet attempted` : '';
  return (
    `**Off-DB cleanup:** ${String(reconcile.settled)} settled, ` +
    `${String(reconcile.stillFailing)} still failing${remainingSuffix}`
  );
}

function scopeLine(preview: RetentionPreviewResponse): string | null {
  const { scope } = preview.totals;
  if (scope.kind === 'unrestricted') {
    return null;
  }
  return (
    `**Scope:** ${scope.kind} — ${String(scope.excludedEligibleCount)} purge-eligible ` +
    'account(s) outside it were not considered.'
  );
}

function liveRunColor(outcome: LiveRunOutcome): number {
  if (outcome.purge.halt !== null || outcome.notify.kind === 'failed') {
    return DISCORD_COLORS.ERROR;
  }
  const notifyRefused = outcome.notify.kind === 'ok' && outcome.notify.status === 'refused_breaker';
  const reconcileUnmet =
    outcome.reconcile.kind === 'failed' ||
    outcome.reconcile.stillFailing > 0 ||
    (outcome.reconcile.kind === 'ok' && outcome.reconcile.remaining > 0);
  if (
    outcome.purge.failed > 0 ||
    notifyRefused ||
    reconcileUnmet ||
    outcome.preview.totals.breakerWarning
  ) {
    return DISCORD_COLORS.WARNING;
  }
  return DISCORD_COLORS.SUCCESS;
}

/** Build the owner-channel embed for a live run worth reporting. */
export function buildLiveRunEmbed(outcome: LiveRunOutcome): EmbedBuilder {
  const lines: string[] = [purgedLine(outcome)];
  const skipped = skippedLine(outcome);
  if (skipped !== null) {
    lines.push(skipped);
  }
  const failed = failedLine(outcome);
  if (failed !== null) {
    lines.push(failed);
  }
  const halt = haltLine(outcome);
  if (halt !== null) {
    lines.push(halt);
  }
  lines.push(liveNotifyLine(outcome.notify));
  const breakerWarn = breakerWarningLine(outcome.preview);
  if (breakerWarn !== null) {
    lines.push(breakerWarn);
  }
  lines.push(reconcileLine(outcome));
  const scope = scopeLine(outcome.preview);
  if (scope !== null) {
    lines.push(scope);
  }
  if (outcome.purge.purged.length > 0) {
    lines.push(formatRetentionUserLines(outcome.purge.purged).join('\n'));
  }

  const description = clampEmbedText(lines.join('\n\n'), EMBED_CAPS.description);

  return new EmbedBuilder()
    .setTitle('🗑️ Daily retention run')
    .setColor(liveRunColor(outcome))
    .setDescription(description)
    .setFooter({
      text:
        `Run: ${outcome.runContext} · ${outcome.runId} · ` +
        'kill switch: RETENTION_AUTORUN_ENABLED=false',
    })
    .setTimestamp();
}

/** True when a rehearsal produced anything worth an owner's attention. */
export function shouldReportRehearsal(
  preview: RetentionPreviewResponse,
  notify: NotifyStepOutcome
): boolean {
  return (
    preview.totals.eligibleCount > 0 ||
    notify.kind === 'failed' ||
    (notify.kind === 'ok' && notify.status === 'refused_breaker') ||
    (notify.kind === 'ok' && notify.cohortSize > 0)
  );
}

function rehearsalNotifyLine(notify: NotifyStepOutcome): string {
  if (notify.kind === 'failed') {
    return `**Notify dry run failed:** ${notify.error}`;
  }
  if (notify.status === 'refused_breaker') {
    return `**Notify would be refused by the breaker:** ${notify.breakerDetail ?? ''}`;
  }
  if (notify.status === 'empty') {
    return '**Would warn:** nobody';
  }
  return `**Would warn:** ${String(notify.cohortSize)} users`;
}

/** Build the owner-channel embed for a rehearsal worth reporting. */
export function buildRehearsalEmbed(
  preview: RetentionPreviewResponse,
  notify: NotifyStepOutcome,
  runContext: string
): EmbedBuilder {
  const { totals } = preview;
  const lines: string[] = [
    '**Rehearsal — nothing was sent or deleted.** Live retention runs are ' +
      'production-only; this is what a live run here would start from.',
    `**Would purge:** ${String(totals.eligibleCount)} of ${String(totals.userbaseCount)} users ` +
      `(${String(totals.percentOfUserbase)}%) · characters: ${String(totals.charactersToDelete)} ` +
      `deleted, ${String(totals.charactersToReHome)} re-homed`,
  ];
  const scope = scopeLine(preview);
  if (scope !== null) {
    lines.push(scope);
  }
  lines.push(rehearsalNotifyLine(notify));
  const breakerWarn = breakerWarningLine(preview);
  if (breakerWarn !== null) {
    lines.push(breakerWarn);
  }
  if (preview.users.length > 0) {
    lines.push(formatRetentionUserLines(preview.users, '(see the preview CLI)').join('\n'));
  }

  const description = clampEmbedText(lines.join('\n\n'), EMBED_CAPS.description);

  return new EmbedBuilder()
    .setTitle('🧪 Retention rehearsal (dry run)')
    .setColor(DISCORD_COLORS.BLURPLE)
    .setFooter({ text: `Rehearsal: ${runContext}` })
    .setDescription(description)
    .setTimestamp();
}
