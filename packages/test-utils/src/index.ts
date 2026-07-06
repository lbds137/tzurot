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
export { seedUserWithPersona, type SeedUserWithPersonaOptions } from './seed.js';
export { contractFixtureFile, loadContractFixture, stableFixtureJson } from './contractFixtures.js';
export {
  attachmentArb,
  describableReferenceNumbers,
  envelopeContextArb,
  hasDescribableDirectAttachment,
  legacyContextArb,
  rawReferencedMessageArb,
  type ArbAttachment,
  type ArbJobContext,
  type ArbReferencedMessage,
  type AttachmentArbOptions,
} from './jobContextArbitraries.js';
