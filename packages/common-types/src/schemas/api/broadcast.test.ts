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
});
