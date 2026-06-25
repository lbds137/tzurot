/**
 * Test-audit version constants — extracted to a fs-free module so the
 * test suite can statically import them without pulling in `node:fs`
 * (which `audit-utils.ts` imports at the top, ahead of the vi.mock
 * hoisting in tests).
 *
 * Bump these when the measurement-affecting logic changes. The
 * `getTestAuditConfigFingerprint` helper in `audit-utils.ts` hashes
 * the constant into the baseline meta `configHash`, so a bump
 * invalidates existing baselines and forces an explicit refresh
 * via `test:audit --update`.
 *
 * History:
 *   v1 — initial (Prisma auto-detection + `*.service.ts` glob +
 *        Zod schema enumeration).
 *   v2 — PRISMA_PATTERNS: replaced the dead `getPrismaClient(` matcher
 *        (deleted in the singleton eviction) with `createPrismaClient(`,
 *        the post-eviction Prisma entry point.
 *   v3 — serviceDirs: added `packages/identity` + `packages/conversation-history`
 *        (Prisma-service packages extracted into standalone packages, previously
 *        outside the scan scope) so their component-test coverage is ratcheted.
 */
export const TEST_AUDIT_IMPL_VERSION = 3;
