/**
 * User-audience memory-fact routes (memory Phase 2 correction slice).
 *
 * The read/curation surface over `memory_facts`: list/get, plus the correction
 * verbs `/memory correct` (PATCH — supersede with a corrected-tier fact),
 * `/memory forget` (DELETE — terminal removal), and lock toggle. All routes
 * require a provisioned user and scope by personality × the caller's persona.
 */

import { z } from 'zod';
import {
  CorrectFactRequestSchema,
  CorrectFactResponseSchema,
  FactListResponseSchema,
  ForgetFactResponseSchema,
  GetFactResponseSchema,
  SetFactLockRequestSchema,
  SetFactLockResponseSchema,
} from '@tzurot/common-types/schemas/api/fact';
import type { RouteDef } from '../types.js';

/** `/fact/:id` is reused by GET / PATCH / DELETE — extracted to satisfy
 *  sonarjs/no-duplicate-string. */
const FACT_BY_ID_PATH = '/fact/:id';

export const userFactRoutes = {
  listFacts: {
    audience: 'user',
    method: 'get',
    path: '/fact/list',
    id: 'listFacts',
    query: {
      personalityId: z.string(),
      limit: z.string().optional(),
      offset: z.string().optional(),
    },
    output: FactListResponseSchema,
    requiresProvisionedUser: true,
    meta: { safeRead: true, softDeleteAware: true },
  },

  getFact: {
    audience: 'user',
    method: 'get',
    path: FACT_BY_ID_PATH,
    id: 'getFact',
    params: { id: z.string() },
    output: GetFactResponseSchema,
    requiresProvisionedUser: true,
    meta: { safeRead: true, softDeleteAware: true },
  },

  correctFact: {
    audience: 'user',
    method: 'patch',
    path: FACT_BY_ID_PATH,
    id: 'correctFact',
    params: { id: z.string() },
    input: CorrectFactRequestSchema,
    output: CorrectFactResponseSchema,
    requiresProvisionedUser: true,
  },

  forgetFact: {
    audience: 'user',
    method: 'delete',
    path: FACT_BY_ID_PATH,
    id: 'forgetFact',
    params: { id: z.string() },
    output: ForgetFactResponseSchema,
    requiresProvisionedUser: true,
  },

  setFactLock: {
    audience: 'user',
    method: 'put',
    path: '/fact/:id/lock',
    id: 'setFactLock',
    params: { id: z.string() },
    input: SetFactLockRequestSchema,
    output: SetFactLockResponseSchema,
    requiresProvisionedUser: true,
    // PUT with explicit { locked } is the idempotency contract — replaying
    // the same body lands the same final state.
    meta: { idempotent: true },
  },
} as const satisfies Record<string, RouteDef>;
