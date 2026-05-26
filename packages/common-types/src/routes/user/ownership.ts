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
import {
  PersonalityCreateSchema,
  PersonalityUpdateSchema,
  CreatePersonalityResponseSchema,
  GetPersonalityResponseSchema,
  ListPersonalitiesResponseSchema,
  DeletePersonalityResponseSchema,
  SetVisibilitySchema,
  PersonaCreateSchema,
  PersonaUpdateSchema,
  CreatePersonaResponseSchema,
  UpdatePersonaResponseSchema,
  DeletePersonaResponseSchema,
  GetPersonaResponseSchema,
  ListPersonasResponseSchema,
  SetDefaultPersonaResponseSchema,
  SetPersonaOverrideSchema,
  SetOverrideResponseSchema,
  ClearOverrideResponseSchema,
  OverrideInfoResponseSchema,
  ListPersonaOverridesResponseSchema,
} from '../../schemas/api/index.js';
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
  },

  getPersonality: {
    audience: 'user',
    method: 'get',
    path: PERSONALITY_DETAIL_PATH,
    id: 'getPersonality',
    params: { slug: z.string() },
    output: GetPersonalityResponseSchema,
    requiresProvisionedUser: true,
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
  },

  getPersona: {
    audience: 'user',
    method: 'get',
    path: PERSONA_DETAIL_PATH,
    id: 'getPersona',
    params: { id: z.string() },
    output: GetPersonaResponseSchema,
    requiresProvisionedUser: true,
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
  },

  getPersonaOverride: {
    audience: 'user',
    method: 'get',
    path: PERSONA_OVERRIDE_DETAIL_PATH,
    id: 'getPersonaOverride',
    params: { personalitySlug: z.string() },
    output: OverrideInfoResponseSchema,
    requiresProvisionedUser: true,
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
} as const satisfies Record<string, RouteDef>;
