/**
 * Component test: the ADMIN update-personality handler's customFields
 * write, against real PGLite — the sibling of the user-route round-trip in
 * `../user/personality/customFields.component.test.ts`.
 *
 * The clearing case asserts through raw SQL as well as through Prisma,
 * because Prisma reads a column holding the JSON value `null` back as JS
 * `null` too: `toBeNull()` alone cannot tell SQL NULL from a stored JSON
 * null, and those are different rows. `custom_fields IS NULL` can.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { Request, Response } from 'express';
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

vi.mock('../../utils/asyncHandler.js', () => ({
  asyncHandler: (fn: (...args: unknown[]) => unknown) => fn,
}));

import { handleUpdateGlobalPersonality } from './updatePersonality.js';

describe('admin updatePersonality customFields (real PGLite)', () => {
  let testEnv: TestEnvironment;
  let pglite: PGlite;
  let prisma: PrismaClient;

  const USER_DISCORD = '44444444444444444444';
  const userId = generateUserUuid(USER_DISCORD);

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
      personaId: generatePersonalityUuid('admin-cf-persona'),
      discordId: USER_DISCORD,
      username: 'admin-cf-user',
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

  function adminReq(body: Record<string, unknown>, slug: string): Request {
    return { body, params: { slug }, query: {} } as unknown as Request;
  }

  it('customFields: null clears the column to SQL NULL', async () => {
    await prisma.personality.create({
      data: {
        id: generatePersonalityUuid('admin-cf-clear-target'),
        name: 'Admin CF Clear Target',
        slug: 'admin-cf-clear-target',
        ownerId: userId,
        characterInfo: 'Info',
        personalityTraits: 'Traits',
        customFields: { will: 'be-cleared' },
      },
    });

    const handler = handleUpdateGlobalPersonality(deps());
    const req = adminReq({ customFields: null }, 'admin-cf-clear-target');
    const res = mockRes();

    await handler(req, res, vi.fn());

    const stored = await prisma.personality.findUnique({
      where: { slug: 'admin-cf-clear-target' },
    });
    expect(stored?.customFields).toBeNull();

    // SQL NULL, not a stored JSON null: jsonb_typeof returns NULL for the
    // former and the string 'null' for the latter.
    const raw = await prisma.$queryRaw<{ isNull: boolean; jsonType: string | null }[]>`
      SELECT custom_fields IS NULL AS "isNull", jsonb_typeof(custom_fields) AS "jsonType"
      FROM personalities WHERE slug = 'admin-cf-clear-target'
    `;
    expect(raw[0]?.isNull).toBe(true);
    expect(raw[0]?.jsonType).toBeNull();
  });

  it('customFields absent leaves the stored bag alone', async () => {
    await prisma.personality.create({
      data: {
        id: generatePersonalityUuid('admin-cf-untouched-target'),
        name: 'Admin CF Untouched Target',
        slug: 'admin-cf-untouched-target',
        ownerId: userId,
        characterInfo: 'Info',
        personalityTraits: 'Traits',
        customFields: { keep: 'me' },
      },
    });

    const handler = handleUpdateGlobalPersonality(deps());
    const req = adminReq({ characterInfo: 'Updated info' }, 'admin-cf-untouched-target');
    const res = mockRes();

    await handler(req, res, vi.fn());

    const stored = await prisma.personality.findUnique({
      where: { slug: 'admin-cf-untouched-target' },
    });
    expect(stored?.characterInfo).toBe('Updated info');
    expect(stored?.customFields).toEqual({ keep: 'me' });
  });

  it('an object value is stored as-is', async () => {
    await prisma.personality.create({
      data: {
        id: generatePersonalityUuid('admin-cf-object-target'),
        name: 'Admin CF Object Target',
        slug: 'admin-cf-object-target',
        ownerId: userId,
        characterInfo: 'Info',
        personalityTraits: 'Traits',
      },
    });

    const handler = handleUpdateGlobalPersonality(deps());
    const req = adminReq({ customFields: { a: 1 } }, 'admin-cf-object-target');
    const res = mockRes();

    await handler(req, res, vi.fn());

    const stored = await prisma.personality.findUnique({
      where: { slug: 'admin-cf-object-target' },
    });
    expect(stored?.customFields).toEqual({ a: 1 });
  });
});
