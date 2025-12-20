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

import type {
  PersonalityService,
  ConversationHistoryService,
  PersonaResolver,
  ChannelActivationCacheInvalidationService,
} from '@tzurot/common-types';
import type { GatewayClient } from '../utils/GatewayClient.js';
import type { JobTracker } from './JobTracker.js';
import type { WebhookManager } from '../utils/WebhookManager.js';

// Service references - set during app initialization
let jobTracker: JobTracker | undefined;
let webhookManager: WebhookManager | undefined;
let gatewayClient: GatewayClient | undefined;
let personalityService: PersonalityService | undefined;
let conversationHistoryService: ConversationHistoryService | undefined;
let personaResolver: PersonaResolver | undefined;
let channelActivationCacheInvalidationService:
  | ChannelActivationCacheInvalidationService
  | undefined;

/**
 * Services that can be registered and accessed globally
 */
export interface RegisteredServices {
  jobTracker: JobTracker;
  webhookManager: WebhookManager;
  gatewayClient: GatewayClient;
  personalityService: PersonalityService;
  conversationHistoryService: ConversationHistoryService;
  personaResolver: PersonaResolver;
  channelActivationCacheInvalidationService: ChannelActivationCacheInvalidationService;
}

/**
 * Register services for global access
 * Call this in index.ts after creating services
 */
export function registerServices(services: RegisteredServices): void {
  jobTracker = services.jobTracker;
  webhookManager = services.webhookManager;
  gatewayClient = services.gatewayClient;
  personalityService = services.personalityService;
  conversationHistoryService = services.conversationHistoryService;
  personaResolver = services.personaResolver;
  channelActivationCacheInvalidationService = services.channelActivationCacheInvalidationService;
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
 * Get the GatewayClient instance
 * @throws Error if services not registered
 */
export function getGatewayClient(): GatewayClient {
  if (gatewayClient === undefined) {
    throw new Error('GatewayClient not registered. Call registerServices() first.');
  }
  return gatewayClient;
}

/**
 * Get the PersonalityService instance
 * @throws Error if services not registered
 */
export function getPersonalityService(): PersonalityService {
  if (personalityService === undefined) {
    throw new Error('PersonalityService not registered. Call registerServices() first.');
  }
  return personalityService;
}

/**
 * Get the ConversationHistoryService instance
 * @throws Error if services not registered
 */
export function getConversationHistoryService(): ConversationHistoryService {
  if (conversationHistoryService === undefined) {
    throw new Error('ConversationHistoryService not registered. Call registerServices() first.');
  }
  return conversationHistoryService;
}

/**
 * Get the PersonaResolver instance
 * @throws Error if services not registered
 */
export function getPersonaResolver(): PersonaResolver {
  if (personaResolver === undefined) {
    throw new Error('PersonaResolver not registered. Call registerServices() first.');
  }
  return personaResolver;
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
 * Check if services have been registered
 */
export function areServicesRegistered(): boolean {
  return (
    jobTracker !== undefined &&
    webhookManager !== undefined &&
    gatewayClient !== undefined &&
    personalityService !== undefined &&
    conversationHistoryService !== undefined &&
    personaResolver !== undefined &&
    channelActivationCacheInvalidationService !== undefined
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
  gatewayClient = undefined;
  personalityService = undefined;
  conversationHistoryService = undefined;
  personaResolver = undefined;
  channelActivationCacheInvalidationService = undefined;
}
