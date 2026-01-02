/**
 * API Response Schemas
 *
 * Centralized Zod schemas for all API endpoint responses.
 * These define the contract between api-gateway and bot-client.
 */

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

// Usage endpoints
export * from './usage.js';

// Channel activation endpoints
export * from './channel.js';

// Bot settings endpoints (admin) - LEGACY, kept for backward compat during transition
export * from './botSettings.js';

// Admin settings endpoints (new singleton pattern)
export * from './adminSettings.js';
