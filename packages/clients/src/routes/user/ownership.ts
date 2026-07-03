/**
 * User-audience ownership routes.
 *
 * CRUD on user-owned entities: personalities, personas, and per-personality
 * persona pinning (persona override). All routes require a provisioned user.
 *
 * Split out of resources.ts purely as a max-lines / file-organization concern.
 * Mounted at `/api/user/*` after the route-prefix cutover.
 */

import { z } from 'zod';
import { GATEWAY_TIMEOUTS } from '@tzurot/common-types/constants/discord';
import {
  ClearOverrideResponseSchema,
  CreateOverrideResponseSchema,
  CreatePersonaResponseSchema,
  DeletePersonaResponseSchema,
  GetPersonaResponseSchema,
  ListPersonaOverridesResponseSchema,
  ListPersonasResponseSchema,
  OverrideInfoResponseSchema,
  PersonaCreateSchema,
  PersonaUpdateSchema,
  SetDefaultPersonaResponseSchema,
  SetOverrideResponseSchema,
  SetPersonaOverrideSchema,
  UpdatePersonaResponseSchema,
} from '@tzurot/common-types/schemas/api/persona';
import {
  CreatePersonalityResponseSchema,
  DeletePersonalityResponseSchema,
  GetPersonalityResponseSchema,
  ListPersonalitiesResponseSchema,
  PersonalityCreateSchema,
  PersonalityUpdateSchema,
  SetVisibilitySchema,
} from '@tzurot/common-types/schemas/api/personality';
import type { RouteDef } from '../types.js';

const PERSONALITY_DETAIL_PATH = '/personality/:slug';
const PERSONA_DETAIL_PATH = '/persona/:id';
const PERSONA_OVERRIDE_DETAIL_PATH = '/persona/override/:personalitySlug';

export const userOwnershipRoutes = {
  // ============================================================================
  // Personality CRUD (user owns their own personalities)
  // ============================================================================

  listPersonalities: {
    audience: 'user',
    method: 'get',
    path: '/personality',
    id: 'listPersonalities',
    output: ListPersonalitiesResponseSchema,
    requiresProvisionedUser: true,
    meta: { safeRead: true },
    // DEFERRED budget: dual-context like listPersonas/listShapes — the
    // character browse path (fetchAllCharacters) reads it post-defer and can
    // list many characters; the autocomplete caller self-caps at Discord's 3s
    // deadline regardless of this value.
    timeoutMs: GATEWAY_TIMEOUTS.DEFERRED,
  },

  getPersonality: {
    audience: 'user',
    method: 'get',
    path: PERSONALITY_DETAIL_PATH,
    id: 'getPersonality',
    params: { slug: z.string() },
    output: GetPersonalityResponseSchema,
    requiresProvisionedUser: true,
    meta: { safeRead: true },
    // Called as the first leg of settings/overrides dashboards (alongside
    // resolveCascade/resolvePersonalityCascade) post-defer. The 2500ms
    // autocomplete-budget default can time out under slow-DB conditions
    // before the cascade is even attempted; match the cascade routes.
    timeoutMs: GATEWAY_TIMEOUTS.DEFERRED,
  },

  createPersonality: {
    audience: 'user',
    method: 'post',
    path: '/personality',
    id: 'createPersonality',
    input: PersonalityCreateSchema,
    output: CreatePersonalityResponseSchema,
    requiresProvisionedUser: true,
  },

  updatePersonality: {
    audience: 'user',
    method: 'put',
    path: PERSONALITY_DETAIL_PATH,
    id: 'updatePersonality',
    params: { slug: z.string() },
    input: PersonalityUpdateSchema,
    output: GetPersonalityResponseSchema,
    requiresProvisionedUser: true,
    meta: { idempotent: true },
  },

  setPersonalityVisibility: {
    audience: 'user',
    method: 'patch',
    path: '/personality/:slug/visibility',
    id: 'setPersonalityVisibility',
    params: { slug: z.string() },
    input: SetVisibilitySchema,
    output: GetPersonalityResponseSchema,
    requiresProvisionedUser: true,
  },

  deletePersonality: {
    audience: 'user',
    method: 'delete',
    path: PERSONALITY_DETAIL_PATH,
    id: 'deletePersonality',
    params: { slug: z.string() },
    output: DeletePersonalityResponseSchema,
    requiresProvisionedUser: true,
  },

  // ============================================================================
  // Persona CRUD
  // ============================================================================

  listPersonas: {
    audience: 'user',
    method: 'get',
    path: '/persona',
    id: 'listPersonas',
    output: ListPersonasResponseSchema,
    requiresProvisionedUser: true,
    meta: { safeRead: true },
    // Dual-context route: the browse commands fetch this post-defer and need
    // the longer budget, while autocomplete callers are bounded by Discord's
    // own 3s deadline regardless of this value. DEFERRED serves the slower
    // consumer without endangering the autocomplete path.
    timeoutMs: GATEWAY_TIMEOUTS.DEFERRED,
  },

  getPersona: {
    audience: 'user',
    method: 'get',
    path: PERSONA_DETAIL_PATH,
    id: 'getPersona',
    params: { id: z.string() },
    output: GetPersonaResponseSchema,
    requiresProvisionedUser: true,
    meta: { safeRead: true },
    // DEFERRED budget: persona CRUD is driven from post-defer
    // dashboards (profile view/edit), not the autocomplete hot path; the
    // 2500ms default is too tight under slow-DB conditions.
    timeoutMs: GATEWAY_TIMEOUTS.DEFERRED,
  },

  createPersona: {
    audience: 'user',
    method: 'post',
    path: '/persona',
    id: 'createPersona',
    input: PersonaCreateSchema,
    output: CreatePersonaResponseSchema,
    requiresProvisionedUser: true,
  },

  updatePersona: {
    audience: 'user',
    method: 'put',
    path: PERSONA_DETAIL_PATH,
    id: 'updatePersona',
    params: { id: z.string() },
    input: PersonaUpdateSchema,
    output: UpdatePersonaResponseSchema,
    requiresProvisionedUser: true,
    meta: { idempotent: true },
  },

  deletePersona: {
    audience: 'user',
    method: 'delete',
    path: PERSONA_DETAIL_PATH,
    id: 'deletePersona',
    params: { id: z.string() },
    output: DeletePersonaResponseSchema,
    requiresProvisionedUser: true,
  },

  setPersonaDefault: {
    audience: 'user',
    method: 'patch',
    path: '/persona/:id/default',
    id: 'setPersonaDefault',
    params: { id: z.string() },
    output: SetDefaultPersonaResponseSchema,
    requiresProvisionedUser: true,
  },

  // ============================================================================
  // Persona override (per-personality persona pinning)
  // ============================================================================

  listPersonaOverrides: {
    audience: 'user',
    method: 'get',
    path: '/persona/override',
    id: 'listPersonaOverrides',
    output: ListPersonaOverridesResponseSchema,
    requiresProvisionedUser: true,
    meta: { safeRead: true },
    // DEFERRED budget: persona-override views are post-defer
    // dashboard reads, not the autocomplete hot path.
    timeoutMs: GATEWAY_TIMEOUTS.DEFERRED,
  },

  getPersonaOverride: {
    audience: 'user',
    method: 'get',
    path: PERSONA_OVERRIDE_DETAIL_PATH,
    id: 'getPersonaOverride',
    params: { personalitySlug: z.string() },
    output: OverrideInfoResponseSchema,
    requiresProvisionedUser: true,
    meta: { safeRead: true },
    // DEFERRED budget: also the create-persona-override pre-flight
    // that resolves the personality; post-defer, not the autocomplete hot path.
    timeoutMs: GATEWAY_TIMEOUTS.DEFERRED,
  },

  setPersonaOverride: {
    audience: 'user',
    method: 'put',
    path: PERSONA_OVERRIDE_DETAIL_PATH,
    id: 'setPersonaOverride',
    params: { personalitySlug: z.string() },
    input: SetPersonaOverrideSchema,
    output: SetOverrideResponseSchema,
    requiresProvisionedUser: true,
    meta: { idempotent: true },
  },

  clearPersonaOverride: {
    audience: 'user',
    method: 'delete',
    path: PERSONA_OVERRIDE_DETAIL_PATH,
    id: 'clearPersonaOverride',
    params: { personalitySlug: z.string() },
    output: ClearOverrideResponseSchema,
    requiresProvisionedUser: true,
  },

  // Create a new persona AND set it as override for a personality in a single
  // transaction. The path uses personality ID (not slug) because this entry
  // point is invoked from the create-persona modal where the personality
  // has already been resolved by the GET /override/:slug pre-flight, and
  // sending the resolved UUID back is cheaper than re-validating the slug.
  // Atomicity is server-side via prisma.$transaction — either both rows
  // land or neither does (no orphaned persona on upsert failure).
  createPersonaOverride: {
    audience: 'user',
    method: 'post',
    path: '/persona/override/by-id/:personalityId',
    id: 'createPersonaOverride',
    params: { personalityId: z.string().uuid() },
    input: PersonaCreateSchema,
    output: CreateOverrideResponseSchema,
    requiresProvisionedUser: true,
  },
} as const satisfies Record<string, RouteDef>;
