/**
 * User Memory Fresh Routes
 * Fresh mode management - temporarily disable memory READING. The character
 * replies without using its long-term memories of the user; nothing is
 * deleted (the write-side sibling is incognito mode, which disables saving).
 *
 * GET /api/user/memory/fresh - Get current fresh status (optional
 *   `personalityId` query filters to sessions that apply to that character)
 * POST /api/user/memory/fresh - Enable fresh mode
 * DELETE /api/user/memory/fresh - Disable fresh mode
 *
 * All three are the shared memory-mode handlers (see memoryModeHandlers.ts);
 * the ai-worker checks the `fresh:` Redis keys at retrieval time. The
 * generated mounts.ts registers the handler exports directly — there is no
 * local router factory.
 */

import { createMemoryModeHandlers } from './memoryModeHandlers.js';

const freshHandlers = createMemoryModeHandlers('fresh', {
  alreadyActive: name =>
    `Fresh mode is already active for ${name}. Disable it first to change duration.`,
  enabled: (name, durationLabel) =>
    `🌱 Fresh mode enabled for ${name} (${durationLabel}). Replies won't use what they remember about you — memories are kept, just not used.`,
  notActive: name => `Fresh mode was not active for ${name}.`,
  disabled: name =>
    `🌱 Fresh mode disabled for ${name}. Replies will use their memories of you again.`,
});

// ===== Handler factories ===================================================

/** GET /api/user/memory/fresh */
export const handleGetFreshStatus = freshHandlers.handleStatus;

/** POST /api/user/memory/fresh */
export const handleEnableFresh = freshHandlers.handleEnable;

/** DELETE /api/user/memory/fresh */
export const handleDisableFresh = freshHandlers.handleDisable;
