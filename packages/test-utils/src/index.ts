/**
 * Test Utilities
 *
 * Shared test infrastructure for Tzurot services:
 * - PGLite schema loading and initialization
 * - Real Redis connection setup on a dedicated test DB
 */

export {
  createTestPGlite,
  loadPGliteSchema,
  setupTestEnvironment,
  type TestEnvironment,
} from './setup-pglite.js';
export { seedUserWithPersona } from './seed.js';
export { contractFixtureFile, loadContractFixture, stableFixtureJson } from './contractFixtures.js';
export {
  describableReferenceNumbers,
  envelopeContextArb,
  hasDescribableDirectAttachment,
} from './jobContextArbitraries.js';
