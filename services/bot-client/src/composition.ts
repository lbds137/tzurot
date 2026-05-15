/**
 * Composition helpers for the bot-client startup. Extracted from `index.ts`
 * so the main composition root stays under the function-length cap and the
 * file under the line cap. No logic here — just wiring.
 *
 * Each helper bundles a logical sub-system that's instantiated together at
 * startup. Returning the new objects keeps `createServices` linear and easy
 * to read top-to-bottom.
 */

import type { IMessageProcessor } from './processors/IMessageProcessor.js';
import { BotMessageFilter } from './processors/BotMessageFilter.js';
import { DenylistFilter } from './processors/DenylistFilter.js';
import { EmptyMessageFilter } from './processors/EmptyMessageFilter.js';
import { VoiceMessageProcessor } from './processors/VoiceMessageProcessor.js';
import { PersonalityTriggerProcessor } from './processors/PersonalityTriggerProcessor.js';
import { DMSessionProcessor } from './processors/DMSessionProcessor.js';
import { BotMentionProcessor } from './processors/BotMentionProcessor.js';
import { DenylistCache } from './services/DenylistCache.js';
import { VoiceTranscriptionService } from './services/VoiceTranscriptionService.js';
import { PersonalityIdCache } from './services/PersonalityIdCache.js';
import { GatewayClient } from './utils/GatewayClient.js';
import { ReplyResolutionService } from './services/ReplyResolutionService.js';
import { PersonalityMessageHandler } from './services/PersonalityMessageHandler.js';
import { PersonalityChatManager } from './services/character/PersonalityChatManager.js';
import { MessageContextBuilder } from './services/MessageContextBuilder.js';
import { ConversationPersistence } from './services/ConversationPersistence.js';
import { ReferenceEnrichmentService } from './services/ReferenceEnrichmentService.js';
import { JobTracker } from './services/JobTracker.js';
import { ResponseOrderingService } from './services/ResponseOrderingService.js';
import { SlotDeliveryService } from './services/SlotDeliveryService.js';
import { MultiTagCoordinator } from './services/MultiTagCoordinator.js';
import { MultiTagPersistence } from './services/MultiTagPersistence.js';
import { redis as botRedis } from './redis.js';

/**
 * Build the chat pipeline used by @mention/reply/auto-response paths:
 * the domain manager (gates, config, context, persistence, gateway submit)
 * and its Discord-shape adapter (routes Messages through the manager and
 * tracks the resulting job with JobTracker).
 */
export function buildPersonalityChatPipeline(deps: {
  gatewayClient: GatewayClient;
  contextBuilder: MessageContextBuilder;
  persistence: ConversationPersistence;
  referenceEnricher: ReferenceEnrichmentService;
  denylistCache: DenylistCache;
  jobTracker: JobTracker;
}): {
  personalityChatManager: PersonalityChatManager;
  personalityHandler: PersonalityMessageHandler;
} {
  const personalityChatManager = new PersonalityChatManager({
    gatewayClient: deps.gatewayClient,
    contextBuilder: deps.contextBuilder,
    persistence: deps.persistence,
    referenceEnricher: deps.referenceEnricher,
    denylistCache: deps.denylistCache,
  });
  const personalityHandler = new PersonalityMessageHandler({
    manager: personalityChatManager,
    jobTracker: deps.jobTracker,
  });
  return { personalityChatManager, personalityHandler };
}

/**
 * Build the multi-tag coordinator + its Redis-backed persistence. Returns
 * both because DMSessionProcessor also needs access to the persistence (for
 * the backfill-tried sentinel that gates expensive Discord history scans).
 */
export function buildMultiTagCoordinator(deps: {
  chatManager: PersonalityChatManager;
  gatewayClient: GatewayClient;
  jobTracker: JobTracker;
  orderingService: ResponseOrderingService;
  slotDelivery: SlotDeliveryService;
}): { coordinator: MultiTagCoordinator; persistence: MultiTagPersistence } {
  const persistence = new MultiTagPersistence(botRedis);
  const coordinator = new MultiTagCoordinator({
    chatManager: deps.chatManager,
    gatewayClient: deps.gatewayClient,
    jobTracker: deps.jobTracker,
    orderingService: deps.orderingService,
    slotDelivery: deps.slotDelivery,
    persistence,
  });
  return { coordinator, persistence };
}

/**
 * Build the message-processor chain. Order matters — first match wins.
 *   1. BotMessageFilter           — drop bot-originated messages.
 *   2. DenylistFilter             — silently drop denied users/guilds/channels.
 *   3. EmptyMessageFilter         — drop empty messages.
 *   4. VoiceMessageProcessor      — transcribe voice; sets transcript for later.
 *   5. PersonalityTriggerProcessor — reply + activation + mentions → fan-out.
 *   6. DMSessionProcessor         — bare DM messages → active session character.
 *   7. BotMentionProcessor        — bot itself was @-mentioned (fallback).
 */
export function buildProcessorChain(deps: {
  denylistCache: DenylistCache;
  voiceTranscription: VoiceTranscriptionService;
  personalityIdCache: PersonalityIdCache;
  gatewayClient: GatewayClient;
  replyResolver: ReplyResolutionService;
  coordinator: MultiTagCoordinator;
  personalityHandler: PersonalityMessageHandler;
  multiTagPersistence: MultiTagPersistence;
}): IMessageProcessor[] {
  return [
    new BotMessageFilter(),
    new DenylistFilter(deps.denylistCache),
    new EmptyMessageFilter(),
    new VoiceMessageProcessor(deps.voiceTranscription, deps.personalityIdCache, deps.gatewayClient),
    new PersonalityTriggerProcessor({
      personalityService: deps.personalityIdCache,
      replyResolver: deps.replyResolver,
      gatewayClient: deps.gatewayClient,
      coordinator: deps.coordinator,
    }),
    new DMSessionProcessor(
      deps.gatewayClient,
      deps.personalityIdCache,
      deps.personalityHandler,
      deps.multiTagPersistence
    ),
    new BotMentionProcessor(),
  ];
}
