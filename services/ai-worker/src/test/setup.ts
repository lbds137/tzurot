/**
 * Test setup file - runs before all tests
 *
 * Sets up global test configuration and mocks
 */

import { config } from 'dotenv';
import { resolve } from 'path';

// Load environment variables from .env.test BEFORE any other imports
config({ path: resolve(__dirname, '../../.env.test') });

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
