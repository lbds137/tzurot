/**
 * Test Utilities
 *
 * Shared test infrastructure for Tzurot services:
 * - PGLite schema loading and initialization
 * - Redis mock for integration tests
 * - CI environment detection
 */

export {
  isCI,
  loadPGliteSchema,
  initializePGliteSchema,
  setupTestEnvironment,
  type TestEnvironment,
} from './setup-pglite.js';

export { createRedisClientMock, RedisClientMock } from './RedisClientMock.js';
