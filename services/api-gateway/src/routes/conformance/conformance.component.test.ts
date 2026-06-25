/**
 * Manifest-conformance harness.
 *
 * For every route in CONFORMANCE_REGISTRY (gated to full manifest coverage
 * by registry.test.ts), replays the real HTTP request against the real
 * generated mounts over PGLite, then parses the actual wire response body
 * through the route's DECLARED output schema.
 *
 * This is the executable version of the contract the generated typed
 * clients enforce at runtime in production — the class of bug where a
 * handler's success payload drifts from its manifest `output` schema
 * (the beta.127 personality update/visibility prod breakage) fails here
 * before it ships.
 *
 * Routes run sequentially in manifest order within one PGLite instance;
 * fixtures create uniquely-named resources so no cross-route cleanup is
 * needed.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import { ROUTE_MANIFEST } from '@tzurot/clients';

// The memory-search route gates on the module-level embedding singleton,
// which needs the local ONNX model loaded. Force the gate open and let
// `preferTextSearch: true` route the fixture down the REAL text-search
// path — generateEmbedding is never reached.
vi.mock('../../services/EmbeddingService.js', async () => {
  const actual = await vi.importActual<typeof import('../../services/EmbeddingService.js')>(
    '../../services/EmbeddingService.js'
  );
  return {
    ...actual,
    isEmbeddingServiceAvailable: () => true,
  };
});

// aiGenerate's job-chain orchestration goes through the module-level BullMQ
// singletons in queue.js, which open a real Redis connection at import.
// Stub the queue surface; the handler's validation + dedup + response
// shaping (what the conformance contract covers) all still run for real.
vi.mock('../../queue.js', () => ({
  aiQueue: {
    add: vi.fn().mockResolvedValue({ id: 'conformance-flow-job' }),
    getJob: vi.fn().mockResolvedValue(null),
    name: 'conformance-queue',
  },
  flowProducer: {
    add: vi.fn().mockResolvedValue({ job: { id: 'conformance-flow-job' } }),
  },
  queueEvents: { on: vi.fn(), off: vi.fn(), once: vi.fn() },
  closeQueue: vi.fn().mockResolvedValue(undefined),
  checkQueueHealth: vi.fn().mockResolvedValue(true),
}));

import { CONFORMANCE_REGISTRY } from './fixtures/registry.js';
import {
  buildConformanceHarness,
  authHeaders,
  type ConformanceHarness,
} from './fixtures/harness.js';
import { isSkip, type RouteFixture } from './fixtures/types.js';

/** Substitute `:param` tokens; throw if any token has no value. */
function buildPath(template: string, params: Record<string, string>): string {
  const path = template.replace(/:([A-Za-z0-9_]+)/g, (_, name: string) => {
    const value = params[name];
    if (value === undefined) {
      throw new Error(`Fixture is missing a value for :${name} in ${template}`);
    }
    return encodeURIComponent(value);
  });
  return path;
}

describe('manifest conformance — handler responses match declared output schemas', () => {
  let harness: ConformanceHarness;

  beforeAll(async () => {
    harness = await buildConformanceHarness();
  }, 60000);

  afterAll(async () => {
    await harness.cleanup();
  });

  for (const [id, entry] of Object.entries(CONFORMANCE_REGISTRY)) {
    const route = ROUTE_MANIFEST[id as keyof typeof ROUTE_MANIFEST];
    if (route === undefined) {
      // registry.test.ts reports stale entries with a better message;
      // don't generate a test for a route that no longer exists.
      continue;
    }

    if (isSkip(entry)) {
      it.skip(`${id} — SKIPPED: ${entry.skip}`, () => {});
      continue;
    }

    it(`${id} (${route.method.toUpperCase()} /api/${route.audience}${route.path})`, async () => {
      const fixture: RouteFixture = entry;
      const overrides = (await fixture.seed?.(harness.ctx)) ?? {};

      const params = { ...fixture.params, ...overrides.params };
      const body = overrides.body ?? fixture.body;
      const query = { ...fixture.query, ...overrides.query };

      const url = `/api/${route.audience}${buildPath(route.path, params)}`;
      let req = request(harness.app)[route.method](url).set(authHeaders());
      if (Object.keys(query).length > 0) {
        req = req.query(query);
      }
      if (body !== undefined) {
        // Fixture bodies are always JSON objects; supertest's signature just
        // can't see that through `unknown`.
        req = req.send(body as object);
      }
      const res = await req;

      // Success-path gate: the fixture must drive the handler to 2xx —
      // a 4xx/5xx here is a broken fixture (or handler), not a contract pass.
      const statusDetail = `${route.method.toUpperCase()} ${url} → ${res.status}: ${JSON.stringify(res.body)}`;
      if (fixture.status !== undefined) {
        expect(res.status, statusDetail).toBe(fixture.status);
      } else {
        expect(res.status, statusDetail).toBeGreaterThanOrEqual(200);
        expect(res.status, statusDetail).toBeLessThan(300);
      }

      // The contract assertion: the actual wire body parses through the
      // route's declared output schema.
      const parsed = route.output.safeParse(res.body);
      const issues = parsed.success ? '' : JSON.stringify(parsed.error.issues, null, 2);
      expect(
        parsed.success,
        `Response body for ${id} does not satisfy its declared output schema.\n` +
          `Issues:\n${issues}\nBody: ${JSON.stringify(res.body, null, 2)}`
      ).toBe(true);
    });
  }
});
