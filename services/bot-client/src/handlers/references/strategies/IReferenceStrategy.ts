/**
 * Reference Extraction Strategy Interface
 *
 * Defines the contract for extracting different types of references from Discord messages
 */

import type { Message } from 'discord.js';
import type { ReferenceResult } from '../types.js';

/**
 * Strategy interface for extracting references from messages
 */
export interface IReferenceStrategy {
  /**
   * Extract references from a Discord message
   * @param message - Discord message to extract from
   * @returns Array of reference results (empty if none found)
   */
  extract(message: Message): Promise<ReferenceResult[]>;
}
