/**
 * Tests for the live-run and rehearsal owner-channel embeds and their
 * report-worthiness gates.
 */

import { describe, it, expect } from 'vitest';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import type { RetentionPreviewResponse } from '@tzurot/common-types/schemas/api/internal';
import {
  shouldReportLiveRun,
  buildLiveRunEmbed,
  summarizeLiveRun,
  shouldReportRehearsal,
  buildRehearsalEmbed,
} from './retentionRunReport.js';
import type {
  LiveRunOutcome,
  NotifyStepOutcome,
  PurgeLoopOutcome,
  RetentionPreviewUser,
} from './types.js';

function makeUser(id: string, overrides: Partial<RetentionPreviewUser> = {}): RetentionPreviewUser {
  return {
    discordId: id,
    username: `user-${id}`,
    inactiveSince: '2025-09-01T00:00:00.000Z',
    reason: 'unreachable',
    ownedCharacters: { toDelete: 1, toReHome: 0 },
    ...overrides,
  };
}

function makePreview(overrides: {
  users?: RetentionPreviewUser[];
  eligibleCount?: number;
  breakerWarning?: boolean;
  scope?: RetentionPreviewResponse['totals']['scope'];
}): RetentionPreviewResponse {
  const users = overrides.users ?? [];
  return {
    users,
    totals: {
      eligibleCount: overrides.eligibleCount ?? users.length,
      userbaseCount: 300,
      percentOfUserbase: 1,
      charactersToDelete: users.length,
      charactersToReHome: 0,
      breakerWarning: overrides.breakerWarning ?? false,
      reachableToNotify: 0,
      inGrace: 0,
      graceExpired: 0,
      bystander: 0,
      reminderDue: 0,
      scope: overrides.scope ?? { kind: 'unrestricted', excludedEligibleCount: 0 },
    },
  } satisfies RetentionPreviewResponse;
}

function quietPurge(): PurgeLoopOutcome {
  return {
    attempted: 0,
    purged: [],
    charactersDeleted: 0,
    charactersReHomed: 0,
    skippedByReason: {},
    failed: 0,
    failureKinds: {},
    halt: null,
  };
}

const rehearsalContext = 'job:retention-rehearsal';

const quietNotify: NotifyStepOutcome = {
  kind: 'ok',
  status: 'empty',
  cohortSize: 0,
  batchesEnqueued: 0,
  breakerWarning: false,
  reminderCohortSize: 0,
  reminderBatchesEnqueued: 0,
};

function makeOutcome(overrides: Partial<LiveRunOutcome> = {}): LiveRunOutcome {
  return {
    runId: 'test-run-id',
    runContext: 'job:retention-daily',
    preview: makePreview({}),
    notify: quietNotify,
    purge: quietPurge(),
    reconcile: { kind: 'ok', settled: 0, stillFailing: 0, remaining: 0, iterations: 1 },
    ...overrides,
  };
}

describe('shouldReportLiveRun', () => {
  it('is false for the all-quiet outcome', () => {
    expect(shouldReportLiveRun(makeOutcome())).toBe(false);
  });

  it('is true when purged.length > 0', () => {
    const outcome = makeOutcome({ purge: { ...quietPurge(), purged: [makeUser('1')] } });
    expect(shouldReportLiveRun(outcome)).toBe(true);
  });

  it('is true when failed > 0', () => {
    const outcome = makeOutcome({ purge: { ...quietPurge(), failed: 1 } });
    expect(shouldReportLiveRun(outcome)).toBe(true);
  });

  it('is true when halt is set', () => {
    const outcome = makeOutcome({ purge: { ...quietPurge(), halt: { kind: 'lease_lost' } } });
    expect(shouldReportLiveRun(outcome)).toBe(true);
  });

  it('is true when notify failed', () => {
    const outcome = makeOutcome({ notify: { kind: 'failed', error: 'boom' } });
    expect(shouldReportLiveRun(outcome)).toBe(true);
  });

  it('is true when notify status is refused_breaker', () => {
    const outcome = makeOutcome({
      notify: { ...quietNotify, status: 'refused_breaker', breakerDetail: 'too many' },
    });
    expect(shouldReportLiveRun(outcome)).toBe(true);
  });

  it('is true when batchesEnqueued > 0', () => {
    const outcome = makeOutcome({
      notify: { ...quietNotify, status: 'enqueued', batchesEnqueued: 2 },
    });
    expect(shouldReportLiveRun(outcome)).toBe(true);
  });

  it('is true when reminderBatchesEnqueued > 0, even with no warning batches', () => {
    const outcome = makeOutcome({
      notify: { ...quietNotify, status: 'enqueued', reminderBatchesEnqueued: 1 },
    });
    expect(shouldReportLiveRun(outcome)).toBe(true);
  });

  it('is true when reconcile failed, even with nothing else to report', () => {
    const outcome = makeOutcome({
      reconcile: { kind: 'failed', error: 'x', settled: 0, stillFailing: 0, iterations: 1 },
    });
    expect(shouldReportLiveRun(outcome)).toBe(true);
  });

  it('is true when reconcile.stillFailing > 0, even with nothing else to report', () => {
    const outcome = makeOutcome({
      reconcile: { kind: 'ok', settled: 0, stillFailing: 1, remaining: 0, iterations: 1 },
    });
    expect(shouldReportLiveRun(outcome)).toBe(true);
  });

  it('is false for the fully-quiet outcome (reconcile ok, stillFailing 0)', () => {
    const outcome = makeOutcome({
      reconcile: { kind: 'ok', settled: 3, stillFailing: 0, remaining: 0, iterations: 1 },
    });
    expect(shouldReportLiveRun(outcome)).toBe(false);
  });

  it('reconcile hit the cap with rows not yet attempted → report posted', () => {
    const outcome = makeOutcome({
      reconcile: { kind: 'ok', settled: 3, stillFailing: 0, remaining: 2, iterations: 10 },
    });
    expect(shouldReportLiveRun(outcome)).toBe(true);
  });

  it('is true when the preview alone flags a breaker warning, with nothing else to report', () => {
    const outcome = makeOutcome({ preview: makePreview({ breakerWarning: true }) });
    expect(shouldReportLiveRun(outcome)).toBe(true);
  });
});

describe('summarizeLiveRun', () => {
  it('carries only ids/counts, no PII', () => {
    const outcome = makeOutcome({ purge: { ...quietPurge(), purged: [makeUser('1')] } });
    const summary = summarizeLiveRun(outcome);

    expect(summary.purged).toBe(1);
    expect(JSON.stringify(summary)).not.toContain('user-1');
  });

  it('carries reconcileRemaining from the ok arm', () => {
    const outcome = makeOutcome({
      reconcile: { kind: 'ok', settled: 3, stillFailing: 0, remaining: 2, iterations: 10 },
    });
    expect(summarizeLiveRun(outcome).reconcileRemaining).toBe(2);
  });

  it('reports reconcileRemaining as 0 for the failed arm (no remaining field to read)', () => {
    const outcome = makeOutcome({
      reconcile: { kind: 'failed', error: 'x', settled: 1, stillFailing: 0, iterations: 1 },
    });
    expect(summarizeLiveRun(outcome).reconcileRemaining).toBe(0);
  });

  it('carries breakerWarning and eligibleCount from the preview totals', () => {
    const outcome = makeOutcome({
      preview: makePreview({ breakerWarning: true, eligibleCount: 5 }),
    });
    const summary = summarizeLiveRun(outcome);

    expect(summary.breakerWarning).toBe(true);
    expect(summary.eligibleCount).toBe(5);
  });
});

describe('buildLiveRunEmbed content', () => {
  it('always includes the Purged line', () => {
    const embed = buildLiveRunEmbed(makeOutcome()).toJSON();
    expect(embed.description).toContain('**Purged:** 0 of 0 eligible');
  });

  it('includes the Skipped line only when a reason count is nonzero', () => {
    const quiet = buildLiveRunEmbed(makeOutcome()).toJSON();
    const withSkips = buildLiveRunEmbed(
      makeOutcome({
        purge: { ...quietPurge(), skippedByReason: { already_gone: 2, outside_allowlist: 1 } },
      })
    ).toJSON();

    expect(quiet.description).not.toContain('**Skipped:**');
    expect(withSkips.description).toContain(
      '**Skipped:** already gone ×2 · outside the allowlist ×1'
    );
  });

  it('includes the Failed line only when failed > 0, with the timeout caveat appended', () => {
    const noFail = buildLiveRunEmbed(makeOutcome()).toJSON();
    const withFail = buildLiveRunEmbed(
      makeOutcome({ purge: { ...quietPurge(), failed: 1, failureKinds: { timeout: 1 } } })
    ).toJSON();
    const withoutTimeout = buildLiveRunEmbed(
      makeOutcome({ purge: { ...quietPurge(), failed: 1, failureKinds: { network: 1 } } })
    ).toJSON();

    expect(noFail.description).not.toContain('**Failed:**');
    expect(withFail.description).toContain('**Failed:** 1 (timeout ×1)');
    expect(withFail.description).toContain('may still have committed');
    expect(withoutTimeout.description).not.toContain('may still have committed');
  });

  it('renders the breaker-tripped halt line with the CLI hint', () => {
    const embed = buildLiveRunEmbed(
      makeOutcome({
        purge: { ...quietPurge(), halt: { kind: 'breaker_tripped', detail: 'too much churn' } },
      })
    ).toJSON();

    expect(embed.description).toContain('Halted — circuit breaker tripped');
    expect(embed.description).toContain('too much churn');
    expect(embed.description).toContain('--breaker-override');
  });

  it('renders the lease_lost halt line', () => {
    const embed = buildLiveRunEmbed(
      makeOutcome({ purge: { ...quietPurge(), halt: { kind: 'lease_lost' } } })
    ).toJSON();

    expect(embed.description).toContain('the run lease was lost');
  });

  it('renders the aborted-consecutive-failures halt line', () => {
    const embed = buildLiveRunEmbed(
      makeOutcome({
        purge: {
          ...quietPurge(),
          halt: { kind: 'aborted_consecutive_failures', consecutiveFailures: 3 },
        },
      })
    ).toJSON();

    expect(embed.description).toContain('Aborted after 3 consecutive failures');
  });

  it('renders every notify branch', () => {
    const failed = buildLiveRunEmbed(
      makeOutcome({ notify: { kind: 'failed', error: 'boom' } })
    ).toJSON();
    const refused = buildLiveRunEmbed(
      makeOutcome({
        notify: { ...quietNotify, status: 'refused_breaker', breakerDetail: 'too many' },
      })
    ).toJSON();
    const enqueuedOne = buildLiveRunEmbed(
      makeOutcome({
        notify: { ...quietNotify, status: 'enqueued', cohortSize: 5, batchesEnqueued: 1 },
      })
    ).toJSON();
    const enqueuedMany = buildLiveRunEmbed(
      makeOutcome({
        notify: { ...quietNotify, status: 'enqueued', cohortSize: 5, batchesEnqueued: 2 },
      })
    ).toJSON();
    const empty = buildLiveRunEmbed(makeOutcome()).toJSON();
    // NotifyStepOutcome shares its status type with the rehearsal path, and
    // executeLiveRun's own call never sets dryRun — so a live gateway
    // response carrying 'dry_run' is not expected here, though that is
    // unverified against the live gateway. This pins the fallback line that
    // renders an unmapped status verbatim rather than assuming it can't happen.
    const unexpectedStatus = buildLiveRunEmbed(
      makeOutcome({ notify: { ...quietNotify, status: 'dry_run' } })
    ).toJSON();

    expect(failed.description).toContain('**Notify failed:** boom');
    expect(refused.description).toContain('**Notify refused by the breaker:** too many');
    expect(enqueuedOne.description).toContain('warning DMs queued for 5 users (1 batch)');
    expect(enqueuedMany.description).toContain('warning DMs queued for 5 users (2 batches)');
    expect(empty.description).toContain('**Notify:** nobody is awaiting a warning or a reminder');
    expect(unexpectedStatus.description).toContain('**Notify:** dry_run');
  });

  it('renders the notify line in all four cohort-combination shapes', () => {
    const both = buildLiveRunEmbed(
      makeOutcome({
        notify: {
          ...quietNotify,
          status: 'enqueued',
          cohortSize: 5,
          batchesEnqueued: 1,
          reminderCohortSize: 3,
          reminderBatchesEnqueued: 1,
        },
      })
    ).toJSON();
    const warningsOnly = buildLiveRunEmbed(
      makeOutcome({
        notify: { ...quietNotify, status: 'enqueued', cohortSize: 5, batchesEnqueued: 1 },
      })
    ).toJSON();
    const remindersOnly = buildLiveRunEmbed(
      makeOutcome({
        notify: {
          ...quietNotify,
          status: 'enqueued',
          reminderCohortSize: 3,
          reminderBatchesEnqueued: 1,
        },
      })
    ).toJSON();
    const empty = buildLiveRunEmbed(makeOutcome()).toJSON();

    expect(both.description).toContain('warning DMs queued for 5 users (1 batch)');
    expect(both.description).toContain('reminders queued for 3 users (1 batch)');
    expect(warningsOnly.description).toContain('warning DMs queued for 5 users (1 batch)');
    expect(warningsOnly.description).not.toContain('reminders queued');
    expect(remindersOnly.description).toContain('reminders queued for 3 users (1 batch)');
    expect(remindersOnly.description).not.toContain('warning DMs queued');
    expect(empty.description).toContain('**Notify:** nobody is awaiting a warning or a reminder');
  });

  it('is reportable on a reminders-only run', () => {
    const outcome = makeOutcome({
      notify: {
        ...quietNotify,
        status: 'enqueued',
        reminderCohortSize: 3,
        reminderBatchesEnqueued: 1,
      },
    });
    expect(shouldReportLiveRun(outcome)).toBe(true);
  });

  it('includes the breaker-warning line only when the preview flags it', () => {
    const calm = buildLiveRunEmbed(makeOutcome()).toJSON();
    const warned = buildLiveRunEmbed(
      makeOutcome({ preview: makePreview({ breakerWarning: true }) })
    ).toJSON();

    expect(calm.description).not.toContain('exceeds the breaker warning share');
    expect(warned.description).toContain('exceeds the breaker warning share');
  });

  it('renders both reconcile branches', () => {
    const ok = buildLiveRunEmbed(
      makeOutcome({
        reconcile: { kind: 'ok', settled: 3, stillFailing: 1, remaining: 2, iterations: 4 },
      })
    ).toJSON();
    const failed = buildLiveRunEmbed(
      makeOutcome({
        reconcile: { kind: 'failed', error: 'db down', settled: 1, stillFailing: 0, iterations: 2 },
      })
    ).toJSON();

    expect(ok.description).toContain(
      '**Off-DB cleanup:** 3 settled, 1 still failing, 2 not yet attempted'
    );
    expect(failed.description).toContain(
      '**Off-DB cleanup failed:** db down (1 settled before it failed)'
    );
  });

  it('includes the scope line only when scope is not unrestricted', () => {
    const unrestricted = buildLiveRunEmbed(makeOutcome()).toJSON();
    const scoped = buildLiveRunEmbed(
      makeOutcome({
        preview: makePreview({ scope: { kind: 'allowlist', excludedEligibleCount: 4 } }),
      })
    ).toJSON();

    expect(unrestricted.description).not.toContain('**Scope:**');
    expect(scoped.description).toContain('**Scope:** allowlist — 4 purge-eligible account(s)');
  });

  it('renders purged-user rows only when purged > 0, and escapes the username', () => {
    const noRows = buildLiveRunEmbed(makeOutcome()).toJSON();
    const withRows = buildLiveRunEmbed(
      makeOutcome({
        purge: { ...quietPurge(), purged: [makeUser('1', { username: '*bold*' })] },
      })
    ).toJSON();

    expect(noRows.description).not.toContain('inactive since');
    expect(withRows.description).toContain('inactive since');
    expect(withRows.description).toContain('\\*bold\\*');
    expect(withRows.description).not.toContain('@*bold*');
  });

  it.each([
    [
      'ERROR',
      { purge: { ...quietPurge(), halt: { kind: 'lease_lost' as const } } },
      DISCORD_COLORS.ERROR,
    ],
    ['WARNING', { purge: { ...quietPurge(), failed: 1 } }, DISCORD_COLORS.WARNING],
    [
      'WARNING (reconcile failed)',
      {
        reconcile: {
          kind: 'failed' as const,
          error: 'x',
          settled: 0,
          stillFailing: 0,
          iterations: 1,
        },
      },
      DISCORD_COLORS.WARNING,
    ],
    [
      'WARNING (reconcile stillFailing)',
      {
        reconcile: {
          kind: 'ok' as const,
          settled: 0,
          stillFailing: 1,
          remaining: 0,
          iterations: 1,
        },
      },
      DISCORD_COLORS.WARNING,
    ],
    [
      'WARNING (reconcile remaining)',
      {
        reconcile: {
          kind: 'ok' as const,
          settled: 0,
          stillFailing: 0,
          remaining: 2,
          iterations: 10,
        },
      },
      DISCORD_COLORS.WARNING,
    ],
    [
      'WARNING (breaker warning alone)',
      { preview: makePreview({ breakerWarning: true }) },
      DISCORD_COLORS.WARNING,
    ],
    ['SUCCESS', {}, DISCORD_COLORS.SUCCESS],
  ])('uses %s color appropriately', (_label, overrides, expectedColor) => {
    const embed = buildLiveRunEmbed(makeOutcome(overrides as Partial<LiveRunOutcome>)).toJSON();
    expect(embed.color).toBe(expectedColor);
  });

  it('a halt PLUS a breaker warning stays ERROR (never lowered to WARNING)', () => {
    const outcome = makeOutcome({
      purge: { ...quietPurge(), halt: { kind: 'lease_lost' } },
      preview: makePreview({ breakerWarning: true }),
    });
    const embed = buildLiveRunEmbed(outcome).toJSON();
    expect(embed.color).toBe(DISCORD_COLORS.ERROR);
  });

  it('a breaker halt PLUS a reconcile still-failing row stays ERROR (never lowered to WARNING)', () => {
    const outcome = makeOutcome({
      purge: { ...quietPurge(), halt: { kind: 'breaker_tripped', detail: 'too much churn' } },
      reconcile: { kind: 'ok', settled: 0, stillFailing: 1, remaining: 0, iterations: 1 },
    });
    const embed = buildLiveRunEmbed(outcome).toJSON();
    expect(embed.color).toBe(DISCORD_COLORS.ERROR);
  });

  it('a lease-lost halt PLUS reconcile remaining stays ERROR (never lowered to WARNING)', () => {
    const outcome = makeOutcome({
      purge: { ...quietPurge(), halt: { kind: 'lease_lost' } },
      reconcile: { kind: 'ok', settled: 0, stillFailing: 0, remaining: 3, iterations: 10 },
    });
    const embed = buildLiveRunEmbed(outcome).toJSON();
    expect(embed.color).toBe(DISCORD_COLORS.ERROR);
  });

  it('renders the runId in the footer alongside the run context and kill switch hint', () => {
    const embed = buildLiveRunEmbed(makeOutcome({ runId: 'sentinel-run-id' })).toJSON();

    expect(embed.footer?.text).toBe(
      'Run: job:retention-daily · sentinel-run-id · kill switch: RETENTION_AUTORUN_ENABLED=false'
    );
  });

  it('clamps a large purged list to the embed description cap without throwing', () => {
    const purged = Array.from({ length: 50 }, (_, i) =>
      makeUser(String(i), { username: 'x'.repeat(255) })
    );
    const outcome = makeOutcome({ purge: { ...quietPurge(), purged, attempted: 50 } });

    expect(() => buildLiveRunEmbed(outcome)).not.toThrow();
    const embed = buildLiveRunEmbed(outcome).toJSON();
    expect(embed.description?.length).toBeLessThanOrEqual(4096);
  });
});

describe('shouldReportRehearsal', () => {
  it('is true when eligibleCount > 0', () => {
    expect(shouldReportRehearsal(makePreview({ eligibleCount: 1 }), quietNotify)).toBe(true);
  });

  it('is true when notify failed', () => {
    expect(shouldReportRehearsal(makePreview({}), { kind: 'failed', error: 'boom' })).toBe(true);
  });

  it('is true when notify refused_breaker', () => {
    expect(
      shouldReportRehearsal(makePreview({}), { ...quietNotify, status: 'refused_breaker' })
    ).toBe(true);
  });

  it('is true when notify cohortSize > 0', () => {
    expect(
      shouldReportRehearsal(makePreview({}), { ...quietNotify, status: 'dry_run', cohortSize: 3 })
    ).toBe(true);
  });

  it('is true on a reminders-only rehearsal (reminderCohortSize > 0, no warning cohort)', () => {
    expect(
      shouldReportRehearsal(makePreview({}), {
        ...quietNotify,
        status: 'dry_run',
        reminderCohortSize: 4,
      })
    ).toBe(true);
  });

  it('is false for the all-quiet case', () => {
    expect(shouldReportRehearsal(makePreview({}), quietNotify)).toBe(false);
  });
});

describe('buildRehearsalEmbed content', () => {
  it('renders the fixed rehearsal intro and the would-purge line', () => {
    const embed = buildRehearsalEmbed(
      makePreview({ eligibleCount: 2 }),
      quietNotify,
      rehearsalContext
    ).toJSON();

    expect(embed.description).toContain('Rehearsal — nothing was sent or deleted');
    expect(embed.description).toContain('**Would purge:** 2 of 300 users');
  });

  it('renders every notify branch', () => {
    const failed = buildRehearsalEmbed(
      makePreview({}),
      { kind: 'failed', error: 'boom' },
      rehearsalContext
    ).toJSON();
    const refused = buildRehearsalEmbed(
      makePreview({}),
      { ...quietNotify, status: 'refused_breaker', breakerDetail: 'too many' },
      rehearsalContext
    ).toJSON();
    const dryRun = buildRehearsalEmbed(
      makePreview({}),
      { ...quietNotify, status: 'dry_run', cohortSize: 7 },
      rehearsalContext
    ).toJSON();
    const empty = buildRehearsalEmbed(makePreview({}), quietNotify, rehearsalContext).toJSON();

    expect(failed.description).toContain('**Notify dry run failed:** boom');
    expect(refused.description).toContain('**Notify would be refused by the breaker:** too many');
    expect(dryRun.description).toContain('**Would warn:** 7 users');
    expect(empty.description).toContain('**Would warn:** nobody');
  });

  it('renders a reminders-only dry run as "Would remind" with no "Would warn"', () => {
    const remindersOnly = buildRehearsalEmbed(
      makePreview({}),
      { ...quietNotify, status: 'dry_run', cohortSize: 0, reminderCohortSize: 4 },
      rehearsalContext
    ).toJSON();

    expect(remindersOnly.description).toContain('**Would remind:** 4 users');
    expect(remindersOnly.description).not.toContain('**Would warn:** 0');
  });

  it('renders both clauses when both cohorts are non-empty', () => {
    const both = buildRehearsalEmbed(
      makePreview({}),
      { ...quietNotify, status: 'dry_run', cohortSize: 7, reminderCohortSize: 4 },
      rehearsalContext
    ).toJSON();

    expect(both.description).toContain('**Would warn:** 7 users');
    expect(both.description).toContain('**Would remind:** 4 users');
  });

  it('includes the scope line only when scope is not unrestricted', () => {
    const unrestricted = buildRehearsalEmbed(
      makePreview({}),
      quietNotify,
      rehearsalContext
    ).toJSON();
    const scoped = buildRehearsalEmbed(
      makePreview({ scope: { kind: 'unscoped_non_production', excludedEligibleCount: 1 } }),
      quietNotify,
      rehearsalContext
    ).toJSON();

    expect(unrestricted.description).not.toContain('**Scope:**');
    expect(scoped.description).toContain('**Scope:** unscoped_non_production');
  });

  it('includes the breaker-warning line only when the preview flags it', () => {
    const calm = buildRehearsalEmbed(makePreview({}), quietNotify, rehearsalContext).toJSON();
    const warned = buildRehearsalEmbed(
      makePreview({ breakerWarning: true }),
      quietNotify,
      rehearsalContext
    ).toJSON();

    expect(calm.description).not.toContain('exceeds the breaker warning share');
    expect(warned.description).toContain('exceeds the breaker warning share');
  });

  it('renders rows with the preview-CLI overflow note and escapes the username', () => {
    const embed = buildRehearsalEmbed(
      makePreview({ users: [makeUser('1', { username: '*bold*' })], eligibleCount: 1 }),
      quietNotify,
      rehearsalContext
    ).toJSON();

    expect(embed.description).toContain('\\*bold\\*');
    expect(embed.description).not.toContain('@*bold*');
  });

  it('uses the BLURPLE color and renders the passed run context in the footer', () => {
    const sentinelContext = 'job:test-sentinel-context';
    const embed = buildRehearsalEmbed(makePreview({}), quietNotify, sentinelContext).toJSON();

    expect(embed.color).toBe(DISCORD_COLORS.BLURPLE);
    expect(embed.footer?.text).toBe(`Rehearsal: ${sentinelContext}`);
  });
});
