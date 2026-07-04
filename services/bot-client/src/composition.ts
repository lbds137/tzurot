/**
 * Composition helpers for the bot-client startup. Extracted from `index.ts`
 * so the main composition root stays under the function-length cap and the
 * file under the line cap.
 *
 * **Load-bearing invariant**: every export must be pure DI wiring — a
 * sequence of `new X(...)` calls with no conditional logic, no branching,
 * and no derivation beyond mechanical option-object plumbing. Any control
 * flow MUST move to a tested helper module: this file's `structure.test.ts`
 * exclusion is justified by the no-logic invariant, and adding logic here
 * silently exempts it from coverage enforcement.
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
import { type DenylistCache } from './services/DenylistCache.js';
import { type VoiceTranscriptionService } from './services/VoiceTranscriptionService.js';
import { type ReplyResolutionService } from './services/ReplyResolutionService.js';
import { PersonalityMessageHandler } from './services/PersonalityMessageHandler.js';
import { PersonalityChatManager } from './services/character/PersonalityChatManager.js';
import { type MessageContextBuilder } from './services/MessageContextBuilder.js';
import { type ConversationPersistence } from './services/ConversationPersistence.js';
import { type JobTracker } from './services/JobTracker.js';
import { type ResponseOrderingService } from './services/ResponseOrderingService.js';
import { type SlotDeliveryService } from './services/SlotDeliveryService.js';
import { MultiTagCoordinator } from './services/MultiTagCoordinator.js';
import { MultiTagPersistence } from './services/MultiTagPersistence.js';
import { MultiTagRecovery } from './services/MultiTagRecovery.js';
import { MessageHandler } from './handlers/MessageHandler.js';
import { type DiscordResponseSender } from './services/DiscordResponseSender.js';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Client } from 'discord.js';
import type { IPersonalityLoader } from './types/IPersonalityLoader.js';

/**
 * Build the chat pipeline used by @mention/reply/auto-response paths:
 * the domain manager (gates, config, context, persistence, gateway submit)
 * and its Discord-shape adapter (routes Messages through the manager and
 * tracks the resulting job with JobTracker).
 */
export function buildPersonalityChatPipeline(deps: {
  contextBuilder: MessageContextBuilder;
  persistence: ConversationPersistence;
  denylistCache: DenylistCache;
  jobTracker: JobTracker;
}): {
  personalityChatManager: PersonalityChatManager;
  personalityHandler: PersonalityMessageHandler;
} {
  const personalityChatManager = new PersonalityChatManager({
    contextBuilder: deps.contextBuilder,
    persistence: deps.persistence,
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
  redis: Redis;
  chatManager: PersonalityChatManager;
  jobTracker: JobTracker;
  orderingService: ResponseOrderingService;
  slotDelivery: SlotDeliveryService;
}): { coordinator: MultiTagCoordinator; persistence: MultiTagPersistence } {
  const persistence = new MultiTagPersistence(deps.redis);
  const coordinator = new MultiTagCoordinator({
    chatManager: deps.chatManager,
    jobTracker: deps.jobTracker,
    orderingService: deps.orderingService,
    slotDelivery: deps.slotDelivery,
    persistence,
  });
  return { coordinator, persistence };
}

/**
 * Build the recovery service. Wired separately from
 * `buildMultiTagCoordinator` because recovery depends on the Discord
 * client being logged in — the caller invokes `recovery.run()` AFTER
 * `client.login()`, while the coordinator + persistence are constructed
 * earlier alongside the rest of the services.
 */
export function buildMultiTagRecovery(deps: {
  persistence: MultiTagPersistence;
  coordinator: MultiTagCoordinator;
  personalityService: IPersonalityLoader;
  discordClient: Client;
  queue: Queue;
}): MultiTagRecovery {
  return new MultiTagRecovery({
    persistence: deps.persistence,
    coordinator: deps.coordinator,
    personalityService: deps.personalityService,
    discordClient: deps.discordClient,
    queue: deps.queue,
  });
}

/**
 * Bundle the entire multi-tag stack — coordinator + persistence + recovery
 * — into one call. Keeps `createServices` linear by collapsing what would
 * otherwise be three back-to-back composition calls into a single section.
 */
export function buildMultiTagStack(deps: {
  redis: Redis;
  chatManager: PersonalityChatManager;
  jobTracker: JobTracker;
  orderingService: ResponseOrderingService;
  slotDelivery: SlotDeliveryService;
  personalityService: IPersonalityLoader;
  discordClient: Client;
  recoveryQueue: Queue;
}): {
  coordinator: MultiTagCoordinator;
  persistence: MultiTagPersistence;
  recovery: MultiTagRecovery;
} {
  const { coordinator, persistence } = buildMultiTagCoordinator({
    redis: deps.redis,
    chatManager: deps.chatManager,
    jobTracker: deps.jobTracker,
    orderingService: deps.orderingService,
    slotDelivery: deps.slotDelivery,
  });
  const recovery = buildMultiTagRecovery({
    persistence,
    coordinator,
    personalityService: deps.personalityService,
    discordClient: deps.discordClient,
    queue: deps.recoveryQueue,
  });
  return { coordinator, persistence, recovery };
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
  personalityLoader: IPersonalityLoader;
  replyResolver: ReplyResolutionService;
  coordinator: MultiTagCoordinator;
  personalityHandler: PersonalityMessageHandler;
  multiTagPersistence: MultiTagPersistence;
}): IMessageProcessor[] {
  return [
    new BotMessageFilter(),
    new DenylistFilter(deps.denylistCache),
    new EmptyMessageFilter(),
    new VoiceMessageProcessor(deps.voiceTranscription, deps.personalityLoader),
    new PersonalityTriggerProcessor({
      personalityService: deps.personalityLoader,
      replyResolver: deps.replyResolver,
      coordinator: deps.coordinator,
    }),
    new DMSessionProcessor(
      deps.personalityLoader,
      deps.personalityHandler,
      deps.multiTagPersistence
    ),
    new BotMentionProcessor(),
  ];
}

/**
 * Build the full message-handling stack: the Chain-of-Responsibility processor
 * chain + the MessageHandler that drives it and delivers async job results
 * (including late-result recovery, which needs the personality loader + Discord
 * client to reconstruct a follow-up send). Bundles both because the processor
 * chain has exactly one consumer — the handler — so they're a single concern.
 */
export function buildMessageHandler(deps: {
  // Processor-chain deps
  denylistCache: DenylistCache;
  voiceTranscription: VoiceTranscriptionService;
  personalityLoader: IPersonalityLoader;
  replyResolver: ReplyResolutionService;
  personalityHandler: PersonalityMessageHandler;
  multiTagPersistence: MultiTagPersistence;
  // Handler deps
  responseSender: DiscordResponseSender;
  persistence: ConversationPersistence;
  jobTracker: JobTracker;
  slotDelivery: SlotDeliveryService;
  coordinator: MultiTagCoordinator;
  personalityService: IPersonalityLoader;
  client: Client;
}): MessageHandler {
  const processors = buildProcessorChain({
    denylistCache: deps.denylistCache,
    voiceTranscription: deps.voiceTranscription,
    personalityLoader: deps.personalityLoader,
    replyResolver: deps.replyResolver,
    coordinator: deps.coordinator,
    personalityHandler: deps.personalityHandler,
    multiTagPersistence: deps.multiTagPersistence,
  });
  return new MessageHandler({
    processors,
    responseSender: deps.responseSender,
    persistence: deps.persistence,
    jobTracker: deps.jobTracker,
    slotDelivery: deps.slotDelivery,
    coordinator: deps.coordinator,
    personalityService: deps.personalityService,
    client: deps.client,
  });
}
