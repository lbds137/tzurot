/**
 * API Response Schemas
 *
 * Centralized Zod schemas for all API endpoint responses.
 * These define the contract between api-gateway and bot-client.
 */

// Shared schemas (permissions, etc.)
export * from './shared.js';

// Persona endpoints
export * from './persona.js';

// Personality endpoints
export * from './personality.js';

// Model Override endpoints
export * from './model-override.js';

// Wallet endpoints
export * from './wallet.js';

// Timezone endpoints
export * from './timezone.js';

// LLM Config endpoints
export * from './llm-config.js';

// TTS Config endpoints
export * from './tts-config.js';

// TTS Override endpoints (per-personality + user default)
export * from './tts-override.js';

// STT Override endpoints (per-personality + user default STT provider)
export * from './stt-override.js';

// Voice resolution aggregate read endpoint backing /voice view
export * from './voice-resolution.js';

// Channel activation endpoints
export * from './channel.js';

// Admin settings endpoints (singleton pattern)
export * from './adminSettings.js';

// Config cascade overrides (JSONB column schema)
export * from './configOverrides.js';

// Usage endpoints
export * from './usage.js';

// NSFW verification endpoints
export * from './nsfw.js';

// Denylist schemas
export * from './denylist.js';

// Admin input schemas
export * from './admin.js';

// Memory input schemas
export * from './memory.js';

// History input schemas
export * from './history.js';

// Transcribe input schemas
export * from './transcribe.js';

// Internal service-to-service endpoints
export * from './internal.js';

// Diagnostic endpoints (response schemas for /admin/diagnostic/*)
export * from './diagnostic.js';

// AI endpoints (response schemas for /ai/{generate,transcribe,job/:id/...})
export * from './ai.js';

// Admin operational routes (db-sync, cleanup, invalidate-cache responses)
export * from './admin-operations.js';

// Admin stop-sequence observability endpoint
export * from './stopSequences.js';
