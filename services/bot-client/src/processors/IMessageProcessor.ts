/**
 * Message Processor Interface
 *
 * Defines the contract for message processors in the Chain of Responsibility pattern.
 * Each processor inspects a message and either handles it or passes it to the next processor.
 */

import type { Message } from 'discord.js';

/**
 * Message processor interface for Chain of Responsibility pattern
 */
export interface IMessageProcessor {
  /**
   * Process a Discord message
   *
   * @param message - Discord message to process
   * @returns true if the processor handled the message (stop chain), false to continue
   */
  process(message: Message): Promise<boolean>;
}
