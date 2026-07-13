/**
 * API Gateway - Main Entry Point
 *
 * Express server that receives HTTP requests and creates BullMQ jobs
 * for the AI worker service to process.
 *
 * Architecture:
 * 1. Receives POST /ai/generate requests from bot-client
 * 2. Validates request and checks for duplicates
 * 3. Creates BullMQ job in Redis queue
 * 4. Returns job ID to caller
 * 5. AI worker service processes job asynchronously
 */

import express, { type Express } from 'express';
import helmet from 'helmet';
import { Redis } from 'ioredis';
import { createRequire } from 'module';
import { getConfig } from '@tzurot/common-types/config/config';
import { MaintenanceFlag } from '@tzurot/common-types/services/MaintenanceFlag';
import { fastPoolConnectionOptions } from '@tzurot/common-types/services/poolConfig';
import {
  createPrismaClient,
  verifyPoolTimeouts,
  type PrismaClient,
} from '@tzurot/common-types/services/prisma';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { registerProcessLifecycle } from '@tzurot/common-types/utils/processLifecycle';
import {
  CacheInvalidationService,
  ApiKeyCacheInvalidationService,
  LlmConfigCacheInvalidationService,
  TtsConfigCacheInvalidationService,
  SttResolverCacheInvalidationService,
  DenylistCacheInvalidationService,
  ConfigCascadeCacheInvalidationService,
  SystemSettingsCacheInvalidationService,
} from '@tzurot/cache-invalidation';
import { SystemSettingsService } from '@tzurot/common-types/services/SystemSettingsService';
import { PersonalityService } from '@tzurot/identity';
import {
  ConfigCascadeResolver,
  LlmConfigResolver,
  VisionConfigResolver,
} from '@tzurot/config-resolver';
import { ConversationRetentionService } from '@tzurot/conversation-history';
import { applyFastPoolDeadConnRetry } from './utils/dbTimeout.js';

// Routes
import { createAIRouter } from './routes/ai/index.js';
import {
  mountInternalRoutes,
  mountAdminRoutes,
  mountUserRoutes,
} from './routes/_generated/mounts.js';
import type { RouteDeps } from './routes/routeDeps.js';
import {
  createHealthRouter,
  createAvatarRouter,
  createExportsRouter,
} from './routes/public/index.js';
import { createMetricsRouter, createVoiceReferenceRouter } from './routes/protected/index.js';

// Middleware
import {
  createCorsMiddleware,
  createMaintenanceMiddleware,
  allowCrossOriginEmbedding,
  notFoundHandler,
  globalErrorHandler,
} from './middleware/index.js';

// Services
import { DatabaseNotificationListener } from './services/DatabaseNotificationListener.js';
import { OpenRouterModelCache } from './services/OpenRouterModelCache.js';
import { requireServiceAuth } from './services/AuthMiddleware.js';
import {
  createRedisPublicRouteRateLimiter,
  createRedisWalletRateLimiter,
  createRedisWalletReadRateLimiter,
} from './utils/RedisRateLimiter.js';
import {
  initializeEmbeddingService,
  shutdownEmbeddingService,
} from './services/EmbeddingService.js';

// Bootstrap
import { seedSystemSettingsIfUnset } from './bootstrap/systemSettingsSeed.js';
import {
  validateByokConfiguration,
  ensureAvatarDirectory,
  validateRequiredEnvVars,
  validateServiceAuthConfig,
} from './bootstrap/index.js';

// Queue
import { aiQueue, queueEvents, closeQueue } from './queue.js';
import { createShutdownHandler } from './shutdownHandler.js';
import {
  initializeDeduplicationCache,
  disposeDeduplicationCache,
} from './utils/deduplicationCache.js';
import { syncAvatars } from './migrations/sync-avatars.js';

// Import pino-http (CommonJS) via require
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- pino-http is CommonJS-only and lacks ESM type definitions. require() returns 'any' type unavoidably.
const pinoHttp = require('pino-http');

const logger = createLogger('api-gateway');
const envConfig = getConfig();

// Track startup time for uptime calculation
const startTime = Date.now();

// ============================================================================
// TYPES
// ============================================================================

/** Result of services initialization */
interface ServicesContext {
  cacheRedis: Redis;
  personalityService: PersonalityService;
  retentionService: ConversationRetentionService;
  cacheInvalidationService: CacheInvalidationService;
  apiKeyCacheInvalidation: ApiKeyCacheInvalidationService;
  llmConfigCacheInvalidation: LlmConfigCacheInvalidationService;
  ttsConfigCacheInvalidation: TtsConfigCacheInvalidationService;
  sttResolverCacheInvalidation: SttResolverCacheInvalidationService;
  denylistInvalidation: DenylistCacheInvalidationService;
  cascadeInvalidation: ConfigCascadeCacheInvalidationService;
  systemSettingsInvalidation: SystemSettingsCacheInvalidationService;
  systemSettings: SystemSettingsService;
  cascadeResolver: ConfigCascadeResolver;
  llmConfigResolver: LlmConfigResolver;
  visionConfigResolver: VisionConfigResolver;
  modelCache: OpenRouterModelCache;
  dbNotificationListener: DatabaseNotificationListener;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Initialize all services required by the gateway
 */
async function initializeServices(prisma: PrismaClient): Promise<ServicesContext> {
  // REDIS_URL is validated in startup.ts, but TypeScript doesn't know that
  if (envConfig.REDIS_URL === undefined) {
    throw new Error('REDIS_URL is required but was not provided');
  }
  const cacheRedis = new Redis(envConfig.REDIS_URL);
  cacheRedis.on('error', err => {
    logger.error({ err }, 'Cache Redis connection error');
  });
  logger.info('Redis client initialized for cache invalidation');

  // Initialize deduplication cache with Redis (enables horizontal scaling)
  initializeDeduplicationCache(cacheRedis);
  logger.info('Request deduplication cache initialized with Redis');

  const personalityService = new PersonalityService(prisma);
  const retentionService = new ConversationRetentionService(prisma);
  const cacheInvalidationService = new CacheInvalidationService(cacheRedis, personalityService);
  await cacheInvalidationService.subscribe();
  logger.info('Subscribed to personality cache invalidation events');

  const apiKeyCacheInvalidation = new ApiKeyCacheInvalidationService(cacheRedis);
  logger.info('API key cache invalidation service initialized');

  const llmConfigCacheInvalidation = new LlmConfigCacheInvalidationService(cacheRedis);
  logger.info('LLM config cache invalidation service initialized');

  const ttsConfigCacheInvalidation = new TtsConfigCacheInvalidationService(cacheRedis);
  logger.info('TTS config cache invalidation service initialized');

  const sttResolverCacheInvalidation = new SttResolverCacheInvalidationService(cacheRedis);
  logger.info('STT resolver cache invalidation service initialized');

  const denylistInvalidation = new DenylistCacheInvalidationService(cacheRedis);
  logger.info('Denylist cache invalidation service initialized');

  const cascadeInvalidation = new ConfigCascadeCacheInvalidationService(cacheRedis);
  logger.info('Config cascade cache invalidation service initialized');

  // Long-lived cascade resolver with pub/sub invalidation — shared by the
  // /user/llm-config/resolve endpoint so bot-client gets fresh overrides
  // immediately after channel/user/personality config changes.
  const cascadeResolver = new ConfigCascadeResolver(prisma);
  await cascadeInvalidation.subscribe(event => {
    if (event.type === 'all' || event.type === 'admin') {
      cascadeResolver.clearCache();
    } else if (event.type === 'user') {
      cascadeResolver.invalidateUserCache(event.discordId);
    } else if (event.type === 'channel') {
      cascadeResolver.invalidateChannelCache(event.channelId);
    } else if (event.type === 'personality') {
      cascadeResolver.invalidatePersonalityCache(event.personalityId);
    }
  });
  logger.info('ConfigCascadeResolver initialized with cache invalidation');

  // Long-lived LLM model-config resolver with pub/sub invalidation. One shared
  // instance, one cache: it resolves {model, visionModel} for the /ai/generate
  // job-chain (so the image-description child job uses the user-cascaded model,
  // not the personality seed — the global paid default) AND backs the
  // /user/llm-config/resolve endpoint. The subscription clears stale entries the
  // moment a user's LLM config changes, closing the cache-TTL window where a job
  // could otherwise be stamped with the pre-change model.
  const llmConfigResolver = new LlmConfigResolver(prisma);
  // Vision slots point at LlmConfig rows in the same table, so they share the SAME
  // cache-invalidation pub/sub as text configs — a preset/config edit must clear the
  // vision resolver's cache (incl. its global-default slot) too.
  const visionConfigResolver = new VisionConfigResolver(prisma);
  await llmConfigCacheInvalidation.subscribe(event => {
    if (event.type === 'user') {
      llmConfigResolver.invalidateUserCache(event.discordId);
      visionConfigResolver.invalidateUserCache(event.discordId);
    } else {
      // 'all' and 'config' aren't user-keyed — a preset edit can touch any
      // cached user (and the free-default entry), so clear the whole cache.
      llmConfigResolver.clearCache();
      visionConfigResolver.clearCache();
    }
  });
  logger.info('LlmConfigResolver + VisionConfigResolver initialized with cache invalidation');

  // System settings: seed absent keys from env (race-safe, never clobbers an
  // explicit admin write), then a cached read service that SELF-SUBSCRIBES to
  // the invalidation channel — the gateway must see its own writes promptly,
  // not after a TTL.
  await seedSystemSettingsIfUnset(prisma);
  const systemSettings = new SystemSettingsService(prisma);
  const systemSettingsInvalidation = new SystemSettingsCacheInvalidationService(cacheRedis);
  await systemSettingsInvalidation.subscribe(() => {
    systemSettings.invalidate();
  });
  await systemSettings.prime();
  logger.info('SystemSettingsService seeded, primed, and subscribed to invalidation');

  const modelCache = new OpenRouterModelCache(cacheRedis);

  // Initialize local embedding service for memory search
  const embeddingReady = await initializeEmbeddingService();
  if (embeddingReady) {
    logger.info('Local embedding service initialized');
  } else {
    logger.warn('Local embedding service unavailable - memory search will use text fallback');
  }

  // DATABASE_URL is validated in startup.ts, but TypeScript doesn't know that
  if (envConfig.DATABASE_URL === undefined) {
    throw new Error('DATABASE_URL is required but was not provided');
  }
  const dbNotificationListener = new DatabaseNotificationListener(
    envConfig.DATABASE_URL,
    cacheInvalidationService
  );
  await dbNotificationListener.start();
  logger.info('Listening for database change notifications');

  return {
    cacheRedis,
    personalityService,
    retentionService,
    cacheInvalidationService,
    apiKeyCacheInvalidation,
    llmConfigCacheInvalidation,
    ttsConfigCacheInvalidation,
    sttResolverCacheInvalidation,
    denylistInvalidation,
    cascadeInvalidation,
    systemSettingsInvalidation,
    systemSettings,
    cascadeResolver,
    llmConfigResolver,
    visionConfigResolver,
    modelCache,
    dbNotificationListener,
  };
}

/**
 * Register all routes on the Express app
 */
function registerRoutes(
  app: Express,
  prisma: PrismaClient,
  fastPrisma: PrismaClient,
  services: ServicesContext
): void {
  const {
    cacheRedis,
    retentionService,
    cacheInvalidationService,
    apiKeyCacheInvalidation,
    llmConfigCacheInvalidation,
    ttsConfigCacheInvalidation,
    sttResolverCacheInvalidation,
    denylistInvalidation,
    cascadeInvalidation,
    systemSettingsInvalidation,
    systemSettings,
    cascadeResolver,
    llmConfigResolver,
    visionConfigResolver,
    modelCache,
  } = services;

  // PUBLIC ROUTES (no authentication required)
  // /health is intentionally exempt from rate limiting — uptime monitors
  // (Railway, external probes) need unconstrained polling access.
  app.use('/health', createHealthRouter(startTime));

  // Maintenance gate — everything EXCEPT /health 503s while the flag is on
  // (health must keep passing or Railway restart-loops the service mid-window).
  // Toggled by `pnpm ops maintenance on|off --env <env>`.
  app.use(createMaintenanceMiddleware(new MaintenanceFlag(cacheRedis)));

  // Budget resolves per request through the system-settings SWR cache, so an
  // admin edit takes effect within the cache TTL — no limiter rebuild, and the
  // Redis window state (in-flight counts) is untouched.
  const publicRateLimiter = createRedisPublicRouteRateLimiter(cacheRedis, () =>
    systemSettings.get('publicRateLimitPerMin')
  );
  logger.info(
    { maxRequestsPerMinute: systemSettings.get('publicRateLimitPerMin') },
    'Public-route rate limiter initialized'
  );

  // Media route that legitimately needs cross-origin embedding (Discord
  // fetches avatars from outside our origin). Opt into CORP cross-origin
  // via the per-route middleware; everything else inherits helmet's
  // same-origin default.
  app.use('/avatars', publicRateLimiter, allowCrossOriginEmbedding, createAvatarRouter(prisma));
  app.use('/exports', publicRateLimiter, createExportsRouter(prisma));

  // PROTECTED ROUTES (require service authentication)
  validateServiceAuthConfig();
  app.use(requireServiceAuth());
  logger.info('Service authentication middleware applied globally');

  // /metrics exposes BullMQ queue depth, completed/failed counts, and uptime.
  // Operational telemetry — no PII, but useful intelligence for an attacker
  // (timing high-load windows, detecting deploys). bot-client uses /health
  // for status checks rather than /metrics, so requiring service auth here
  // is free; a future Prometheus-style scraper would authenticate via
  // INTERNAL_SERVICE_SECRET like everything else in the protected section.
  app.use('/metrics', createMetricsRouter(aiQueue, startTime));
  logger.info('Metrics route registered (service-auth protected)');

  // /voice-references serves audio buffers from `personality.voiceReferenceData`.
  // Sole consumer is ai-worker's voiceReferenceHelper (server-to-server),
  // so the route is service-auth-protected to close the slug-enumeration
  // attack surface. Slugs are predictable, so leaving this anonymous would
  // let an attacker enumerate the voice-clone library — see the route's
  // module docstring for the historical context.
  app.use('/voice-references', createVoiceReferenceRouter(prisma));
  logger.info('Voice references route registered (service-auth protected)');

  app.use(
    '/ai',
    createAIRouter({
      prisma,
      aiQueue,
      queueEvents,
      cascadeResolver,
      llmConfigResolver,
      visionConfigResolver,
    })
  );
  logger.info('AI routes registered');

  // ---- Codegen-mounted /api/{internal,admin,user} routes ------------------
  //
  // The sole bot-client → api-gateway surface. The legacy /admin /user
  // /internal /wallet aggregator mounts were removed once every bot-client
  // callsite migrated to the generated typed clients (which target /api/*).
  //
  // Wallet rate-limiter is path-scoped here so /api/user/wallet/* keeps the
  // Redis rate limiting the legacy /wallet/* mount applied at the router level.

  const routeDeps: RouteDeps = {
    prisma,
    fastPrisma,
    cacheInvalidationService,
    llmConfigCacheInvalidation,
    ttsConfigCacheInvalidation,
    denylistInvalidation,
    cascadeInvalidation,
    sttResolverCacheInvalidation,
    apiKeyCacheInvalidation,
    retentionService,
    cascadeResolver,
    llmConfigResolver,
    visionConfigResolver,
    modelCache,
    systemSettingsInvalidation,
    redis: cacheRedis,
    aiQueue,
    queueEvents,
  };

  // Wallet rate limiting (registered before the codegen mounts so these
  // pass-through limiters run ahead of the handlers). Two layers:
  //   1. A LENIENT baseline on the whole `/api/user/wallet` prefix — keeps the
  //      old blanket's safe-by-default property: any wallet route (incl. ones
  //      added later) is throttled even if nobody updates this block.
  //   2. The STRICT mutation budget layered on top of the sensitive/external
  //      routes (set / test / delete). On a mutation both run in registration
  //      order — lenient (60/min) first, then strict (10/15min) — but strict is
  //      the EFFECTIVE ceiling: mutations hit 10/15min long before the lenient
  //      limit, so they stay tightly capped. The hot read (`GET /wallet/list`,
  //      hit by the /models browser on every interaction) only ever pays the
  //      generous 60/min baseline — browsing can't exhaust the mutation budget
  //      and falsely flip models to "needs a key".
  app.use('/api/user/wallet', createRedisWalletReadRateLimiter(cacheRedis));
  const walletWriteLimiter = createRedisWalletRateLimiter(cacheRedis);
  app.post('/api/user/wallet/set', walletWriteLimiter);
  app.post('/api/user/wallet/test', walletWriteLimiter);
  app.delete('/api/user/wallet/:provider', walletWriteLimiter);
  mountInternalRoutes(app, routeDeps);
  mountAdminRoutes(app, routeDeps);
  mountUserRoutes(app, routeDeps);
  logger.info('Codegen routes mounted at /api/{internal,admin,user}');

  // ERROR HANDLERS (must be last)
  app.use(notFoundHandler);
}

// ============================================================================
// MAIN
// ============================================================================

/**
 * Start the server
 */
async function main(): Promise<void> {
  const config = {
    port: envConfig.API_GATEWAY_PORT,
    env: envConfig.NODE_ENV,
    corsOrigins: envConfig.CORS_ORIGINS,
  };

  logger.info('Starting API Gateway service...');
  logger.info(
    { port: config.port, env: config.env, corsOrigins: config.corsOrigins },
    'Configuration:'
  );

  // Startup validation
  validateByokConfiguration();
  validateRequiredEnvVars();
  await ensureAvatarDirectory();
  await syncAvatars();

  // Create Express app with base middleware
  const app = express();
  // api-gateway owns its PrismaClient (no cross-package singleton). Disposed in
  // the shutdown handler below.
  const { prisma, dispose: disposePrisma } = createPrismaClient();
  await prisma.$connect();
  logger.info('Database connection established');

  // Dedicated fast pool for the latency-sensitive conversation-event persist
  // writes (user/assistant message) — tight, self-labeling DB timeouts so a
  // stuck single-row write fails fast + LOUD instead of hanging silently to
  // bot-client's ~20s write abort. The main pool above is untouched, so legit
  // long ops (pgvector search, Shapes import/export, retention) are exempt by
  // architecture. See poolConfig's fastPoolConnectionOptions.
  const fastCfg = fastPoolConnectionOptions();
  const { prisma: rawFastPrisma, dispose: disposeFastPrisma } = createPrismaClient({
    max: fastCfg.max,
    poolOverrides: fastCfg.poolOverrides,
  });
  await rawFastPrisma.$connect();
  // Boot probe: fail fast if the GUC `options` startup string didn't apply
  // (e.g. a connection pooler stripped it) — otherwise the tight timeouts are
  // silently absent and we revert to the original silent-hang bug. Probe the raw
  // client (a boot check); the routes get the retry-wrapped client below.
  await verifyPoolTimeouts(rawFastPrisma, {
    statementTimeoutMs: fastCfg.statementTimeoutMs,
    lockTimeoutMs: fastCfg.lockTimeoutMs,
  });
  // Every fast-pool op retries once on a dead/stale socket (Railway silently
  // reaps idle conns). Applied at the client boundary — one place, all fast-pool
  // routes covered — instead of hand-wrapping each call site.
  const fastPrisma = applyFastPoolDeadConnRetry(rawFastPrisma);
  logger.info('Fast-pool Prisma client established (conversation-event persists)');

  // Trust one reverse-proxy hop (Railway sits behind a single edge proxy).
  // Used by Express to populate req.protocol / req.hostname / req.secure
  // from forwarded headers, and by access logging via req.ip.
  //
  // Note: the public-route rate limiter does NOT use req.ip — with
  // `trust proxy: 1`, req.ip is the one-in-from-the-right XFF entry, which
  // is spoofable when a client injects an X-Forwarded-For header. The rate
  // limiter parses XFF manually and takes the rightmost entry (Railway's
  // own append) — see `publicRouteKeyGenerator` in RedisRateLimiter.ts.
  app.set('trust proxy', 1);

  // Security headers. Helmet defaults apply globally (CORP = 'same-origin').
  // The two media routes that need cross-origin embedding (/avatars and
  // /voice-references) opt in to a looser CORP per-route below, so the
  // permissive policy doesn't leak onto every other endpoint.
  app.use(helmet());

  // 20MB to accommodate base64-encoded voice reference audio (up to 10MB raw → ~13.3MB base64).
  // Applied globally — acceptable for single-tenant bot. Could be scoped per-route if needed.
  app.use(express.json({ limit: '20mb' }));
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call -- pino-http is imported via CommonJS require() and has 'any' type. Functionally correct, just lacks type definitions.
  app.use(pinoHttp({ logger }));
  app.use(createCorsMiddleware({ origins: config.corsOrigins }));

  // Initialize services and register routes
  const services = await initializeServices(prisma);
  registerRoutes(app, prisma, fastPrisma, services);
  app.use(globalErrorHandler(config.env === 'production'));

  // Start server
  const server = app.listen(config.port, (err?: Error) => {
    if (err !== undefined) {
      logger.error({ err }, 'Failed to start server');
      process.exit(1);
    }
    logger.info({ port: config.port }, 'Server listening');
    logger.info({ url: `http://localhost:${config.port}/health` }, 'Health check URL');
  });

  server.on('error', (err: Error) => {
    logger.error({ err }, 'Server error');
  });

  // Setup graceful shutdown
  // Dispose both DB clients on shutdown (fast pool first, then the main pool).
  const disposeAllPrisma = async (): Promise<void> => {
    await disposeFastPrisma();
    await disposePrisma();
  };
  // 'shutdown' policy: an HTTP service drains connections before exiting.
  // The helper owns the guard, hard-exit backstop, err-key logging, and
  // terminal exit semantics.
  registerProcessLifecycle({
    logger,
    dispose: createShutdownHandler(server, {
      disposeDeduplicationCache,
      stopDbNotificationListener: () => services.dbNotificationListener.stop(),
      unsubscribeCacheInvalidation: () => services.cacheInvalidationService.unsubscribe(),
      unsubscribeCascadeInvalidation: () => services.cascadeInvalidation.unsubscribe(),
      unsubscribeSystemSettingsInvalidation: () =>
        services.systemSettingsInvalidation.unsubscribe(),
      stopCascadeResolverCleanup: () => services.cascadeResolver.stopCleanup(),
      disconnectCacheRedis: () => services.cacheRedis.disconnect(),
      shutdownEmbeddingService,
      closeQueue,
      disposePrisma: disposeAllPrisma,
    }),
    rejectionPolicy: 'shutdown',
  });

  logger.info('API Gateway is fully operational!');
}

// Start the server
main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'Fatal error during startup:');
  process.exit(1);
});
