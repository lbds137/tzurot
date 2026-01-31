/**
 * Service Registry Tests
 *
 * Tests the service locator pattern for accessing runtime services.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type {
  PersonalityService,
  ConversationHistoryService,
  PersonaResolver,
  ChannelActivationCacheInvalidationService,
} from '@tzurot/common-types';
import type { GatewayClient } from '../utils/GatewayClient.js';
import type { JobTracker } from './JobTracker.js';
import type { WebhookManager } from '../utils/WebhookManager.js';
import type { MessageContextBuilder } from './MessageContextBuilder.js';
import type { ConversationPersistence } from './ConversationPersistence.js';
import type { ExtendedContextResolver } from './ExtendedContextResolver.js';

const mockMessageContextBuilder = {
  buildContext: vi.fn(),
} as unknown as MessageContextBuilder;

const mockConversationPersistence = {
  saveUserMessageFromFields: vi.fn(),
  saveAssistantMessageFromFields: vi.fn(),
} as unknown as ConversationPersistence;

const mockExtendedContextResolver = {
  resolveAll: vi.fn(),
} as unknown as ExtendedContextResolver;

describe('serviceRegistry', () => {
  // Reset modules before each test to get clean state
  beforeEach(() => {
    vi.resetModules();
  });

  describe('before registration', () => {
    it('should throw when getting JobTracker before registration', async () => {
      const { getJobTracker } = await import('./serviceRegistry.js');
      expect(() => getJobTracker()).toThrow(
        'JobTracker not registered. Call registerServices() first.'
      );
    });

    it('should throw when getting WebhookManager before registration', async () => {
      const { getWebhookManager } = await import('./serviceRegistry.js');
      expect(() => getWebhookManager()).toThrow(
        'WebhookManager not registered. Call registerServices() first.'
      );
    });

    it('should throw when getting GatewayClient before registration', async () => {
      const { getGatewayClient } = await import('./serviceRegistry.js');
      expect(() => getGatewayClient()).toThrow(
        'GatewayClient not registered. Call registerServices() first.'
      );
    });

    it('should throw when getting PersonalityService before registration', async () => {
      const { getPersonalityService } = await import('./serviceRegistry.js');
      expect(() => getPersonalityService()).toThrow(
        'PersonalityService not registered. Call registerServices() first.'
      );
    });

    it('should throw when getting ConversationHistoryService before registration', async () => {
      const { getConversationHistoryService } = await import('./serviceRegistry.js');
      expect(() => getConversationHistoryService()).toThrow(
        'ConversationHistoryService not registered. Call registerServices() first.'
      );
    });

    it('should throw when getting PersonaResolver before registration', async () => {
      const { getPersonaResolver } = await import('./serviceRegistry.js');
      expect(() => getPersonaResolver()).toThrow(
        'PersonaResolver not registered. Call registerServices() first.'
      );
    });

    it('should throw when getting ChannelActivationCacheInvalidationService before registration', async () => {
      const { getChannelActivationCacheInvalidationService } = await import('./serviceRegistry.js');
      expect(() => getChannelActivationCacheInvalidationService()).toThrow(
        'ChannelActivationCacheInvalidationService not registered. Call registerServices() first.'
      );
    });

    it('should throw when getting MessageContextBuilder before registration', async () => {
      const { getMessageContextBuilder } = await import('./serviceRegistry.js');
      expect(() => getMessageContextBuilder()).toThrow(
        'MessageContextBuilder not registered. Call registerServices() first.'
      );
    });

    it('should throw when getting ConversationPersistence before registration', async () => {
      const { getConversationPersistence } = await import('./serviceRegistry.js');
      expect(() => getConversationPersistence()).toThrow(
        'ConversationPersistence not registered. Call registerServices() first.'
      );
    });

    it('should throw when getting ExtendedContextResolver before registration', async () => {
      const { getExtendedContextResolver } = await import('./serviceRegistry.js');
      expect(() => getExtendedContextResolver()).toThrow(
        'ExtendedContextResolver not registered. Call registerServices() first.'
      );
    });

    it('should report services not registered', async () => {
      const { areServicesRegistered } = await import('./serviceRegistry.js');
      expect(areServicesRegistered()).toBe(false);
    });
  });

  describe('after registration', () => {
    const mockJobTracker = { track: vi.fn() } as unknown as JobTracker;
    const mockWebhookManager = { send: vi.fn() } as unknown as WebhookManager;
    const mockGatewayClient = { generate: vi.fn() } as unknown as GatewayClient;
    const mockPersonalityService = { loadPersonality: vi.fn() } as unknown as PersonalityService;
    const mockConversationHistoryService = {
      getRecentHistory: vi.fn(),
    } as unknown as ConversationHistoryService;
    const mockPersonaResolver = { resolve: vi.fn() } as unknown as PersonaResolver;
    const mockChannelActivationCacheInvalidationService = {
      invalidateChannel: vi.fn(),
    } as unknown as ChannelActivationCacheInvalidationService;
    const mockMessageContextBuilder = {
      buildContext: vi.fn(),
    } as unknown as MessageContextBuilder;
    const mockLocalExtendedContextResolver = {
      resolveAll: vi.fn(),
    } as unknown as ExtendedContextResolver;

    it('should return registered JobTracker', async () => {
      const { registerServices, getJobTracker } = await import('./serviceRegistry.js');

      registerServices({
        jobTracker: mockJobTracker,
        webhookManager: mockWebhookManager,
        gatewayClient: mockGatewayClient,
        personalityService: mockPersonalityService,
        conversationHistoryService: mockConversationHistoryService,
        personaResolver: mockPersonaResolver,
        channelActivationCacheInvalidationService: mockChannelActivationCacheInvalidationService,
        messageContextBuilder: mockMessageContextBuilder,
        conversationPersistence: mockConversationPersistence,
        extendedContextResolver: mockExtendedContextResolver,
      });

      expect(getJobTracker()).toBe(mockJobTracker);
    });

    it('should return registered WebhookManager', async () => {
      const { registerServices, getWebhookManager } = await import('./serviceRegistry.js');

      registerServices({
        jobTracker: mockJobTracker,
        webhookManager: mockWebhookManager,
        gatewayClient: mockGatewayClient,
        personalityService: mockPersonalityService,
        conversationHistoryService: mockConversationHistoryService,
        personaResolver: mockPersonaResolver,
        channelActivationCacheInvalidationService: mockChannelActivationCacheInvalidationService,
        messageContextBuilder: mockMessageContextBuilder,
        conversationPersistence: mockConversationPersistence,
        extendedContextResolver: mockExtendedContextResolver,
      });

      expect(getWebhookManager()).toBe(mockWebhookManager);
    });

    it('should return registered GatewayClient', async () => {
      const { registerServices, getGatewayClient } = await import('./serviceRegistry.js');

      registerServices({
        jobTracker: mockJobTracker,
        webhookManager: mockWebhookManager,
        gatewayClient: mockGatewayClient,
        personalityService: mockPersonalityService,
        conversationHistoryService: mockConversationHistoryService,
        personaResolver: mockPersonaResolver,
        channelActivationCacheInvalidationService: mockChannelActivationCacheInvalidationService,
        messageContextBuilder: mockMessageContextBuilder,
        conversationPersistence: mockConversationPersistence,
        extendedContextResolver: mockExtendedContextResolver,
      });

      expect(getGatewayClient()).toBe(mockGatewayClient);
    });

    it('should return registered PersonalityService', async () => {
      const { registerServices, getPersonalityService } = await import('./serviceRegistry.js');

      registerServices({
        jobTracker: mockJobTracker,
        webhookManager: mockWebhookManager,
        gatewayClient: mockGatewayClient,
        personalityService: mockPersonalityService,
        conversationHistoryService: mockConversationHistoryService,
        personaResolver: mockPersonaResolver,
        channelActivationCacheInvalidationService: mockChannelActivationCacheInvalidationService,
        messageContextBuilder: mockMessageContextBuilder,
        conversationPersistence: mockConversationPersistence,
        extendedContextResolver: mockExtendedContextResolver,
      });

      expect(getPersonalityService()).toBe(mockPersonalityService);
    });

    it('should return registered ConversationHistoryService', async () => {
      const { registerServices, getConversationHistoryService } =
        await import('./serviceRegistry.js');

      registerServices({
        jobTracker: mockJobTracker,
        webhookManager: mockWebhookManager,
        gatewayClient: mockGatewayClient,
        personalityService: mockPersonalityService,
        conversationHistoryService: mockConversationHistoryService,
        personaResolver: mockPersonaResolver,
        channelActivationCacheInvalidationService: mockChannelActivationCacheInvalidationService,
        messageContextBuilder: mockMessageContextBuilder,
        conversationPersistence: mockConversationPersistence,
        extendedContextResolver: mockExtendedContextResolver,
      });

      expect(getConversationHistoryService()).toBe(mockConversationHistoryService);
    });

    it('should return registered PersonaResolver', async () => {
      const { registerServices, getPersonaResolver } = await import('./serviceRegistry.js');

      registerServices({
        jobTracker: mockJobTracker,
        webhookManager: mockWebhookManager,
        gatewayClient: mockGatewayClient,
        personalityService: mockPersonalityService,
        conversationHistoryService: mockConversationHistoryService,
        personaResolver: mockPersonaResolver,
        channelActivationCacheInvalidationService: mockChannelActivationCacheInvalidationService,
        messageContextBuilder: mockMessageContextBuilder,
        conversationPersistence: mockConversationPersistence,
        extendedContextResolver: mockExtendedContextResolver,
      });

      expect(getPersonaResolver()).toBe(mockPersonaResolver);
    });

    it('should return registered ChannelActivationCacheInvalidationService', async () => {
      const { registerServices, getChannelActivationCacheInvalidationService } =
        await import('./serviceRegistry.js');

      registerServices({
        jobTracker: mockJobTracker,
        webhookManager: mockWebhookManager,
        gatewayClient: mockGatewayClient,
        personalityService: mockPersonalityService,
        conversationHistoryService: mockConversationHistoryService,
        personaResolver: mockPersonaResolver,
        channelActivationCacheInvalidationService: mockChannelActivationCacheInvalidationService,
        messageContextBuilder: mockMessageContextBuilder,
        conversationPersistence: mockConversationPersistence,
        extendedContextResolver: mockExtendedContextResolver,
      });

      expect(getChannelActivationCacheInvalidationService()).toBe(
        mockChannelActivationCacheInvalidationService
      );
    });

    it('should return registered MessageContextBuilder', async () => {
      const { registerServices, getMessageContextBuilder } = await import('./serviceRegistry.js');

      registerServices({
        jobTracker: mockJobTracker,
        webhookManager: mockWebhookManager,
        gatewayClient: mockGatewayClient,
        personalityService: mockPersonalityService,
        conversationHistoryService: mockConversationHistoryService,
        personaResolver: mockPersonaResolver,
        channelActivationCacheInvalidationService: mockChannelActivationCacheInvalidationService,
        messageContextBuilder: mockMessageContextBuilder,
        conversationPersistence: mockConversationPersistence,
        extendedContextResolver: mockExtendedContextResolver,
      });

      expect(getMessageContextBuilder()).toBe(mockMessageContextBuilder);
    });

    it('should return registered ConversationPersistence', async () => {
      const { registerServices, getConversationPersistence } = await import('./serviceRegistry.js');

      registerServices({
        jobTracker: mockJobTracker,
        webhookManager: mockWebhookManager,
        gatewayClient: mockGatewayClient,
        personalityService: mockPersonalityService,
        conversationHistoryService: mockConversationHistoryService,
        personaResolver: mockPersonaResolver,
        channelActivationCacheInvalidationService: mockChannelActivationCacheInvalidationService,
        messageContextBuilder: mockMessageContextBuilder,
        conversationPersistence: mockConversationPersistence,
        extendedContextResolver: mockExtendedContextResolver,
      });

      expect(getConversationPersistence()).toBe(mockConversationPersistence);
    });

    it('should return registered ExtendedContextResolver', async () => {
      const { registerServices, getExtendedContextResolver } = await import('./serviceRegistry.js');

      registerServices({
        jobTracker: mockJobTracker,
        webhookManager: mockWebhookManager,
        gatewayClient: mockGatewayClient,
        personalityService: mockPersonalityService,
        conversationHistoryService: mockConversationHistoryService,
        personaResolver: mockPersonaResolver,
        channelActivationCacheInvalidationService: mockChannelActivationCacheInvalidationService,
        messageContextBuilder: mockMessageContextBuilder,
        conversationPersistence: mockConversationPersistence,
        extendedContextResolver: mockExtendedContextResolver,
      });

      expect(getExtendedContextResolver()).toBe(mockExtendedContextResolver);
    });

    it('should report services as registered', async () => {
      const { registerServices, areServicesRegistered } = await import('./serviceRegistry.js');

      registerServices({
        jobTracker: mockJobTracker,
        webhookManager: mockWebhookManager,
        gatewayClient: mockGatewayClient,
        personalityService: mockPersonalityService,
        conversationHistoryService: mockConversationHistoryService,
        personaResolver: mockPersonaResolver,
        channelActivationCacheInvalidationService: mockChannelActivationCacheInvalidationService,
        messageContextBuilder: mockMessageContextBuilder,
        conversationPersistence: mockConversationPersistence,
        extendedContextResolver: mockExtendedContextResolver,
      });

      expect(areServicesRegistered()).toBe(true);
    });
  });

  describe('partial registration', () => {
    it('should report services not registered when only some are set', async () => {
      const { registerServices, areServicesRegistered } = await import('./serviceRegistry.js');

      // Type cast to bypass TypeScript requirement for all services
      // This simulates an incomplete registration scenario
      const partialServices = {
        jobTracker: { track: vi.fn() } as unknown as JobTracker,
        webhookManager: undefined,
        gatewayClient: undefined,
        personalityService: undefined,
        conversationHistoryService: undefined,
        personaResolver: undefined,
        channelActivationCacheInvalidationService: undefined,
        messageContextBuilder: undefined,
        conversationPersistence: undefined,
        extendedContextResolver: undefined,
      } as unknown as {
        jobTracker: JobTracker;
        webhookManager: WebhookManager;
        gatewayClient: GatewayClient;
        personalityService: PersonalityService;
        conversationHistoryService: ConversationHistoryService;
        personaResolver: PersonaResolver;
        channelActivationCacheInvalidationService: ChannelActivationCacheInvalidationService;
        messageContextBuilder: MessageContextBuilder;
        conversationPersistence: ConversationPersistence;
        extendedContextResolver: ExtendedContextResolver;
      };

      registerServices(partialServices);

      expect(areServicesRegistered()).toBe(false);
    });
  });

  describe('resetServices', () => {
    it('should reset all services to undefined', async () => {
      const { registerServices, resetServices, areServicesRegistered, getJobTracker } =
        await import('./serviceRegistry.js');

      const mockJobTracker = { track: vi.fn() } as unknown as JobTracker;
      const mockWebhookManager = { send: vi.fn() } as unknown as WebhookManager;
      const mockGatewayClient = { generate: vi.fn() } as unknown as GatewayClient;
      const mockPersonalityService = { loadPersonality: vi.fn() } as unknown as PersonalityService;
      const mockConversationHistoryService = {
        getRecentHistory: vi.fn(),
      } as unknown as ConversationHistoryService;
      const mockPersonaResolver = { resolve: vi.fn() } as unknown as PersonaResolver;
      const mockChannelActivationCacheInvalidationService = {
        invalidateChannel: vi.fn(),
      } as unknown as ChannelActivationCacheInvalidationService;
      const localMockMessageContextBuilder = {
        buildContext: vi.fn(),
      } as unknown as MessageContextBuilder;
      const localMockConversationPersistence = {
        saveUserMessageFromFields: vi.fn(),
      } as unknown as ConversationPersistence;
      const localMockExtendedContextResolver = {
        resolveAll: vi.fn(),
      } as unknown as ExtendedContextResolver;

      // Register services first
      registerServices({
        jobTracker: mockJobTracker,
        webhookManager: mockWebhookManager,
        gatewayClient: mockGatewayClient,
        personalityService: mockPersonalityService,
        conversationHistoryService: mockConversationHistoryService,
        personaResolver: mockPersonaResolver,
        channelActivationCacheInvalidationService: mockChannelActivationCacheInvalidationService,
        messageContextBuilder: localMockMessageContextBuilder,
        conversationPersistence: localMockConversationPersistence,
        extendedContextResolver: localMockExtendedContextResolver,
      });

      expect(areServicesRegistered()).toBe(true);

      // Reset services
      resetServices();

      // Verify all services are now undefined
      expect(areServicesRegistered()).toBe(false);
      expect(() => getJobTracker()).toThrow('JobTracker not registered');
    });
  });
});
