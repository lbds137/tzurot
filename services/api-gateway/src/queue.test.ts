/**
 * Seam tests for the module-scope BullMQ queue configuration
 *
 * queue.ts reads config.REDIS_URL and builds its redisConfig at module scope,
 * then constructs three Queues, a FlowProducer and a QueueEvents with it.
 * These tests pin that the REDIS_URL `/N` pathname suffix reaches the BullMQ
 * connections as `db` (and that a suffix-less URL leaves it undefined, so
 * ioredis applies its own default).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

// vi.hoisted runs before vi.mock factories so the constructor mocks exist when
// bullmq is first imported (else: TDZ error). `function` (not arrow) so
// `new MockCtor(...)` works as a constructor; returning an object replaces the
// default instance. Same shape as JobFailureListener.test.ts's QueueEvents mock.
const { QueueMock, QueueEventsMock, FlowProducerMock } = vi.hoisted(() => {
  const makeCtor = (instanceExtras: () => Record<string, unknown>) =>
    vi.fn(function MockBullMQCtor(name?: unknown, opts?: unknown) {
      return { name, opts, ...instanceExtras() };
    });
  return {
    QueueMock: makeCtor(() => ({})),
    QueueEventsMock: makeCtor(() => ({ on: vi.fn() })),
    FlowProducerMock: makeCtor(() => ({})),
  };
});

vi.mock('bullmq', () => ({
  Queue: QueueMock,
  QueueEvents: QueueEventsMock,
  FlowProducer: FlowProducerMock,
}));

// Mock ioredis so nothing dials a socket. queue.ts only reaches ioredis
// transitively (utils/redis), and only at call time, but both export shapes
// are stubbed so any construction path is inert.
vi.mock('ioredis', () => {
  const MockRedis = vi.fn(function MockRedis() {
    return { on: vi.fn() };
  });
  return { default: MockRedis, Redis: MockRedis };
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/** The connection opts bag of the first Queue constructed for `queueName`. */
function firstQueueConnection(queueName: string): Record<string, unknown> {
  const call = QueueMock.mock.calls.find(c => c[0] === queueName);
  expect(call).toBeDefined();
  const opts = call![1] as { connection?: Record<string, unknown> };
  expect(opts.connection).toBeDefined();
  return opts.connection!;
}

describe('queue module-scope BullMQ connection', () => {
  it('carries db 1 from a /1 REDIS_URL into the AI queue and QueueEvents connections', async () => {
    vi.resetModules();
    QueueMock.mockClear();
    QueueEventsMock.mockClear();
    // .env.test (loaded by src/test/setup.ts) carries a suffix-less REDIS_URL;
    // stub the /1 variant before the fresh import reads it.
    vi.stubEnv('REDIS_URL', 'redis://127.0.0.1:6379/1');
    vi.stubEnv('QUEUE_NAME', 'ai-requests-seam-test');

    await import('./queue.js');

    const aiConnection = firstQueueConnection('ai-requests-seam-test');
    expect(aiConnection).toEqual(expect.objectContaining({ host: '127.0.0.1', port: 6379, db: 1 }));

    const eventsCall = QueueEventsMock.mock.calls[0];
    expect(eventsCall).toBeDefined();
    const eventsOpts = eventsCall![1] as { connection?: Record<string, unknown> };
    expect(eventsOpts.connection).toEqual(
      expect.objectContaining({ host: '127.0.0.1', port: 6379, db: 1 })
    );
  });

  it('leaves db undefined when REDIS_URL has no pathname suffix', async () => {
    vi.resetModules();
    QueueMock.mockClear();
    vi.stubEnv('REDIS_URL', 'redis://127.0.0.1:6379');
    vi.stubEnv('QUEUE_NAME', 'ai-requests-seam-test');

    await import('./queue.js');

    expect(firstQueueConnection('ai-requests-seam-test').db).toBeUndefined();
  });
});
