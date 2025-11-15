/**
 * Test setup file - runs before all tests
 *
 * Sets up global test configuration and mocks
 */

// Set minimal env vars BEFORE any imports
process.env.DISCORD_TOKEN = 'test-token';
process.env.GATEWAY_URL = 'http://localhost:3000';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.PROD_DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.NODE_ENV = 'test';

import { beforeAll, afterEach, afterAll, vi } from 'vitest';

beforeAll(() => {
  // Setup that runs once before all tests
});

afterEach(() => {
  // Clear all mocks after each test to prevent test pollution
  vi.clearAllMocks();
});

afterAll(() => {
  // Cleanup that runs once after all tests
});
