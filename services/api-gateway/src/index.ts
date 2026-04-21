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
import { Redis } from 'ioredis';
import { createRequire } from 'module';
import {
  createLogger,
  getConfig,
  getPrismaClient,
  PersonalityService,
  CacheInvalidationService,
  ApiKeyCacheInvalidationService,
  LlmConfigCacheInvalidationService,
  DenylistCacheInvalidationService,
  ConfigCascadeCacheInvalidationService,
  ConfigCascadeResolver,
  ConversationRetentionService,
  type PrismaClient,
} from '@tzurot/common-types';

// Routes
import { createAIRouter } from './routes/ai/index.js';
import { createAdminRouter } from './routes/admin/index.js';
import { createWalletRouter } from './routes/wallet/index.js';
import { createUserRouter } from './routes/user/index.js';
import { createModelsRouter } from './routes/models/index.js';
import {
  createHealthRouter,
  createMetricsRouter,
  createAvatarRouter,
  createVoiceReferenceRouter,
  createExportsRouter,
} from './routes/public/index.js';

// Middleware
import { createCorsMiddleware, notFoundHandler, globalErrorHandler } from './middleware/index.js';

// Services
import { DatabaseNotificationListener } from './services/DatabaseNotificationListener.js';
import { OpenRouterModelCache } from './services/OpenRouterModelCache.js';
import { requireServiceAuth } from './services/AuthMiddleware.js';
import { AttachmentStorageService } from './services/AttachmentStorageService.js';
import {
  initializeEmbeddingService,
  shutdownEmbeddingService,
} from './services/EmbeddingService.js';

// Bootstrap
import {
  validateByokConfiguration,
  ensureAvatarDirectory,
  ensureTempAttachmentDirectory,
  validateRequiredEnvVars,
  validateServiceAuthConfig,
} from './bootstrap/index.js';

// Queue
import { aiQueue, queueEvents, closeQueue } from './queue.js';
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
  denylistInvalidation: DenylistCacheInvalidationService;
  cascadeInvalidation: ConfigCascadeCacheInvalidationService;
  cascadeResolver: ConfigCascadeResolver;
  attachmentStorage: AttachmentStorageService;
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

  const attachmentStorage = new AttachmentStorageService({
    gatewayUrl: envConfig.PUBLIC_GATEWAY_URL ?? envConfig.GATEWAY_URL,
  });

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
    denylistInvalidation,
    cascadeInvalidation,
    cascadeResolver,
    attachmentStorage,
    modelCache,
    dbNotificationListener,
  };
}

/**
 * Register all routes on the Express app
 */
function registerRoutes(app: Express, prisma: PrismaClient, services: ServicesContext): void {
  const {
    cacheRedis,
    retentionService,
    cacheInvalidationService,
    apiKeyCacheInvalidation,
    llmConfigCacheInvalidation,
    denylistInvalidation,
    cascadeInvalidation,
    cascadeResolver,
    attachmentStorage,
    modelCache,
  } = services;

  // PUBLIC ROUTES (no authentication required)
  app.use('/health', createHealthRouter(startTime));
  app.use('/metrics', createMetricsRouter(aiQueue, startTime));
  app.use('/avatars', createAvatarRouter(prisma));
  app.use('/voice-references', createVoiceReferenceRouter(prisma));
  app.use('/exports', createExportsRouter(prisma));

  // Serve temporary attachments from Railway volume
  app.use(
    '/temp-attachments',
    express.static('/data/temp-attachments', {
      maxAge: 0,
      etag: false,
      lastModified: false,
      fallthrough: false,
    })
  );

  // PROTECTED ROUTES (require service authentication)
  validateServiceAuthConfig();
  app.use(requireServiceAuth());
  logger.info('Service authentication middleware applied globally');

  app.use('/ai', createAIRouter(prisma, aiQueue, queueEvents, attachmentStorage));
  logger.info('AI routes registered');

  app.use('/wallet', createWalletRouter(prisma, cacheRedis, apiKeyCacheInvalidation));
  logger.info('Wallet routes registered (Redis rate limiting)');

  app.use(
    '/user',
    createUserRouter({
      prisma,
      llmConfigCacheInvalidation,
      cacheInvalidationService,
      redis: cacheRedis,
      modelCache,
      cascadeInvalidation,
      cascadeResolver,
      aiQueue,
    })
  );
  logger.info('User routes registered (with personality cache invalidation, incognito)');

  app.use('/models', createModelsRouter(modelCache));
  logger.info('Models routes registered');

  app.use(
    '/admin',
    createAdminRouter({
      prisma,
      cacheInvalidationService,
      llmConfigCacheInvalidation,
      retentionService,
      modelCache,
      denylistInvalidation,
      cascadeInvalidation,
      redis: cacheRedis,
    })
  );
  logger.info('Admin routes registered');

  // ERROR HANDLERS (must be last)
  app.use(notFoundHandler);
}

/**
 * Create graceful shutdown handler
 */
function createShutdownHandler(
  server: ReturnType<Express['listen']>,
  services: ServicesContext
): () => Promise<void> {
  const {
    cacheRedis,
    cacheInvalidationService,
    cascadeInvalidation,
    cascadeResolver,
    dbNotificationListener,
  } = services;

  return async (): Promise<void> => {
    logger.info('Shutting down gracefully...');

    server.close(() => {
      logger.info('HTTP server closed');
    });

    disposeDeduplicationCache();
    logger.info('Request deduplication cache disposed');

    await dbNotificationListener.stop();
    logger.info('Database notification listener stopped');

    await cacheInvalidationService.unsubscribe();
    await cascadeInvalidation.unsubscribe();
    cascadeResolver.stopCleanup();
    cacheRedis.disconnect();
    logger.info('Cache invalidation services closed');

    await shutdownEmbeddingService();
    logger.info('Embedding service shut down');

    await closeQueue();

    logger.info('Shutdown complete');
    process.exit(0);
  };
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
  await ensureTempAttachmentDirectory();
  await syncAvatars();

  // Create Express app with base middleware
  const app = express();
  const prisma = getPrismaClient();
  await prisma.$connect();
  logger.info('Database connection established');
  // 20MB to accommodate base64-encoded voice reference audio (up to 10MB raw → ~13.3MB base64).
  // Applied globally — acceptable for single-tenant bot. Could be scoped per-route if needed.
  app.use(express.json({ limit: '20mb' }));
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call -- pino-http is imported via CommonJS require() and has 'any' type. Functionally correct, just lacks type definitions.
  app.use(pinoHttp({ logger }));
  app.use(createCorsMiddleware({ origins: config.corsOrigins }));

  // Initialize services and register routes
  const services = await initializeServices(prisma);
  registerRoutes(app, prisma, services);
  app.use(globalErrorHandler(config.env === 'production'));

  // Start server
  const server = app.listen(config.port, (err?: Error) => {
    if (err) {
      logger.error({ err }, 'Failed to start server');
      process.exit(1);
    }
    logger.info(`Server listening on port ${config.port}`);
    logger.info(`Health check: http://localhost:${config.port}/health`);
  });

  server.on('error', (err: Error) => {
    logger.error({ err }, 'Server error');
  });

  // Setup graceful shutdown
  const shutdown = createShutdownHandler(server, services);
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
  process.on('uncaughtException', error => {
    logger.fatal({ err: error }, 'Uncaught exception:');
    void shutdown();
  });
  process.on('unhandledRejection', reason => {
    logger.fatal({ reason }, 'Unhandled rejection:');
    void shutdown();
  });

  logger.info('API Gateway is fully operational!');
}

// Start the server
main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'Fatal error during startup:');
  process.exit(1);
});
