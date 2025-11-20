/**
 * Create Test Express App
 * Sets up an Express app with api-gateway routes for integration testing
 */

import express, { type Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import { PersonalityService } from '@tzurot/common-types';

// Import route creators - we'll need to mock some dependencies
type AIRouter = ReturnType<typeof import('../../../services/api-gateway/src/routes/ai/index.js').createAIRouter>;
type AdminRouter = ReturnType<typeof import('../../../services/api-gateway/src/routes/admin/index.js').createAdminRouter>;

export interface TestAppDependencies {
  prisma: PrismaClient;
  personalityService: PersonalityService;
  // Add other dependencies as needed
}

/**
 * Create a minimal Express app for testing routes
 * This mirrors the setup in api-gateway/src/index.ts but simplified for testing
 */
export async function createTestApp(deps: TestAppDependencies): Promise<Express> {
  const app = express();

  // Middleware
  app.use(express.json());

  // Import and mount routers dynamically
  const { createAIRouter } = await import('../../../services/api-gateway/src/routes/ai/index.js');
  const { createAdminRouter } = await import('../../../services/api-gateway/src/routes/admin/index.js');

  // Create routers with dependencies
  // Note: Some routes may require additional dependencies (queue, redis, etc.)
  // For now, we'll test what we can with minimal setup
  const aiRouter = createAIRouter({
    personalityService: deps.personalityService,
    queue: null as any, // Mock or skip queue-dependent tests
    deduplicationCache: null as any,
    prisma: deps.prisma,
  });

  const adminRouter = createAdminRouter({
    personalityService: deps.personalityService,
    prisma: deps.prisma,
    cacheInvalidationService: null as any, // Will skip cache-dependent tests
  });

  // Mount routers
  app.use('/ai', aiRouter);
  app.use('/admin', adminRouter);

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  return app;
}
