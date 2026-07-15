import { describe, it, expect } from 'vitest';
import {
  BROADCAST_MESSAGE_MAX_LENGTH,
  BroadcastInputSchema,
  BroadcastResponseSchema,
  DeliveryOutcomeSchema,
  ReleaseBroadcastDeliveriesInputSchema,
  ReleaseBroadcastPendingInputSchema,
} from './broadcast.js';

const UUID = '123e4567-e89b-42d3-a456-426614174000';

describe('BroadcastInputSchema', () => {
  it('rejects a bare real send (neither dryRun nor confirm) — the double-key gate', () => {
    expect(BroadcastInputSchema.safeParse({ message: 'hello' }).success).toBe(false);
  });

  it('accepts a dry-run without confirm, and applies the level default', () => {
    const parsed = BroadcastInputSchema.parse({ message: 'hello', dryRun: true });
    expect(parsed.level).toBe('major');
    expect(parsed.confirm).toBe(false);
  });

  it('accepts a confirmed real send', () => {
    const parsed = BroadcastInputSchema.parse({ message: 'hello', confirm: true });
    expect(parsed.dryRun).toBe(false);
  });

  it('rejects an empty message and one over the cap', () => {
    expect(BroadcastInputSchema.safeParse({ message: '', dryRun: true }).success).toBe(false);
    expect(
      BroadcastInputSchema.safeParse({
        message: 'x'.repeat(BROADCAST_MESSAGE_MAX_LENGTH + 1),
        dryRun: true,
      }).success
    ).toBe(false);
  });

  it('accepts a well-formed label and rejects unsafe charsets', () => {
    expect(
      BroadcastInputSchema.safeParse({ message: 'm', label: 'adhoc-2026.07.14_1', dryRun: true })
        .success
    ).toBe(true);
    expect(
      BroadcastInputSchema.safeParse({ message: 'm', label: 'has spaces', dryRun: true }).success
    ).toBe(false);
    expect(
      BroadcastInputSchema.safeParse({ message: 'm', label: '-leading-dash', dryRun: true }).success
    ).toBe(false);
  });

  it('rejects an unknown level', () => {
    expect(
      BroadcastInputSchema.safeParse({ message: 'm', level: 'all', dryRun: true }).success
    ).toBe(false);
  });

  it('rejects labels that squat the release-tag namespace (v<digit>…)', () => {
    expect(
      BroadcastInputSchema.safeParse({ message: 'm', label: 'v3.0.0-beta.1', dryRun: true }).success
    ).toBe(false);
    expect(
      BroadcastInputSchema.safeParse({ message: 'm', label: 'v2', dryRun: true }).success
    ).toBe(false);
    // A leading v NOT followed by a digit is still a legitimate label.
    expect(
      BroadcastInputSchema.safeParse({ message: 'm', label: 'voice-outage-notice', dryRun: true })
        .success
    ).toBe(true);
  });
});

describe('BroadcastResponseSchema', () => {
  it('accepts the dry-run arm', () => {
    const result = BroadcastResponseSchema.safeParse({
      dryRun: true,
      eligibleCount: 3,
      sample: [{ username: 'alice' }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts the enqueued arm', () => {
    const result = BroadcastResponseSchema.safeParse({
      dryRun: false,
      version: 'adhoc-1',
      releaseId: UUID,
      recipients: 3,
      batches: 1,
    });
    expect(result.success).toBe(true);
  });

  it('rejects cross-arm mixtures (dry-run with enqueue fields only)', () => {
    const result = BroadcastResponseSchema.safeParse({
      dryRun: true,
      version: 'adhoc-1',
      releaseId: UUID,
      recipients: 3,
      batches: 1,
    });
    expect(result.success).toBe(false);
  });
});

describe('ReleaseBroadcastPendingResponseSchema', () => {
  it('accepts a (possibly empty) pending subset', async () => {
    const { ReleaseBroadcastPendingResponseSchema } = await import('./broadcast.js');
    expect(
      ReleaseBroadcastPendingResponseSchema.safeParse({ pendingDeliveryLogIds: [UUID] }).success
    ).toBe(true);
    expect(
      ReleaseBroadcastPendingResponseSchema.safeParse({ pendingDeliveryLogIds: [] }).success
    ).toBe(true);
  });

  it('rejects non-uuid ids', async () => {
    const { ReleaseBroadcastPendingResponseSchema } = await import('./broadcast.js');
    expect(
      ReleaseBroadcastPendingResponseSchema.safeParse({ pendingDeliveryLogIds: ['nope'] }).success
    ).toBe(false);
  });
});

describe('ReleaseBroadcastDeliveriesResponseSchema', () => {
  it('accepts the ledger summary shape', async () => {
    const { ReleaseBroadcastDeliveriesResponseSchema } = await import('./broadcast.js');
    const result = ReleaseBroadcastDeliveriesResponseSchema.safeParse({
      updated: 2,
      autoDisabledUserIds: [UUID],
      completed: true,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a negative updated count', async () => {
    const { ReleaseBroadcastDeliveriesResponseSchema } = await import('./broadcast.js');
    const result = ReleaseBroadcastDeliveriesResponseSchema.safeParse({
      updated: -1,
      autoDisabledUserIds: [],
      completed: false,
    });
    expect(result.success).toBe(false);
  });
});

describe('internal route inputs', () => {
  it('pending: rejects an empty id list', () => {
    expect(ReleaseBroadcastPendingInputSchema.safeParse({ deliveryLogIds: [] }).success).toBe(
      false
    );
    expect(ReleaseBroadcastPendingInputSchema.safeParse({ deliveryLogIds: [UUID] }).success).toBe(
      true
    );
  });

  it('deliveries: accepts terminal outcomes and rejects pending', () => {
    expect(DeliveryOutcomeSchema.safeParse('sent').success).toBe(true);
    expect(DeliveryOutcomeSchema.safeParse('failed_permanent').success).toBe(true);
    expect(DeliveryOutcomeSchema.safeParse('pending').success).toBe(false);

    const result = ReleaseBroadcastDeliveriesInputSchema.safeParse({
      results: [{ deliveryLogId: UUID, status: 'failed_permanent', errorCode: '50007' }],
    });
    expect(result.success).toBe(true);
  });

  it('reconcile: accepts an empty body, bounds lookbackHours to a week', async () => {
    const { ReleaseReconcileInputSchema } = await import('./broadcast.js');
    expect(ReleaseReconcileInputSchema.safeParse({}).success).toBe(true);
    expect(ReleaseReconcileInputSchema.safeParse({ lookbackHours: 168 }).success).toBe(true);
    expect(ReleaseReconcileInputSchema.safeParse({ lookbackHours: 169 }).success).toBe(false);
    expect(ReleaseReconcileInputSchema.safeParse({ lookbackHours: 0 }).success).toBe(false);
    expect(ReleaseReconcileInputSchema.safeParse({ lookbackHours: 2.5 }).success).toBe(false);
  });

  it('reconcile: response summary shape round-trips', async () => {
    const { ReleaseReconcileResponseSchema } = await import('./broadcast.js');
    const result = ReleaseReconcileResponseSchema.safeParse({
      checked: 2,
      announced: ['v3.0.0-beta.166'],
      alreadyAnnounced: 1,
      skipped: 0,
      capped: false,
    });
    expect(result.success).toBe(true);
    expect(ReleaseReconcileResponseSchema.safeParse({ checked: -1 }).success).toBe(false);
  });
});
