/**
 * Tests for JobFailureListener
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JobFailureListener } from './JobFailureListener.js';
import type { MessageHandler } from '../handlers/MessageHandler.js';
import type { JobTracker } from './JobTracker.js';
import type { MultiTagCoordinator } from './MultiTagCoordinator.js';
import { ResponseOrderingService } from './ResponseOrderingService.js';

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
  let orderingService: { handleResult: ReturnType<typeof vi.fn> };
  let multiTagCoordinator: {
    ownsJob: ReturnType<typeof vi.fn>;
    handleJobResult: ReturnType<typeof vi.fn>;
  };
  let messageHandler: { handleJobResult: ReturnType<typeof vi.fn> };
  let listener: JobFailureListener;

  beforeEach(() => {
    vi.clearAllMocks();
    jobTracker = {
      getContext: vi.fn(),
      completeJob: vi.fn(),
    };
    orderingService = {
      // Mirrors ResponseOrderingService.handleResult's unregistered-job
      // semantics: deliver via the passed deliverFn immediately. This keeps
      // the mock simple while still exercising the seam (deliverFn forwards
      // to MessageHandler.handleJobResult).
      handleResult: vi
        .fn()
        .mockImplementation(async (_channelId, jobId, result, _userMessageTime, deliverFn) => {
          await deliverFn(jobId, result);
        }),
    };
    multiTagCoordinator = {
      // Default: jobs are NOT multi-tag (single-tag routing path). Tests for
      // the multi-tag branch override this per-call.
      ownsJob: vi.fn().mockReturnValue(false),
      handleJobResult: vi.fn().mockResolvedValue(undefined),
    };
    messageHandler = {
      handleJobResult: vi.fn().mockResolvedValue(undefined),
    };
    listener = new JobFailureListener(
      jobTracker as unknown as JobTracker,
      orderingService as unknown as ResponseOrderingService,
      multiTagCoordinator as unknown as MultiTagCoordinator,
      messageHandler as unknown as MessageHandler
    );
  });

  describe('handleTerminalEvent — single-tag routing', () => {
    it('routes through orderingService.handleResult with channelId and userMessageTime from JobTracker context on failed', async () => {
      const userMessageTime = new Date('2026-01-01T00:00:00.000Z');
      jobTracker.getContext.mockReturnValue({ channel: { id: 'channel-abc' }, userMessageTime });

      await listener.handleTerminalEvent('failed', 'job-123', 'connection refused');

      expect(multiTagCoordinator.ownsJob).toHaveBeenCalledWith('job-123');
      expect(jobTracker.getContext).toHaveBeenCalledWith('job-123');
      expect(orderingService.handleResult).toHaveBeenCalledWith(
        'channel-abc',
        'job-123',
        { requestId: 'job-123', success: false, error: 'connection refused' },
        userMessageTime,
        expect.any(Function)
      );
      expect(multiTagCoordinator.handleJobResult).not.toHaveBeenCalled();
    });

    it('routes through orderingService.handleResult on removed events', async () => {
      const userMessageTime = new Date('2026-01-02T00:00:00.000Z');
      jobTracker.getContext.mockReturnValue({ channel: { id: 'channel-xyz' }, userMessageTime });

      await listener.handleTerminalEvent('removed', 'job-456');

      expect(orderingService.handleResult).toHaveBeenCalledWith(
        'channel-xyz',
        'job-456',
        expect.objectContaining({ requestId: 'job-456' }),
        userMessageTime,
        expect.any(Function)
      );
    });

    it('no-ops when JobTracker has no context for the jobId', async () => {
      jobTracker.getContext.mockReturnValue(null);

      await listener.handleTerminalEvent('failed', 'unknown-job', 'whatever');

      expect(orderingService.handleResult).not.toHaveBeenCalled();
      expect(multiTagCoordinator.handleJobResult).not.toHaveBeenCalled();
    });

    it('never calls jobTracker.completeJob itself — tracker completion belongs to MessageHandler.handleJobResult', async () => {
      // The listener stays a thin router: it never touches JobTracker's
      // completeJob directly. Tracker completion is MessageHandler.handleJobResult's
      // job (mocked here), which this test pins by asserting the delegation happened.
      jobTracker.getContext.mockReturnValue({
        channel: { id: 'channel-1' },
        userMessageTime: new Date(),
      });

      await listener.handleTerminalEvent('failed', 'job-1');

      expect(orderingService.handleResult).toHaveBeenCalled();
      expect(jobTracker.completeJob).not.toHaveBeenCalled();
      expect(messageHandler.handleJobResult).toHaveBeenCalled();
    });

    it('delivers a synthesized failure through the handleResult deliverFn, which forwards to MessageHandler.handleJobResult, for a slash-kind job', async () => {
      const userMessageTime = new Date('2026-01-03T00:00:00.000Z');
      jobTracker.getContext.mockReturnValue({
        channel: { id: 'channel-slash' },
        userMessageTime,
        kind: 'slash',
      });

      await listener.handleTerminalEvent('failed', 'slash-job-1', 'OpenRouter 502');

      expect(orderingService.handleResult).toHaveBeenCalledWith(
        'channel-slash',
        'slash-job-1',
        { requestId: 'slash-job-1', success: false, error: 'OpenRouter 502' },
        userMessageTime,
        expect.any(Function)
      );
      // The mocked handleResult invokes the captured deliverFn immediately —
      // assert it forwards to MessageHandler.handleJobResult with (jobId, result).
      expect(messageHandler.handleJobResult).toHaveBeenCalledWith('slash-job-1', {
        requestId: 'slash-job-1',
        success: false,
        error: 'OpenRouter 502',
      });
      expect(multiTagCoordinator.handleJobResult).not.toHaveBeenCalled();
    });

    it('delivers a synthesized failure through the handleResult deliverFn for a DM/message-kind job, defaulting the error when failedReason is absent', async () => {
      const userMessageTime = new Date('2026-01-04T00:00:00.000Z');
      jobTracker.getContext.mockReturnValue({
        channel: { id: 'channel-dm' },
        userMessageTime,
        kind: 'message',
      });

      await listener.handleTerminalEvent('removed', 'dm-job-1');

      expect(orderingService.handleResult).toHaveBeenCalledWith(
        'channel-dm',
        'dm-job-1',
        { requestId: 'dm-job-1', success: false, error: 'Job removed (no reason provided)' },
        userMessageTime,
        expect.any(Function)
      );
      expect(messageHandler.handleJobResult).toHaveBeenCalledWith('dm-job-1', {
        requestId: 'dm-job-1',
        success: false,
        error: 'Job removed (no reason provided)',
      });
    });

    it('does not call MessageHandler.handleJobResult when JobTracker has no context for the jobId', async () => {
      jobTracker.getContext.mockReturnValue(null);

      await listener.handleTerminalEvent('failed', 'unknown-job', 'whatever');

      expect(orderingService.handleResult).not.toHaveBeenCalled();
      expect(messageHandler.handleJobResult).not.toHaveBeenCalled();
    });

    it('swallows a rejection from MessageHandler.handleJobResult via the top-level try/catch', async () => {
      // handleTerminalEvent runs under `void` in the QueueEvents wiring, so an
      // escaping rejection here would surface as an unhandledRejection and kill
      // the process (Node 15+). The top-level try/catch must catch this too.
      // Scope of what this pins: the mock awaits deliverFn inline, which
      // mirrors ResponseOrderingService.handleResult's UNREGISTERED-job
      // branch (no try/catch around deliverFn there). The registered-job
      // branch delivers via processQueue, whose own internal catch swallows
      // a deliverFn rejection before it reaches this listener — so that
      // branch cannot produce an unhandled rejection either way.
      jobTracker.getContext.mockReturnValue({
        channel: { id: 'channel-1' },
        userMessageTime: new Date(),
      });
      messageHandler.handleJobResult.mockRejectedValueOnce(new Error('boom'));

      await expect(
        listener.handleTerminalEvent('failed', 'job-1', 'reason')
      ).resolves.toBeUndefined();
    });
  });

  describe('handleTerminalEvent — ordering pin (real ResponseOrderingService)', () => {
    // This is the regression test for the review finding: the single-tag path
    // previously called orderingService.cancelJob() (which unblocks buffered
    // siblings and flushes them) and THEN delivered the failure notice
    // directly via MessageHandler.handleJobResult — landing the failure
    // notice AFTER any siblings it had just unblocked, inverting delivery
    // order. Routing the failure through handleResult like every other
    // delivery path keeps it in userMessageTime order.
    it('delivers an older job A failure notice before a newer job B result buffered behind it', async () => {
      const realOrdering = new ResponseOrderingService(false);
      const deliveryOrder: string[] = [];

      const jobTrackerReal = { getContext: vi.fn(), completeJob: vi.fn() };
      const multiTagCoordinatorReal = {
        ownsJob: vi.fn().mockReturnValue(false),
        handleJobResult: vi.fn(),
      };
      const messageHandlerReal = {
        handleJobResult: vi.fn().mockImplementation((jobId: string) => {
          deliveryOrder.push(jobId);
          return Promise.resolve();
        }),
      };
      const realListener = new JobFailureListener(
        jobTrackerReal as unknown as JobTracker,
        realOrdering,
        multiTagCoordinatorReal as unknown as MultiTagCoordinator,
        messageHandlerReal as unknown as MessageHandler
      );

      const channelId = 'channel-real';
      const olderTime = new Date('2026-01-01T00:00:00.000Z'); // job A — older
      const newerTime = new Date('2026-01-01T00:00:05.000Z'); // job B — newer

      // Register both jobs with the ordering service (as JobTracker.trackJob does).
      realOrdering.registerJob(channelId, 'job-A', olderTime);
      realOrdering.registerJob(channelId, 'job-B', newerTime);

      // Job B's soft result arrives first and buffers behind job A (older,
      // still pending) — mirrors index.ts's startResultsListener call shape.
      const deliverB = vi.fn().mockImplementation((jobId: string) => {
        deliveryOrder.push(jobId);
        return Promise.resolve();
      });
      await realOrdering.handleResult(
        channelId,
        'job-B',
        { requestId: 'job-B', success: true, content: 'B result' },
        newerTime,
        deliverB
      );
      expect(deliveryOrder).toEqual([]); // still buffered — blocked on job A

      // Job A hard-fails. JobFailureListener must route this through
      // orderingService.handleResult (not cancelJob) so A's failure notice
      // is delivered before B's buffered result flushes.
      jobTrackerReal.getContext.mockReturnValue({
        channel: { id: channelId },
        userMessageTime: olderTime,
      });
      await realListener.handleTerminalEvent('failed', 'job-A', 'OpenRouter 502');

      expect(deliveryOrder).toEqual(['job-A', 'job-B']);
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
      expect(orderingService.handleResult).not.toHaveBeenCalled();
    });

    it('does not call MessageHandler.handleJobResult when the coordinator owns the job — the coordinator owns delivery', async () => {
      multiTagCoordinator.ownsJob.mockReturnValue(true);

      await listener.handleTerminalEvent('failed', 'multitag-job-1', 'OpenRouter 502');

      expect(messageHandler.handleJobResult).not.toHaveBeenCalled();
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
      expect(orderingService.handleResult).not.toHaveBeenCalled();
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
      jobTracker.getContext.mockReturnValue({
        channel: { id: 'channel-1' },
        userMessageTime: new Date(),
      });

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
      // future awaits added before the handleResult call. A single `Promise.resolve`
      // tick would pass today but silently break if an earlier await is added.
      await vi.waitFor(() =>
        expect(orderingService.handleResult).toHaveBeenCalledWith(
          'channel-1',
          'job-from-event',
          expect.objectContaining({ requestId: 'job-from-event' }),
          expect.any(Date),
          expect.any(Function)
        )
      );
    });

    it('removed listener calls handleTerminalEvent with the jobId', async () => {
      // Symmetric to the failed-listener test above. Guards against a future
      // copy-paste mistake in start() wiring the wrong handler to `removed`.
      listener.start();
      jobTracker.getContext.mockReturnValue({
        channel: { id: 'channel-2' },
        userMessageTime: new Date(),
      });

      const removedCall = mockQueueEventsOn.mock.calls.find(c => c[0] === 'removed');
      expect(removedCall).toBeDefined();
      const removedHandler = removedCall![1] as (arg: { jobId: string }) => void;
      removedHandler({ jobId: 'job-removed' });

      await vi.waitFor(() =>
        expect(orderingService.handleResult).toHaveBeenCalledWith(
          'channel-2',
          'job-removed',
          expect.objectContaining({ requestId: 'job-removed' }),
          expect.any(Date),
          expect.any(Function)
        )
      );
    });
  });
});
