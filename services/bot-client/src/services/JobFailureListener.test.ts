/**
 * Tests for JobFailureListener
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JobFailureListener } from './JobFailureListener.js';
import type { JobTracker } from './JobTracker.js';
import type { MultiTagCoordinator } from './MultiTagCoordinator.js';
import type { ResponseOrderingService } from './ResponseOrderingService.js';

// Mock bullmq's QueueEvents so start()/stop() lifecycle tests don't need a
// real Redis connection. vi.hoisted runs before vi.mock factories so the mocks
// are defined when bullmq is first imported (else: TDZ error). Mock uses
// `function` (not arrow) so `new QueueEventsMock(...)` works as a constructor.
const { QueueEventsMock, mockQueueEventsOn, mockQueueEventsClose } = vi.hoisted(() => {
  const on = vi.fn();
  const close = vi.fn().mockResolvedValue(undefined);
  const ctor = vi.fn(function MockQueueEvents() {
    return { on, close };
  });
  return {
    mockQueueEventsOn: on,
    mockQueueEventsClose: close,
    QueueEventsMock: ctor,
  };
});
vi.mock('bullmq', () => ({
  QueueEvents: QueueEventsMock,
}));

// Mock getConfig so start() finds a valid REDIS_URL without environment setup.
vi.mock('@tzurot/common-types/config/config', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/config/config')>(
    '@tzurot/common-types/config/config'
  );
  return {
    ...actual,
    getConfig: () => ({
      REDIS_URL: 'redis://localhost:6379',
      QUEUE_NAME: 'ai-requests-test',
    }),
  };
});

describe('JobFailureListener', () => {
  let jobTracker: { getContext: ReturnType<typeof vi.fn>; completeJob: ReturnType<typeof vi.fn> };
  let orderingService: { cancelJob: ReturnType<typeof vi.fn> };
  let multiTagCoordinator: {
    ownsJob: ReturnType<typeof vi.fn>;
    handleJobResult: ReturnType<typeof vi.fn>;
  };
  let listener: JobFailureListener;

  beforeEach(() => {
    vi.clearAllMocks();
    jobTracker = {
      getContext: vi.fn(),
      completeJob: vi.fn(),
    };
    orderingService = {
      cancelJob: vi.fn().mockResolvedValue(undefined),
    };
    multiTagCoordinator = {
      // Default: jobs are NOT multi-tag (single-tag routing path). Tests for
      // the multi-tag branch override this per-call.
      ownsJob: vi.fn().mockReturnValue(false),
      handleJobResult: vi.fn().mockResolvedValue(undefined),
    };
    listener = new JobFailureListener(
      jobTracker as unknown as JobTracker,
      orderingService as unknown as ResponseOrderingService,
      multiTagCoordinator as unknown as MultiTagCoordinator
    );
  });

  describe('handleTerminalEvent — single-tag routing', () => {
    it('calls cancelJob with channelId from JobTracker context on failed', async () => {
      jobTracker.getContext.mockReturnValue({ channel: { id: 'channel-abc' } });

      await listener.handleTerminalEvent('failed', 'job-123', 'connection refused');

      expect(multiTagCoordinator.ownsJob).toHaveBeenCalledWith('job-123');
      expect(jobTracker.getContext).toHaveBeenCalledWith('job-123');
      expect(orderingService.cancelJob).toHaveBeenCalledWith('channel-abc', 'job-123');
      expect(multiTagCoordinator.handleJobResult).not.toHaveBeenCalled();
    });

    it('calls cancelJob on removed events', async () => {
      jobTracker.getContext.mockReturnValue({ channel: { id: 'channel-xyz' } });

      await listener.handleTerminalEvent('removed', 'job-456');

      expect(orderingService.cancelJob).toHaveBeenCalledWith('channel-xyz', 'job-456');
    });

    it('no-ops when JobTracker has no context for the jobId', async () => {
      jobTracker.getContext.mockReturnValue(null);

      await listener.handleTerminalEvent('failed', 'unknown-job', 'whatever');

      expect(orderingService.cancelJob).not.toHaveBeenCalled();
      expect(multiTagCoordinator.handleJobResult).not.toHaveBeenCalled();
    });

    it('does not call jobTracker.completeJob — failure path must not silently delete the "taking longer" notification', async () => {
      // Reinforces the design choice: failure listener only touches the
      // ordering service, not JobTracker. completeJob deletes the
      // "taking longer" message, which would mislead users on real failures.
      jobTracker.getContext.mockReturnValue({ channel: { id: 'channel-1' } });

      await listener.handleTerminalEvent('failed', 'job-1');

      expect(orderingService.cancelJob).toHaveBeenCalled();
      expect(jobTracker.completeJob).not.toHaveBeenCalled();
    });
  });

  describe('handleTerminalEvent — multi-tag routing', () => {
    it('routes failure through coordinator.handleJobResult with synthesized failure result', async () => {
      // Without this routing, a live multi-tag slot failure would leave the
      // slot in 'pending' until the 10-min safety timeout fires. Routing
      // through handleJobResult transitions the slot to 'errored' immediately
      // so the group can flush as soon as all slots are terminal.
      multiTagCoordinator.ownsJob.mockReturnValue(true);

      await listener.handleTerminalEvent('failed', 'multitag-job-1', 'OpenRouter 502');

      expect(multiTagCoordinator.handleJobResult).toHaveBeenCalledWith('multitag-job-1', {
        requestId: 'multitag-job-1',
        success: false,
        error: 'OpenRouter 502',
      });
      // Single-tag path NOT taken for a multi-tag jobId.
      expect(orderingService.cancelJob).not.toHaveBeenCalled();
    });

    it("synthesizes a default error when failedReason is missing (e.g., 'removed' event)", async () => {
      multiTagCoordinator.ownsJob.mockReturnValue(true);

      await listener.handleTerminalEvent('removed', 'multitag-job-2');

      expect(multiTagCoordinator.handleJobResult).toHaveBeenCalledWith('multitag-job-2', {
        requestId: 'multitag-job-2',
        success: false,
        error: 'Job removed (no reason provided)',
      });
    });

    it('does not fall through to single-tag path even if jobTracker also tracks the jobId', async () => {
      // Defense against an exotic race: if the same jobId somehow appeared in
      // BOTH the coordinator's jobToGroup map AND the JobTracker, the routing
      // must be deterministic and pick the multi-tag path (the coordinator
      // owns the user-facing delivery for multi-tag slots).
      multiTagCoordinator.ownsJob.mockReturnValue(true);
      jobTracker.getContext.mockReturnValue({ channel: { id: 'channel-1' } });

      await listener.handleTerminalEvent('failed', 'shared-job-id', 'reason');

      expect(multiTagCoordinator.handleJobResult).toHaveBeenCalledOnce();
      expect(jobTracker.getContext).not.toHaveBeenCalled();
      expect(orderingService.cancelJob).not.toHaveBeenCalled();
    });
  });

  describe('lifecycle', () => {
    it('start() creates a QueueEvents subscription and wires failed/removed/error listeners', () => {
      listener.start();

      expect(QueueEventsMock).toHaveBeenCalledTimes(1);
      // First arg is the queue name, second is the connection options bag
      expect(QueueEventsMock).toHaveBeenCalledWith('ai-requests-test', expect.any(Object));
      // Three event listeners attached
      const attachedEvents = mockQueueEventsOn.mock.calls.map(c => c[0]);
      expect(attachedEvents).toEqual(expect.arrayContaining(['failed', 'removed', 'error']));
    });

    it('start() is idempotent — second call no-ops without leaking a second QueueEvents', () => {
      listener.start();
      listener.start();

      expect(QueueEventsMock).toHaveBeenCalledTimes(1);
    });

    it('stop() closes the QueueEvents and allows start() to run again', async () => {
      listener.start();
      await listener.stop();

      expect(mockQueueEventsClose).toHaveBeenCalledTimes(1);

      // Now start() should construct a fresh QueueEvents since the previous one is gone
      listener.start();
      expect(QueueEventsMock).toHaveBeenCalledTimes(2);
    });

    it('stop() is a no-op when not started', async () => {
      await listener.stop();
      expect(mockQueueEventsClose).not.toHaveBeenCalled();
    });

    it('failed listener calls handleTerminalEvent with the jobId and failedReason', async () => {
      listener.start();
      jobTracker.getContext.mockReturnValue({ channel: { id: 'channel-1' } });

      // Find the failed listener that start() registered and invoke it directly
      const failedCall = mockQueueEventsOn.mock.calls.find(c => c[0] === 'failed');
      expect(failedCall).toBeDefined();
      const failedHandler = failedCall![1] as (arg: {
        jobId: string;
        failedReason: string;
      }) => void;
      failedHandler({ jobId: 'job-from-event', failedReason: 'boom' });

      // handleTerminalEvent runs async via `void` in the listener. vi.waitFor
      // polls until the assertion passes (or its timeout fires) — survives any
      // future awaits added before the cancelJob call. A single `Promise.resolve`
      // tick would pass today but silently break if an earlier await is added.
      await vi.waitFor(() =>
        expect(orderingService.cancelJob).toHaveBeenCalledWith('channel-1', 'job-from-event')
      );
    });

    it('removed listener calls handleTerminalEvent with the jobId', async () => {
      // Symmetric to the failed-listener test above. Guards against a future
      // copy-paste mistake in start() wiring the wrong handler to `removed`.
      listener.start();
      jobTracker.getContext.mockReturnValue({ channel: { id: 'channel-2' } });

      const removedCall = mockQueueEventsOn.mock.calls.find(c => c[0] === 'removed');
      expect(removedCall).toBeDefined();
      const removedHandler = removedCall![1] as (arg: { jobId: string }) => void;
      removedHandler({ jobId: 'job-removed' });

      await vi.waitFor(() =>
        expect(orderingService.cancelJob).toHaveBeenCalledWith('channel-2', 'job-removed')
      );
    });
  });
});
