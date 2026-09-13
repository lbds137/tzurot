/**
 * Component test: the ADMIN create-personality handler's customFields
 * write, against real PGLite — the sibling of the update-route round-trip in
 * `./updatePersonality.component.test.ts`.
 *
 * The create route passes `customFields: toNullableJsonInput(validated.customFields)`
 * unconditionally, so an omitted field reaches Prisma as an explicit
 * `undefined`. This pins that such a create still lands the column on
 * SQL NULL, not a stored JSON null — those are different rows, and
 * Prisma reads both back as JS `null`, so `toBeNull()` alone cannot tell them
 * apart. `custom_fields IS NULL` / `jsonb_typeof(custom_fields)` can.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { Response } from 'express';
import { PrismaClient } from '@tzurot/common-types/services/prisma';
import {
  generateUserUuid,
  generatePersonalityUuid,
} from '@tzurot/common-types/utils/deterministicUuid';
import type { PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import {
  createTestPGlite,
  setupTestEnvironment,
  loadPGliteSchema,
  seedUserWithPersona,
  type TestEnvironment,
} from '@tzurot/test-utils';
import type { RouteDeps } from '../routeDeps.js';
import { stubRouteResolvers } from '../../test/shared-route-test-utils.js';
import type { AuthenticatedRequest } from '../../types.js';

vi.mock('../../utils/asyncHandler.js', () => ({
  asyncHandler: (fn: (...args: unknown[]) => unknown) => fn,
}));

import { handleCreateGlobalPersonality } from './createPersonality.js';

describe('admin createPersonality customFields (real PGLite)', () => {
  let testEnv: TestEnvironment;
  let pglite: PGlite;
  let prisma: PrismaClient;

  const ADMIN_DISCORD = '45454545454545454545';
  const userId = generateUserUuid(ADMIN_DISCORD);

  beforeAll(async () => {
    testEnv = await setupTestEnvironment();
    pglite = createTestPGlite();
    await pglite.exec(loadPGliteSchema());
    const adapter = new PrismaPGlite(pglite);
    prisma = new PrismaClient({ adapter }) as PrismaClient;
  }, 30000);

  afterAll(async () => {
    await prisma.$disconnect();
    await pglite.close();
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await prisma.personality.deleteMany({});
    await prisma.user.deleteMany({});
    await seedUserWithPersona(prisma, {
      userId,
      personaId: generatePersonalityUuid('admin-cf-create-persona'),
      discordId: ADMIN_DISCORD,
      username: 'admin-cf-create-user',
    });
  });

  function deps(): RouteDeps {
    return { prisma, ...stubRouteResolvers() };
  }

  function mockRes(): Response {
    return {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as unknown as Response;
  }

  it('customFields absent on create lands the column as SQL NULL', async () => {
    const handler = handleCreateGlobalPersonality(deps());
    const req = {
      body: {
        name: 'Admin CF Create Target',
        slug: 'admin-cf-create-target',
        characterInfo: 'Info',
        personalityTraits: 'Traits',
      },
      params: {},
      query: {},
      userId: ADMIN_DISCORD,
    } as unknown as AuthenticatedRequest;
    const res = mockRes();

    await handler(req, res, vi.fn());

    // A Zod rejection would otherwise make the row-absence look like a pass.
    expect(res.status).not.toHaveBeenCalledWith(400);

    const stored = await prisma.personality.findUnique({
      where: { slug: 'admin-cf-create-target' },
    });
    expect(stored).not.toBeNull();
    expect(stored?.customFields).toBeNull();

    // SQL NULL, not a stored JSON null: jsonb_typeof returns NULL for the
    // former and the string 'null' for the latter.
    const raw = await prisma.$queryRaw<{ isNull: boolean; jsonType: string | null }[]>`
      SELECT custom_fields IS NULL AS "isNull", jsonb_typeof(custom_fields) AS "jsonType"
      FROM personalities WHERE slug = 'admin-cf-create-target'
    `;
    expect(raw[0]?.isNull).toBe(true);
    expect(raw[0]?.jsonType).toBeNull();
  });

  it('customFields: null on create lands the column as SQL NULL', async () => {
    const handler = handleCreateGlobalPersonality(deps());
    const req = {
      body: {
        name: 'Admin CF Create Null Target',
        slug: 'admin-cf-create-null-target',
        characterInfo: 'Info',
        personalityTraits: 'Traits',
        customFields: null,
      },
      params: {},
      query: {},
      userId: ADMIN_DISCORD,
    } as unknown as AuthenticatedRequest;
    const res = mockRes();

    await handler(req, res, vi.fn());

    // A Zod rejection would otherwise make the row-absence look like a pass.
    expect(res.status).not.toHaveBeenCalledWith(400);

    const stored = await prisma.personality.findUnique({
      where: { slug: 'admin-cf-create-null-target' },
    });
    expect(stored).not.toBeNull();
    expect(stored?.customFields).toBeNull();

    // SQL NULL, not a stored JSON null: jsonb_typeof returns NULL for the
    // former and the string 'null' for the latter. An explicit null in the
    // request body must reach toNullableJsonInput the same way an absent
    // field does.
    const raw = await prisma.$queryRaw<{ isNull: boolean; jsonType: string | null }[]>`
      SELECT custom_fields IS NULL AS "isNull", jsonb_typeof(custom_fields) AS "jsonType"
      FROM personalities WHERE slug = 'admin-cf-create-null-target'
    `;
    expect(raw[0]?.isNull).toBe(true);
    expect(raw[0]?.jsonType).toBeNull();
  });
});
