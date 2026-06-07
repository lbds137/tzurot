/**
 * Shared seed helpers for conformance fixtures.
 *
 * All creation goes through the real API (ctx.call) so seeded rows are
 * produced by the same handlers production uses — the only exceptions are
 * rows whose create route requires a live third-party round-trip (see e.g.
 * the wallet seeding in userResources.ts).
 */

import type { SeedContext } from './types.js';

/** Create a personality owned by the actor; returns its UUID. */
export async function createPersonality(ctx: SeedContext, slug: string): Promise<{ id: string }> {
  const res = (await ctx.call('post', '/api/user/personality', {
    name: `Conformance ${slug}`,
    slug,
    characterInfo: 'Character info seeded by the conformance harness.',
    personalityTraits: 'Methodical, thorough, contract-abiding.',
  })) as { personality: { id: string } };
  return { id: res.personality.id };
}

/** Create a persona owned by the actor; returns its UUID. */
export async function createPersona(ctx: SeedContext, name: string): Promise<{ id: string }> {
  const res = (await ctx.call('post', '/api/user/persona', {
    name,
    content: 'Persona content seeded by the conformance harness.',
  })) as { persona: { id: string } };
  return { id: res.persona.id };
}

/** Create a user-owned LLM config; returns its UUID. */
export async function createLlmConfig(ctx: SeedContext, name: string): Promise<{ id: string }> {
  const res = (await ctx.call('post', '/api/user/llm-config', {
    name,
    model: 'anthropic/claude-sonnet-4',
  })) as { config: { id: string } };
  return { id: res.config.id };
}

/** Create a user-owned TTS config (self-hosted: no provider round-trip); returns its UUID. */
export async function createTtsConfig(ctx: SeedContext, name: string): Promise<{ id: string }> {
  const res = (await ctx.call('post', '/api/user/tts-config', {
    name,
    provider: 'self-hosted',
  })) as { config: { id: string } };
  return { id: res.config.id };
}
