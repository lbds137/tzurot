/**
 * Tests for the scheduled-job dispatch table.
 *
 * Pins two invariants the module docstring claims: every `SCHEDULED_JOBS`
 * registry name has a handler (registry-vs-handler-keys parity), and each
 * handler calls exactly the mocked sweep it's supposed to — no other.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { SCHEDULED_JOBS } from './scheduledJobSchedule.js';
import {
  buildScheduledJobHandlers,
  dispatchScheduledJob,
  type ScheduledJobDeps,
} from './scheduledJobDispatch.js';
import type { PendingMemoryProcessor } from './PendingMemoryProcessor.js';
import type { NullVectorReembedder } from './NullVectorReembedder.js';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return { ...actual, createLogger: () => mockLogger };
});

const mockCleanupDiagnosticLogs = vi.hoisted(() => vi.fn());
vi.mock('./CleanupDiagnosticLogs.js', () => ({
  cleanupDiagnosticLogs: mockCleanupDiagnosticLogs,
}));

const mockCleanupCommandEvents = vi.hoisted(() => vi.fn());
vi.mock('./CleanupCommandEvents.js', () => ({
  cleanupCommandEvents: mockCleanupCommandEvents,
}));

const mockCleanupStuckImportJobs = vi.hoisted(() => vi.fn());
vi.mock('./cleanupStuckImportJobs.js', () => ({
  cleanupStuckImportJobs: mockCleanupStuckImportJobs,
}));

const mockCleanupStuckExportJobs = vi.hoisted(() => vi.fn());
vi.mock('./cleanupStuckExportJobs.js', () => ({
  cleanupStuckExportJobs: mockCleanupStuckExportJobs,
}));

const mockCleanupExpiredExports = vi.hoisted(() => vi.fn());
vi.mock('./cleanupExpiredExports.js', () => ({
  cleanupExpiredExports: mockCleanupExpiredExports,
}));

const mockCleanupNotificationsRetention = vi.hoisted(() => vi.fn());
vi.mock('./cleanupNotificationsRetention.js', () => ({
  cleanupNotificationsRetention: mockCleanupNotificationsRetention,
}));

const mockTriggerReleaseReconcile = vi.hoisted(() => vi.fn());
vi.mock('./releaseReconcile.js', () => ({
  triggerReleaseReconcile: mockTriggerReleaseReconcile,
}));

const mockSweepRosterBlurbs = vi.hoisted(() => vi.fn());
vi.mock('./rosterBlurbSweep.js', () => ({
  sweepRosterBlurbs: mockSweepRosterBlurbs,
}));

const mockSweepRecentDaysDigests = vi.hoisted(() => vi.fn());
vi.mock('../services/recentDaysDigest/recentDaysDigestSweep.js', () => ({
  sweepRecentDaysDigests: mockSweepRecentDaysDigests,
}));

const mockSweepStaleRecentDaysDigests = vi.hoisted(() => vi.fn());
vi.mock('../services/recentDaysDigest/recentDaysDigestRetention.js', () => ({
  sweepStaleRecentDaysDigests: mockSweepStaleRecentDaysDigests,
}));

const mockCleanupOldHistory = vi.hoisted(() => vi.fn());
const mockCleanupSoftDeletedMessages = vi.hoisted(() => vi.fn());
vi.mock('@tzurot/conversation-history', () => ({
  // A regular `function` (not an arrow) so it can be invoked with `new` —
  // returning an object from a constructor call overrides the bound `this`.
  ConversationRetentionService: vi.fn().mockImplementation(function () {
    return {
      cleanupOldHistory: mockCleanupOldHistory,
      cleanupSoftDeletedMessages: mockCleanupSoftDeletedMessages,
    };
  }),
}));

/** Every mocked sweep function, keyed by a readable label for iteration/reset. */
const ALL_SWEEP_MOCKS = {
  cleanupDiagnosticLogs: mockCleanupDiagnosticLogs,
  cleanupCommandEvents: mockCleanupCommandEvents,
  cleanupStuckImportJobs: mockCleanupStuckImportJobs,
  cleanupStuckExportJobs: mockCleanupStuckExportJobs,
  cleanupExpiredExports: mockCleanupExpiredExports,
  cleanupNotificationsRetention: mockCleanupNotificationsRetention,
  triggerReleaseReconcile: mockTriggerReleaseReconcile,
  sweepRosterBlurbs: mockSweepRosterBlurbs,
  sweepRecentDaysDigests: mockSweepRecentDaysDigests,
  sweepStaleRecentDaysDigests: mockSweepStaleRecentDaysDigests,
  cleanupOldHistory: mockCleanupOldHistory,
  cleanupSoftDeletedMessages: mockCleanupSoftDeletedMessages,
} as const;

function buildDeps(): {
  deps: ScheduledJobDeps;
  processPendingMemories: ReturnType<typeof vi.fn>;
  getStats: ReturnType<typeof vi.fn>;
  sweep: ReturnType<typeof vi.fn>;
} {
  const processPendingMemories = vi.fn();
  const getStats = vi.fn();
  const sweep = vi.fn();
  const deps: ScheduledJobDeps = {
    pendingMemoryProcessor: {
      processPendingMemories,
      getStats,
    } as unknown as PendingMemoryProcessor,
    prisma: {} as PrismaClient,
    nullVectorReembedder: { sweep } as unknown as NullVectorReembedder,
  };
  return { deps, processPendingMemories, getStats, sweep };
}

describe('scheduledJobDispatch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    for (const mock of Object.values(ALL_SWEEP_MOCKS)) {
      mock.mockReset();
    }
    mockLogger.warn.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers exactly one handler per SCHEDULED_JOBS entry', () => {
    const { deps } = buildDeps();
    const handlers = buildScheduledJobHandlers(deps);
    expect(Object.keys(handlers).sort()).toEqual(Object.values(SCHEDULED_JOBS).sort());
  });

  const wiringCases: {
    jobName: string;
    calledMock: keyof typeof ALL_SWEEP_MOCKS;
  }[] = [
    {
      jobName: SCHEDULED_JOBS.CLEANUP_DIAGNOSTIC_LOGS,
      calledMock: 'cleanupDiagnosticLogs',
    },
    {
      jobName: SCHEDULED_JOBS.CLEANUP_COMMAND_EVENTS,
      calledMock: 'cleanupCommandEvents',
    },
    {
      jobName: SCHEDULED_JOBS.CLEANUP_STUCK_IMPORTS,
      calledMock: 'cleanupStuckImportJobs',
    },
    {
      jobName: SCHEDULED_JOBS.CLEANUP_STUCK_EXPORTS,
      calledMock: 'cleanupStuckExportJobs',
    },
    {
      jobName: SCHEDULED_JOBS.CLEANUP_EXPIRED_EXPORTS,
      calledMock: 'cleanupExpiredExports',
    },
    {
      jobName: SCHEDULED_JOBS.CLEANUP_NOTIFICATIONS_RETENTION,
      calledMock: 'cleanupNotificationsRetention',
    },
    {
      jobName: SCHEDULED_JOBS.RELEASE_RECONCILE,
      calledMock: 'triggerReleaseReconcile',
    },
    {
      jobName: SCHEDULED_JOBS.ROSTER_BLURB_SWEEP,
      calledMock: 'sweepRosterBlurbs',
    },
    {
      jobName: SCHEDULED_JOBS.RECENT_DAYS_DIGEST_SWEEP,
      calledMock: 'sweepRecentDaysDigests',
    },
    {
      jobName: SCHEDULED_JOBS.RECENT_DAYS_DIGEST_RETENTION,
      calledMock: 'sweepStaleRecentDaysDigests',
    },
  ];

  it.each(wiringCases)(
    'dispatching $jobName calls only its own sweep',
    async ({ jobName, calledMock }) => {
      const built = buildDeps();
      const handlers = buildScheduledJobHandlers(built.deps);

      await dispatchScheduledJob(handlers, jobName);

      for (const [label, mock] of Object.entries(ALL_SWEEP_MOCKS)) {
        if (label === calledMock) {
          expect(mock).toHaveBeenCalledTimes(1);
          if (calledMock === 'triggerReleaseReconcile') {
            expect(mock).toHaveBeenCalledWith();
          } else {
            expect(mock).toHaveBeenCalledWith(built.deps.prisma);
          }
        } else {
          expect(mock).not.toHaveBeenCalled();
        }
      }
      expect(built.processPendingMemories).not.toHaveBeenCalled();
      expect(built.getStats).not.toHaveBeenCalled();
      expect(built.sweep).not.toHaveBeenCalled();
    }
  );

  it('pending-memories handler calls processPendingMemories + getStats and merges the result', async () => {
    const built = buildDeps();
    built.processPendingMemories.mockResolvedValue({ processed: 3, succeeded: 2 });
    built.getStats.mockResolvedValue({ total: 5 });
    const handlers = buildScheduledJobHandlers(built.deps);

    const result = await dispatchScheduledJob(handlers, SCHEDULED_JOBS.PROCESS_PENDING_MEMORIES);

    expect(built.processPendingMemories).toHaveBeenCalledTimes(1);
    expect(built.getStats).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ processed: 3, succeeded: 2, backlog: { total: 5 } });
    for (const mock of Object.values(ALL_SWEEP_MOCKS)) {
      expect(mock).not.toHaveBeenCalled();
    }
    expect(built.sweep).not.toHaveBeenCalled();
  });

  it('reembed-null-vectors handler calls nullVectorReembedder.sweep and only that seam', async () => {
    const built = buildDeps();
    built.sweep.mockResolvedValue({ reembedded: 1 });
    const handlers = buildScheduledJobHandlers(built.deps);

    const result = await dispatchScheduledJob(handlers, SCHEDULED_JOBS.REEMBED_NULL_VECTORS);

    expect(built.sweep).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ reembedded: 1 });
    expect(built.processPendingMemories).not.toHaveBeenCalled();
    expect(built.getStats).not.toHaveBeenCalled();
    for (const mock of Object.values(ALL_SWEEP_MOCKS)) {
      expect(mock).not.toHaveBeenCalled();
    }
  });

  it('conversation-retention handler calls both retention methods and merges the result', async () => {
    const built = buildDeps();
    mockCleanupOldHistory.mockResolvedValue(7);
    mockCleanupSoftDeletedMessages.mockResolvedValue(2);
    const handlers = buildScheduledJobHandlers(built.deps);

    const result = await dispatchScheduledJob(
      handlers,
      SCHEDULED_JOBS.CLEANUP_CONVERSATION_RETENTION
    );

    expect(mockCleanupOldHistory).toHaveBeenCalledTimes(1);
    expect(mockCleanupSoftDeletedMessages).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ oldHistory: 7, softDeleted: 2 });
    for (const [label, mock] of Object.entries(ALL_SWEEP_MOCKS)) {
      if (label === 'cleanupOldHistory' || label === 'cleanupSoftDeletedMessages') {
        continue;
      }
      expect(mock).not.toHaveBeenCalled();
    }
  });

  it('resolves null and logs a warning for an unknown job name', async () => {
    const { deps } = buildDeps();
    const handlers = buildScheduledJobHandlers(deps);

    const result = await dispatchScheduledJob(handlers, 'no-such-job');

    expect(result).toBeNull();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      { jobName: 'no-such-job' },
      'Scheduled job has no handler'
    );
  });

  it('dispatch resolves the handler-returned value for a known job (name -> handler -> sweep seam)', async () => {
    const built = buildDeps();
    mockCleanupCommandEvents.mockResolvedValue({ deleted: 42 });
    const handlers = buildScheduledJobHandlers(built.deps);

    const result = await dispatchScheduledJob(handlers, SCHEDULED_JOBS.CLEANUP_COMMAND_EVENTS);

    expect(result).toEqual({ deleted: 42 });
  });
});
