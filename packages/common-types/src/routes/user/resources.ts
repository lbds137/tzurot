/**
 * User-audience resource routes.
 *
 * Covers personality + persona ownership, channel activation, wallet
 * (BYOK key management), voice resolution, and the diagnostic GETs
 * lifted from /admin per the route-prefix cutover.
 *
 * Most routes here require provisioning. The diagnostic GETs are the
 * exception — they accept a `subject` query param (bot owner only;
 * server filters to caller for non-owners), and the subject's user
 * row may not be provisioned.
 */

import { z } from 'zod';
import {
  // Personality (user-owned)
  PersonalityCreateSchema,
  PersonalityUpdateSchema,
  CreatePersonalityResponseSchema,
  GetPersonalityResponseSchema,
  ListPersonalitiesResponseSchema,
  DeletePersonalityResponseSchema,
  SetVisibilitySchema,
  // Persona
  PersonaCreateSchema,
  PersonaUpdateSchema,
  CreatePersonaResponseSchema,
  UpdatePersonaResponseSchema,
  DeletePersonaResponseSchema,
  GetPersonaResponseSchema,
  ListPersonasResponseSchema,
  SetDefaultPersonaResponseSchema,
  // Persona override
  SetPersonaOverrideSchema,
  SetOverrideResponseSchema,
  ClearOverrideResponseSchema,
  OverrideInfoResponseSchema,
  // Channel activation
  ActivateChannelRequestSchema,
  DeactivateChannelRequestSchema,
  ActivateChannelResponseSchema,
  DeactivateChannelResponseSchema,
  ListChannelActivationsResponseSchema,
  GetChannelActivationResponseSchema,
  UpdateChannelGuildResponseSchema,
  ChannelSettingsSchema,
  // Wallet
  ListWalletKeysResponseSchema,
  RemoveWalletKeyResponseSchema,
  SetWalletKeySchema,
  SetWalletKeyResponseSchema,
  TestWalletKeySchema,
  TestWalletKeyResponseSchema,
  // Voice resolution
  GetVoiceResolutionResponseSchema,
  // Usage
  UsageStatsSchema,
  // Diagnostic GETs (lifted from /admin in the route-prefix cutover)
  DiagnosticLogResponseSchema,
  DiagnosticLogsResponseSchema,
  RecentDiagnosticLogsResponseSchema,
} from '../../schemas/api/index.js';
import type { RouteDef } from '../types.js';

// Shared CRUD-detail path constants
const PERSONALITY_DETAIL_PATH = '/personality/:slug';
const PERSONA_DETAIL_PATH = '/persona/:id';
const PERSONA_OVERRIDE_DETAIL_PATH = '/persona/override/:personalitySlug';

export const userResourceRoutes = {
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
    output: OverrideInfoResponseSchema,
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

  // ============================================================================
  // Channel activation
  // ============================================================================

  activateChannel: {
    audience: 'user',
    method: 'post',
    path: '/channel/activate',
    id: 'activateChannel',
    input: ActivateChannelRequestSchema,
    output: ActivateChannelResponseSchema,
    requiresProvisionedUser: true,
  },

  deactivateChannel: {
    audience: 'user',
    method: 'delete',
    path: '/channel/deactivate',
    id: 'deactivateChannel',
    input: DeactivateChannelRequestSchema,
    output: DeactivateChannelResponseSchema,
    requiresProvisionedUser: true,
  },

  listUserChannels: {
    audience: 'user',
    method: 'get',
    path: '/channel/list',
    id: 'listUserChannels',
    output: ListChannelActivationsResponseSchema,
    requiresProvisionedUser: true,
  },

  getUserChannel: {
    audience: 'user',
    method: 'get',
    path: '/channel/:channelId',
    id: 'getUserChannel',
    params: { channelId: z.string() },
    output: GetChannelActivationResponseSchema,
    requiresProvisionedUser: true,
  },

  updateChannelGuild: {
    audience: 'user',
    method: 'patch',
    path: '/channel/update-guild',
    id: 'updateChannelGuild',
    output: UpdateChannelGuildResponseSchema,
    requiresProvisionedUser: true,
  },

  getChannelConfigOverrides: {
    audience: 'user',
    method: 'get',
    path: '/channel/:channelId/config-overrides',
    id: 'getChannelConfigOverrides',
    params: { channelId: z.string() },
    output: ChannelSettingsSchema,
    requiresProvisionedUser: true,
  },

  // ============================================================================
  // Usage stats (per-user token usage)
  // ============================================================================

  getUserUsage: {
    audience: 'user',
    method: 'get',
    path: '/usage',
    id: 'getUserUsage',
    output: UsageStatsSchema,
    requiresProvisionedUser: true,
  },

  // ============================================================================
  // Wallet (BYOK key management)
  // ============================================================================

  listWalletKeys: {
    audience: 'user',
    method: 'get',
    path: '/wallet/list',
    id: 'listWalletKeys',
    output: ListWalletKeysResponseSchema,
    requiresProvisionedUser: true,
  },

  setWalletKey: {
    audience: 'user',
    method: 'post',
    path: '/wallet',
    id: 'setWalletKey',
    input: SetWalletKeySchema,
    output: SetWalletKeyResponseSchema,
    requiresProvisionedUser: true,
  },

  removeWalletKey: {
    audience: 'user',
    method: 'delete',
    path: '/wallet/:provider',
    id: 'removeWalletKey',
    params: { provider: z.string() },
    output: RemoveWalletKeyResponseSchema,
    requiresProvisionedUser: true,
  },

  testWalletKey: {
    audience: 'user',
    method: 'post',
    path: '/wallet/test',
    id: 'testWalletKey',
    input: TestWalletKeySchema,
    output: TestWalletKeyResponseSchema,
    requiresProvisionedUser: true,
  },

  // ============================================================================
  // Voice resolution (aggregate read backing /voice view)
  // ============================================================================

  getVoiceResolution: {
    audience: 'user',
    method: 'get',
    path: '/voice-resolution',
    id: 'getVoiceResolution',
    query: { personalityId: z.string() },
    output: GetVoiceResolutionResponseSchema,
    requiresProvisionedUser: true,
  },

  // ============================================================================
  // Diagnostic GETs (lifted from /admin per the route-prefix cutover)
  // Owner can pass ?userId=<subject> to inspect another user's logs;
  // non-owners' subject parameter is ignored server-side. Subject's row
  // may not be provisioned — these routes do NOT requireProvisionedUser.
  // ============================================================================

  getRecentDiagnostics: {
    audience: 'user',
    method: 'get',
    path: '/diagnostic/recent',
    id: 'getRecentDiagnostics',
    // Note: the server handler reads `?userId=` for the subject — that's
    // what `acceptsSubject: true` maps to in the generated client (the
    // `options.subject` parameter). DO NOT also declare `userId` in
    // `query` here — the codegen would emit two `['userId', ...]`
    // entries into URLSearchParams.set, and the second would silently
    // overwrite the typed subject branding (defeating the whole point).
    // The cross-audience invariant test enforces this.
    query: { personalityId: z.string().optional() },
    output: RecentDiagnosticLogsResponseSchema,
    acceptsSubject: true,
  },

  getDiagnosticByMessage: {
    audience: 'user',
    method: 'get',
    path: '/diagnostic/by-message/:messageId',
    id: 'getDiagnosticByMessage',
    params: { messageId: z.string() },
    output: DiagnosticLogsResponseSchema,
    acceptsSubject: true,
  },

  getDiagnosticByResponse: {
    audience: 'user',
    method: 'get',
    path: '/diagnostic/by-response/:messageId',
    id: 'getDiagnosticByResponse',
    params: { messageId: z.string() },
    output: DiagnosticLogResponseSchema,
    acceptsSubject: true,
  },

  getDiagnosticByRequestId: {
    audience: 'user',
    method: 'get',
    path: '/diagnostic/:requestId',
    id: 'getDiagnosticByRequestId',
    params: { requestId: z.string() },
    output: DiagnosticLogResponseSchema,
    acceptsSubject: true,
  },
} as const satisfies Record<string, RouteDef>;
