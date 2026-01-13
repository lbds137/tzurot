/**
 * Active Collector Registry
 *
 * Tracks which messages currently have active collectors handling their interactions.
 * This prevents race conditions between collectors and global InteractionCreate handlers.
 *
 * Pattern:
 * 1. When a command creates a collector, register the message ID
 * 2. Global handler checks registry - if message is registered, ignore the interaction
 * 3. When collector ends (timeout), deregister the message ID
 * 4. After deregistration, global handler shows "expired" message for button clicks
 *
 * This handles bot restarts gracefully: the Set is empty on startup, so old buttons
 * correctly show "expired" since their message IDs aren't registered.
 */

/** Set of message IDs that have active collectors */
const activeCollectors = new Set<string>();

/**
 * Register a message as having an active collector.
 * Call this when setting up a collector for pagination/interaction handling.
 */
export function registerActiveCollector(messageId: string): void {
  activeCollectors.add(messageId);
}

/**
 * Deregister a message when its collector ends.
 * Call this in the collector's 'end' event handler.
 */
export function deregisterActiveCollector(messageId: string): void {
  activeCollectors.delete(messageId);
}

/**
 * Check if a message has an active collector.
 * Global handlers should use this to decide whether to handle an interaction.
 *
 * @returns true if a collector is active for this message (global handler should ignore)
 */
export function hasActiveCollector(messageId: string): boolean {
  return activeCollectors.has(messageId);
}

/**
 * Get the count of active collectors (for debugging/monitoring).
 */
export function getActiveCollectorCount(): number {
  return activeCollectors.size;
}
