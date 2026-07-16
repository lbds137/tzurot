/**
 * Service Registry
 *
 * Provides access to runtime services from anywhere in the application.
 * This is needed because slash commands are loaded dynamically and don't
 * have access to the services created in the composition root.
 *
 * Usage:
 * - Call registerServices() in index.ts after creating services
 * - Import getJobTracker(), getWebhookManager(), etc. in commands
 */

import type { ChannelActivationCacheInvalidationService } from '@tzurot/cache-invalidation';
import type { IPersonalityLoader } from '../types/IPersonalityLoader.js';
import type { JobTracker } from './JobTracker.js';
import type { WebhookManager } from '../utils/WebhookManager.js';
import type { MessageContextBuilder } from './MessageContextBuilder.js';
import type { ConversationPersistence } from './ConversationPersistence.js';
import type { DenylistCache } from './DenylistCache.js';

// Service references - set during app initialization
let jobTracker: JobTracker | undefined;
let webhookManager: WebhookManager | undefined;
let personalityService: IPersonalityLoader | undefined;
let channelActivationCacheInvalidationService:
  ChannelActivationCacheInvalidationService | undefined;
let messageContextBuilder: MessageContextBuilder | undefined;
let conversationPersistence: ConversationPersistence | undefined;
let denylistCache: DenylistCache | undefined;

/**
 * Services that can be registered and accessed globally
 */
interface RegisteredServices {
  jobTracker: JobTracker;
  webhookManager: WebhookManager;
  personalityService: IPersonalityLoader;
  channelActivationCacheInvalidationService: ChannelActivationCacheInvalidationService;
  messageContextBuilder: MessageContextBuilder;
  conversationPersistence: ConversationPersistence;
  denylistCache: DenylistCache;
}

/**
 * Register services for global access
 * Call this in index.ts after creating services
 */
export function registerServices(services: RegisteredServices): void {
  jobTracker = services.jobTracker;
  webhookManager = services.webhookManager;
  personalityService = services.personalityService;
  channelActivationCacheInvalidationService = services.channelActivationCacheInvalidationService;
  messageContextBuilder = services.messageContextBuilder;
  conversationPersistence = services.conversationPersistence;
  denylistCache = services.denylistCache;
}

/**
 * Get the JobTracker instance
 * @throws Error if services not registered
 */
export function getJobTracker(): JobTracker {
  if (jobTracker === undefined) {
    throw new Error('JobTracker not registered. Call registerServices() first.');
  }
  return jobTracker;
}

/**
 * Get the WebhookManager instance
 * @throws Error if services not registered
 */
export function getWebhookManager(): WebhookManager {
  if (webhookManager === undefined) {
    throw new Error('WebhookManager not registered. Call registerServices() first.');
  }
  return webhookManager;
}

/**
 * Get the routing personality loader (the gateway-backed HttpPersonalityLoader).
 * Named "loader" not "service" because it returns an IPersonalityLoader — the
 * caller must not assume a Prisma-backed implementation.
 * @throws Error if services not registered
 */
export function getPersonalityLoader(): IPersonalityLoader {
  if (personalityService === undefined) {
    throw new Error('Personality loader not registered. Call registerServices() first.');
  }
  return personalityService;
}

/**
 * Get the ChannelActivationCacheInvalidationService instance
 * Used by /channel activate and /channel deactivate to publish invalidation events
 * @throws Error if services not registered
 */
export function getChannelActivationCacheInvalidationService(): ChannelActivationCacheInvalidationService {
  if (channelActivationCacheInvalidationService === undefined) {
    throw new Error(
      'ChannelActivationCacheInvalidationService not registered. Call registerServices() first.'
    );
  }
  return channelActivationCacheInvalidationService;
}

/**
 * Get the MessageContextBuilder instance
 * Used by /character chat to build context from interactions
 * @throws Error if services not registered
 */
export function getMessageContextBuilder(): MessageContextBuilder {
  if (messageContextBuilder === undefined) {
    throw new Error('MessageContextBuilder not registered. Call registerServices() first.');
  }
  return messageContextBuilder;
}

/**
 * Get the ConversationPersistence instance
 * Used by /character chat to save messages to conversation history
 * @throws Error if services not registered
 */
export function getConversationPersistence(): ConversationPersistence {
  if (conversationPersistence === undefined) {
    throw new Error('ConversationPersistence not registered. Call registerServices() first.');
  }
  return conversationPersistence;
}

/**
 * Get the DenylistCache instance, or `undefined` if not registered. Unlike the
 * other getters this does NOT throw: the denylist is a best-effort moderation
 * gate that degrades open (matches how PersonalityChatManager treats its
 * injected instance), so callers guard with `!== undefined`.
 */
export function getDenylistCache(): DenylistCache | undefined {
  return denylistCache;
}

/**
 * Check if services have been registered
 */
export function areServicesRegistered(): boolean {
  return (
    jobTracker !== undefined &&
    webhookManager !== undefined &&
    personalityService !== undefined &&
    channelActivationCacheInvalidationService !== undefined &&
    messageContextBuilder !== undefined &&
    conversationPersistence !== undefined &&
    denylistCache !== undefined
  );
}

/**
 * Reset all service references to undefined.
 * Used in tests to ensure clean state between test suites.
 *
 * @example
 * afterEach(() => {
 *   resetServices();
 * });
 */
export function resetServices(): void {
  jobTracker = undefined;
  webhookManager = undefined;
  personalityService = undefined;
  channelActivationCacheInvalidationService = undefined;
  messageContextBuilder = undefined;
  conversationPersistence = undefined;
  denylistCache = undefined;
}
