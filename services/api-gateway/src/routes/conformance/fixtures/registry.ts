/**
 * Conformance registry: one entry per manifest route.
 *
 * Merges the per-family fixture records into a single map keyed by route id.
 * Completeness is enforced by `registry.test.ts` (exact key match against
 * ROUTE_MANIFEST) — a new manifest route fails the suite until it gets a
 * fixture or a justified skip here. That gate is what makes the
 * handler/contract-drift class of production bug structurally impossible
 * to reintroduce silently.
 */

import type { ConformanceEntry } from './types.js';
import { userAccountFixtures } from './userAccount.js';
import { userFeedbackFixtures } from './userFeedback.js';
import { adminFixtures } from './admin.js';
import { internalFixtures } from './internal.js';
import { userConfigFixtures } from './userConfigs.js';
import { userConfigOverrideFixtures } from './userConfigOverrides.js';
import { userMemoryFixtures } from './userMemory.js';
import { userFactFixtures } from './userFacts.js';
import { userOwnershipFixtures } from './userOwnership.js';
import { userResourceFixtures } from './userResources.js';
import { userDiagnosticFixtures, userShapesFixtures } from './userShapesAndDiagnostics.js';

export const CONFORMANCE_REGISTRY: Record<string, ConformanceEntry> = {
  ...userAccountFixtures,
  ...userFeedbackFixtures,
  ...internalFixtures,
  ...adminFixtures,
  ...userOwnershipFixtures,
  ...userResourceFixtures,
  ...userConfigFixtures,
  ...userConfigOverrideFixtures,
  ...userMemoryFixtures,
  ...userFactFixtures,
  ...userShapesFixtures,
  ...userDiagnosticFixtures,
};
