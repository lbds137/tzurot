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
 */
export const TEST_AUDIT_IMPL_VERSION = 1;
