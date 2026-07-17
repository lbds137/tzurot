/**
 * Conformance fixtures: user-audience ownership routes
 * (personality CRUD, persona CRUD, persona overrides).
 *
 * Seeds go through the API itself (ctx.call) so the rows are created by the
 * same handlers production uses — no hand-written Prisma inserts to drift.
 */

import type { ConformanceEntry } from './types.js';
import { createPersona, createPersonality } from './seedHelpers.js';

/** Minimal valid PersonalityCreateSchema body with a per-fixture slug. */
function personalityBody(slug: string): Record<string, unknown> {
  return {
    name: `Conformance ${slug}`,
    slug,
    characterInfo: 'Character info seeded by the conformance harness.',
    personalityTraits: 'Methodical, thorough, contract-abiding.',
  };
}

/** Minimal valid PersonaCreateSchema body. */
function personaBody(name: string): Record<string, unknown> {
  return {
    name,
    content: 'Persona content seeded by the conformance harness.',
  };
}

export const userOwnershipFixtures: Record<string, ConformanceEntry> = {
  // ---- Personality CRUD ---------------------------------------------------

  listPersonalities: {
    // Seed one row so the array element schema is actually exercised —
    // an empty list parses trivially and would mask element-level drift.
    seed: async ctx => {
      await createPersonality(ctx, 'conf-list-personality');
    },
  },

  getPersonality: {
    seed: async ctx => {
      await createPersonality(ctx, 'conf-get-personality');
    },
    params: { slug: 'conf-get-personality' },
  },

  createPersonality: {
    body: personalityBody('conf-create-personality'),
  },

  updatePersonality: {
    seed: async ctx => {
      await createPersonality(ctx, 'conf-update-personality');
    },
    params: { slug: 'conf-update-personality' },
    body: { characterInfo: 'Updated by the conformance harness.' },
  },

  setPersonalityVisibility: {
    seed: async ctx => {
      await createPersonality(ctx, 'conf-visibility-personality');
    },
    params: { slug: 'conf-visibility-personality' },
    body: { isPublic: true },
  },

  deletePersonality: {
    seed: async ctx => {
      await createPersonality(ctx, 'conf-delete-personality');
    },
    params: { slug: 'conf-delete-personality' },
  },

  // ---- Persona CRUD -------------------------------------------------------

  listPersonas: {
    seed: async ctx => {
      await createPersona(ctx, 'Conf List Persona');
    },
  },

  getPersona: {
    seed: async ctx => {
      const persona = await createPersona(ctx, 'Conf Get Persona');
      return { params: { id: persona.id } };
    },
  },

  createPersona: {
    body: personaBody('Conf Create Persona'),
  },

  updatePersona: {
    seed: async ctx => {
      const persona = await createPersona(ctx, 'Conf Update Persona');
      return { params: { id: persona.id } };
    },
    body: { content: 'Updated persona content from the conformance harness.' },
  },

  deletePersona: {
    seed: async ctx => {
      const persona = await createPersona(ctx, 'Conf Delete Persona');
      return { params: { id: persona.id } };
    },
  },

  setPersonaDefault: {
    seed: async ctx => {
      const persona = await createPersona(ctx, 'Conf Default Persona');
      return { params: { id: persona.id } };
    },
  },

  // ---- Persona overrides (per-personality persona pinning) ----------------

  listPersonaOverrides: {
    seed: async ctx => {
      await createPersonality(ctx, 'conf-override-list');
      const persona = await createPersona(ctx, 'Conf Override List Persona');
      await ctx.call('put', '/api/user/persona/override/conf-override-list', {
        personaId: persona.id,
      });
    },
  },

  getPersonaOverride: {
    seed: async ctx => {
      await createPersonality(ctx, 'conf-override-get');
      const persona = await createPersona(ctx, 'Conf Override Get Persona');
      await ctx.call('put', '/api/user/persona/override/conf-override-get', {
        personaId: persona.id,
      });
    },
    params: { personalitySlug: 'conf-override-get' },
  },

  setPersonaOverride: {
    seed: async ctx => {
      await createPersonality(ctx, 'conf-override-set');
      const persona = await createPersona(ctx, 'Conf Override Set Persona');
      return { body: { personaId: persona.id } };
    },
    params: { personalitySlug: 'conf-override-set' },
  },

  clearPersonaOverride: {
    seed: async ctx => {
      await createPersonality(ctx, 'conf-override-clear');
      const persona = await createPersona(ctx, 'Conf Override Clear Persona');
      await ctx.call('put', '/api/user/persona/override/conf-override-clear', {
        personaId: persona.id,
      });
    },
    params: { personalitySlug: 'conf-override-clear' },
  },

  createPersonaOverride: {
    seed: async ctx => {
      const personality = await createPersonality(ctx, 'conf-override-create');
      return { params: { personalityId: personality.id } };
    },
    body: personaBody('Conf Override Create Persona'),
  },
};
