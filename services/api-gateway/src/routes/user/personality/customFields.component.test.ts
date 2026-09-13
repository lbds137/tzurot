/**
 * Component test: customFields round-trips through the real USER
 * create/update handlers against real PGLite.
 *
 * Both routes were previously silently dropping `customFields` — the Zod
 * input schemas accepted it, but `buildCreateData`/`buildUpdateData` never
 * forwarded it into the Prisma write. This test drives the REAL handlers
 * (not a mocked Prisma) and reads the stored row back out of the database,
 * so a regression in the forwarding wiring fails here even if the handler's
 * own HTTP response still looks correct.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { Response } from 'express';
import { PrismaClient } from '@tzurot/common-types/services/prisma';
import {
  generateUserUuid,
  generatePersonaUuid,
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
import type { RouteDeps } from '../../routeDeps.js';
import type { ProvisionedRequest } from '../../../types.js';
import { stubRouteResolvers } from '../../../test/shared-route-test-utils.js';

vi.mock('../../../utils/asyncHandler.js', () => ({
  asyncHandler: (fn: (...args: unknown[]) => unknown) => fn,
}));

import { handleCreatePersonality } from './create.js';
import { handleUpdatePersonality } from './update.js';

describe('customFields round-trip (real PGLite)', () => {
  let testEnv: TestEnvironment;
  let pglite: PGlite;
  let prisma: PrismaClient;

  const USER_DISCORD = '33333333333333333333';
  const userId = generateUserUuid(USER_DISCORD);
  const personaId = generatePersonaUuid('cf-user', userId);

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
      personaId,
      discordId: USER_DISCORD,
      username: 'cf-user',
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

  function provisionedReq(
    body: Record<string, unknown>,
    params: Record<string, string> = {}
  ): ProvisionedRequest {
    return {
      body,
      params,
      query: {},
      userId: USER_DISCORD,
      provisionedUserId: userId,
      provisionedDefaultPersonaId: personaId,
    } as unknown as ProvisionedRequest;
  }

  it('create persists customFields', async () => {
    const handler = handleCreatePersonality(deps());
    const req = provisionedReq({
      name: 'CF Character',
      slug: 'cf-character',
      characterInfo: 'Info',
      personalityTraits: 'Traits',
      customFields: { foo: 'bar', nested: { n: 1 } },
    });
    const res = mockRes();

    await handler(req, res, vi.fn());

    expect(res.status).not.toHaveBeenCalledWith(400);
    const stored = await prisma.personality.findUnique({ where: { slug: 'cf-character' } });
    expect(stored?.customFields).toEqual({ foo: 'bar', nested: { n: 1 } });
  });

  it('update persists customFields', async () => {
    await prisma.personality.create({
      data: {
        id: generatePersonalityUuid('cf-update-target'),
        name: 'CF Update Target',
        slug: 'cf-update-target',
        ownerId: userId,
        characterInfo: 'Info',
        personalityTraits: 'Traits',
      },
    });

    const handler = handleUpdatePersonality(deps());
    const req = provisionedReq({ customFields: { a: 1 } }, { slug: 'cf-update-target' });
    const res = mockRes();

    await handler(req, res, vi.fn());

    expect(res.status).not.toHaveBeenCalledWith(400);
    const stored = await prisma.personality.findUnique({ where: { slug: 'cf-update-target' } });
    expect(stored?.customFields).toEqual({ a: 1 });
  });

  it('update with customFields absent leaves the stored bag alone', async () => {
    await prisma.personality.create({
      data: {
        id: generatePersonalityUuid('cf-untouched-target'),
        name: 'CF Untouched Target',
        slug: 'cf-untouched-target',
        ownerId: userId,
        characterInfo: 'Info',
        personalityTraits: 'Traits',
        customFields: { keep: 'me' },
      },
    });

    const handler = handleUpdatePersonality(deps());
    // Changes an unrelated field; omits customFields entirely.
    const req = provisionedReq({ characterInfo: 'Updated info' }, { slug: 'cf-untouched-target' });
    const res = mockRes();

    await handler(req, res, vi.fn());

    expect(res.status).not.toHaveBeenCalledWith(400);
    const stored = await prisma.personality.findUnique({
      where: { slug: 'cf-untouched-target' },
    });
    expect(stored?.characterInfo).toBe('Updated info');
    expect(stored?.customFields).toEqual({ keep: 'me' });
  });

  it('update with customFields: null clears the column to SQL NULL', async () => {
    await prisma.personality.create({
      data: {
        id: generatePersonalityUuid('cf-clear-target'),
        name: 'CF Clear Target',
        slug: 'cf-clear-target',
        ownerId: userId,
        characterInfo: 'Info',
        personalityTraits: 'Traits',
        customFields: { will: 'be-cleared' },
      },
    });

    const handler = handleUpdatePersonality(deps());
    const req = provisionedReq({ customFields: null }, { slug: 'cf-clear-target' });
    const res = mockRes();

    await handler(req, res, vi.fn());

    expect(res.status).not.toHaveBeenCalledWith(400);
    const stored = await prisma.personality.findUnique({ where: { slug: 'cf-clear-target' } });
    expect(stored?.customFields).toBeNull();
  });
});
