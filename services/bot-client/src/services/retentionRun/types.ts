/**
 * Shared types for the retention job's three modes (live / nag / rehearsal).
 * Colocated here so every module in this directory imports from one place
 * rather than re-deriving these shapes.
 */

import type {
  RetentionPreviewResponse,
  RetentionPurgeResponse,
  RetentionNotifyResponse,
} from '@tzurot/common-types/schemas/api/internal';

export type RetentionPreviewUser = RetentionPreviewResponse['users'][number];

export type PurgeSkipReason = NonNullable<RetentionPurgeResponse['reason']>;

export type NotifyStepOutcome =
  | {
      kind: 'ok';
      status: RetentionNotifyResponse['status'];
      cohortSize: number;
      batchesEnqueued: number;
      breakerWarning: boolean;
      breakerDetail?: string;
    }
  | { kind: 'failed'; error: string };

export type PurgeHalt =
  | { kind: 'breaker_tripped'; detail: string }
  | { kind: 'lease_lost' }
  | { kind: 'aborted_consecutive_failures'; consecutiveFailures: number };

export interface PurgeLoopOutcome {
  /** Purge calls made. */
  attempted: number;
  /** The preview rows of accounts actually purged, in order. */
  purged: RetentionPreviewUser[];
  charactersDeleted: number;
  charactersReHomed: number;
  skippedByReason: Partial<Record<PurgeSkipReason | 'unspecified', number>>;
  failed: number;
  /** GatewayResult `kind` ('timeout', 'http', 'network', ...) or 'exception' for a throw. */
  failureKinds: Record<string, number>;
  halt: PurgeHalt | null;
}

export type ReconcileOutcome =
  | { kind: 'ok'; settled: number; stillFailing: number; remaining: number; iterations: number }
  | { kind: 'failed'; error: string; settled: number; stillFailing: number; iterations: number };

export interface LiveRunOutcome {
  runId: string;
  runContext: string;
  preview: RetentionPreviewResponse;
  notify: NotifyStepOutcome;
  purge: PurgeLoopOutcome;
  reconcile: ReconcileOutcome;
}
