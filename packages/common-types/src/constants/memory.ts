/**
 * Memory Constants
 *
 * Deterministic UUID generation for memories. Shared between ai-worker (live path)
 * and tooling (backfill path) to ensure both produce identical IDs for the same content.
 *
 * WARNING: Changing the namespace or seed string will cause new memories to get
 * different UUIDs from existing ones, breaking deduplication.
 */

import crypto from 'crypto';
import { v5 as uuidv5 } from 'uuid';
import { DNS_NAMESPACE } from '../utils/deterministicUuid.js';

/** Deterministic namespace for all tzurot v3 memory UUIDs */
export const MEMORY_NAMESPACE = uuidv5('tzurot-v3-memory', DNS_NAMESPACE);

/**
 * Hash content using SHA-256 (truncated to 32 hex chars = 128 bits).
 * Used for deterministic memory UUID generation.
 * Collision risk at 128 bits is negligible at our scale (~10^18 items for 50% collision).
 * If a collision did occur, ON CONFLICT DO NOTHING would silently skip the duplicate.
 */
export function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 32);
}

/**
 * Generate a deterministic UUID for a memory based on persona, personality, and content.
 * Ensures the same memory content always produces the same ID (for idempotent storage).
 */
export function deterministicMemoryUuid(
  personaId: string,
  personalityId: string,
  content: string
): string {
  const key = `${personaId}:${personalityId}:${hashContent(content)}`;
  return uuidv5(key, MEMORY_NAMESPACE);
}
