/**
 * Conformance-harness app builder.
 *
 * Builds the REAL gateway surface — the codegen-generated mounts with the
 * real audience middleware — over a PGLite-backed Prisma client, so the
 * conformance runner can replay every manifest route end-to-end and parse
 * the actual wire response through the route's declared `output` schema.
 *
 * Nothing auth-related is mocked: `requireUserAuth` reads `X-User-Id`,
 * `requireOwnerAuth` compares against `BOT_OWNER_ID` (set to the test actor
 * below), and `requireProvisionedUser` provisions the actor against PGLite
 * via the same `UserService` path production uses.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import { resetConfig } from '@tzurot/common-types/config/config';
import { PrismaClient } from '@tzurot/common-types/services/prisma';
import {
  CacheInvalidationService,
  DenylistCacheInvalidationService,
} from '@tzurot/cache-invalidation';
import type { PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import {
  createTestPGlite,
  loadPGliteSchema,
  setupTestEnvironment,
  type TestEnvironment,
} from '@tzurot/test-utils';

import { mountAdminRoutes, mountInternalRoutes, mountUserRoutes } from '../../_generated/mounts.js';
import { getOrCreateUserService } from '../../../services/AuthMiddleware.js';
import { ConversationRetentionService } from '@tzurot/conversation-history';
import { initializeDeduplicationCache } from '../../../utils/deduplicationCache.js';
import type { RouteDeps } from '../../routeDeps.js';
import { ConfigCascadeResolver, LlmConfigResolver } from '@tzurot/config-resolver';
import type { HarnessMethod, SeedContext } from './types.js';

/** Discord snowflake of the harness actor. Max 20 chars (varchar(20)). */
export const ACTOR_DISCORD_ID = '90000000000000000001';
const ACTOR_USERNAME = 'conformance-tester';
const ACTOR_DISPLAY_NAME = 'Conformance Tester';

/**
 * The headers bot-client sends on every user-audience request. The same
 * actor doubles as the bot owner (BOT_OWNER_ID is set to it below), so
 * admin-audience routes authenticate with the identical header set.
 */
export function authHeaders(): Record<string, string> {
  return {
    'X-User-Id': ACTOR_DISCORD_ID,
    'X-User-Username': encodeURIComponent(ACTOR_USERNAME),
    'X-User-DisplayName': encodeURIComponent(ACTOR_DISPLAY_NAME),
  };
}

/**
 * Canned model returned by the harness's fake `modelCache` (see deps below).
 * Shaped as a `ModelAutocompleteOption`; cast at the use site to avoid coupling
 * the harness to that import.
 */
const CONFORMANCE_SAMPLE_MODEL = {
  id: 'anthropic/claude-sonnet-4',
  name: 'Claude Sonnet 4',
  contextLength: 200_000,
  supportsVision: true,
  supportsImageGeneration: false,
  supportsAudioInput: false,
  supportsAudioOutput: false,
  promptPricePerMillion: 3,
  completionPricePerMillion: 15,
};

export interface ConformanceHarness {
  app: Express;
  ctx: SeedContext;
  deps: RouteDeps;
  cleanup: () => Promise<void>;
}

export async function buildConformanceHarness(): Promise<ConformanceHarness> {
  // The actor is also the bot owner so admin routes pass requireOwnerAuth.
  // Must land before any getConfig() consumer runs in this worker.
  process.env.BOT_OWNER_ID = ACTOR_DISCORD_ID;
  // Wallet routes encrypt BYOK keys locally (AES-256-GCM) — any 32-byte hex
  // key lets the real encryption path run.
  process.env.API_KEY_ENCRYPTION_KEY ??= '0'.repeat(64);
  resetConfig();

  const testEnv: TestEnvironment = await setupTestEnvironment();

  const pglite: PGlite = createTestPGlite();
  await pglite.exec(loadPGliteSchema());
  const adapter = new PrismaPGlite(pglite);
  const prisma = new PrismaClient({ adapter }) as PrismaClient;

  // Minimal BullMQ stand-in: enqueue handlers (shapes import/export start,
  // aiTranscribe) read back the returned job id, and aiJobStatus introspects
  // a job via getJob — the queue itself is exercised by the worker suites,
  // not here.
  const fakeQueue = {
    add: (name: string, data: unknown, opts?: unknown) =>
      Promise.resolve({ id: 'conformance-job-1', name, data, opts }),
    getJob: (id: string) =>
      Promise.resolve({
        id,
        getState: () => Promise.resolve('completed'),
        progress: 100,
        returnvalue: { content: 'conformance result' },
      }),
  } as unknown as NonNullable<RouteDeps['aiQueue']>;

  // Only the `?wait=true` transcription branch listens on queue events; the
  // conformance fixture uses the async branch, so listeners are inert.
  const inertListener = (): void => undefined;
  const fakeQueueEvents = {
    on: inertListener,
    off: inertListener,
    once: inertListener,
  } as unknown as NonNullable<RouteDeps['queueEvents']>;

  const deps: RouteDeps = {
    prisma,
    redis: testEnv.redis,
    aiQueue: fakeQueue,
    // The broadcast enqueue only calls queue.add — same stand-in works.
    releaseBroadcastQueue: fakeQueue,
    queueEvents: fakeQueueEvents,
    // Real resolvers over PGLite — required deps since the detached-resolver
    // cleanup; enableCleanup off (no timers in tests).
    cascadeResolver: new ConfigCascadeResolver(prisma, { enableCleanup: false }),
    llmConfigResolver: new LlmConfigResolver(prisma, { enableCleanup: false }),
    // Real invalidation/retention services over the mock Redis/PGLite — the
    // publish path is all the route handlers exercise. The PersonalityService
    // arg feeds only the subscribe side, which the harness never starts.
    denylistInvalidation: new DenylistCacheInvalidationService(testEnv.redis),
    cacheInvalidationService: new CacheInvalidationService(
      testEnv.redis,
      undefined as unknown as ConstructorParameters<typeof CacheInvalidationService>[1]
    ),
    retentionService: new ConversationRetentionService(prisma),
    // Fake model cache: OpenRouterModelCache wraps Redis + live OpenRouter HTTP,
    // neither of which the PGLite harness has. A canned model lets the getModels
    // fixture validate the output schema AND keeps the llm-config handlers'
    // getModelById enrichment path working (it previously no-op'd because
    // modelCache was absent; now it resolves to a valid model). Implement every
    // method handlers call (getFilteredModels, getModelById) so a partial fake
    // can't silently bypass a `if (modelCache)` guard elsewhere.
    modelCache: {
      getFilteredModels: () => Promise.resolve([CONFORMANCE_SAMPLE_MODEL]),
      getModelById: () => Promise.resolve(CONFORMANCE_SAMPLE_MODEL),
    } as unknown as RouteDeps['modelCache'],
  };

  // aiGenerate's dedup check runs through the real RedisDeduplicationCache
  // over the mock Redis. Module-level singleton, so initialize once.
  initializeDeduplicationCache(testEnv.redis);

  const app = express();
  app.use(express.json({ limit: '10mb' }));
  mountInternalRoutes(app, deps);
  mountAdminRoutes(app, deps);
  mountUserRoutes(app, deps);

  // Pre-provision the actor so seeds know its internal UUIDs up front.
  // Subsequent requests hit the UserService cache / existing row.
  const provisioned = await getOrCreateUserService(prisma).getOrCreateUser(
    ACTOR_DISCORD_ID,
    ACTOR_USERNAME,
    ACTOR_DISPLAY_NAME
  );
  if (provisioned === null) {
    throw new Error('Conformance harness: actor provisioning returned null');
  }

  const call = async (method: HarnessMethod, url: string, body?: unknown): Promise<unknown> => {
    let req = request(app)[method](url).set(authHeaders());
    if (body !== undefined) {
      // Fixture bodies are always JSON objects; supertest's signature just
      // can't see that through `unknown`.
      req = req.send(body as object);
    }
    const res = await req;
    if (res.status < 200 || res.status >= 300) {
      throw new Error(
        `Seed call ${method.toUpperCase()} ${url} failed with ${res.status}: ${JSON.stringify(res.body)}`
      );
    }
    return res.body as unknown;
  };

  const ctx: SeedContext = {
    prisma,
    actorDiscordId: ACTOR_DISCORD_ID,
    actorUserId: provisioned.userId,
    actorPersonaId: provisioned.defaultPersonaId,
    call,
  };

  return {
    app,
    ctx,
    deps,
    cleanup: async () => {
      await prisma.$disconnect();
      await pglite.close();
      await testEnv.cleanup();
    },
  };
}
