/**
 * Dashboard Session Helpers
 *
 * Utilities for managing dashboard sessions - fetching, creating,
 * and handling session state across dashboard interactions.
 */

import { MessageFlags } from 'discord.js';
import type {
  ButtonInteraction,
  StringSelectMenuInteraction,
  ModalSubmitInteraction,
} from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import { getSessionManager } from './SessionManager.js';
import { type DashboardSession } from './types.js';
import { DASHBOARD_MESSAGES, formatSessionExpiredMessage } from './messages.js';

const logger = createLogger('session-helpers');

/**
 * Options for fetchOrCreateSession
 */
interface FetchOrCreateOptions<T, R> {
  /** User ID */
  userId: string;
  /** Entity type (e.g., 'persona', 'character', 'preset') */
  entityType: string;
  /** Entity ID */
  entityId: string;
  /** Function to fetch entity data if not in session */
  fetchFn: () => Promise<R | null>;
  /** Function to transform fetched data to session format */
  transformFn: (data: R) => T;
  /** Interaction for creating new session (optional - for message/channel ID) */
  interaction?: StringSelectMenuInteraction | ButtonInteraction;
}

/**
 * Result of fetchOrCreateSession
 */
interface FetchOrCreateResult<T> {
  /** Whether operation succeeded */
  success: true;
  /** Session data */
  data: T;
  /** Whether this was from an existing session */
  fromCache: boolean;
}

/**
 * Error result when fetch fails
 */
interface FetchOrCreateError {
  success: false;
  error: 'not_found';
}

/**
 * Fetch data from session or create new session by fetching from API.
 *
 * @returns Session data or error
 *
 * @example
 * ```typescript
 * const result = await fetchOrCreateSession({
 *   userId: interaction.user.id,
 *   entityType: 'persona',
 *   entityId,
 *   fetchFn: () => fetchPersona(entityId, userId),
 *   transformFn: flattenPersonaData,
 *   interaction,
 * });
 *
 * if (!result.success) {
 *   await interaction.reply({ content: '❌ Persona not found.', flags: MessageFlags.Ephemeral });
 *   return;
 * }
 *
 * const personaData = result.data;
 * ```
 */
export async function fetchOrCreateSession<T, R = T>(
  options: FetchOrCreateOptions<T, R>
): Promise<FetchOrCreateResult<T> | FetchOrCreateError> {
  const { userId, entityType, entityId, fetchFn, transformFn, interaction } = options;
  const sessionManager = getSessionManager();

  // Try to get from existing session
  const session = await sessionManager.get<T>(userId, entityType, entityId);
  if (session !== null) {
    return { success: true, data: session.data, fromCache: true };
  }

  // Fetch fresh data
  const rawData = await fetchFn();
  if (rawData === null) {
    return { success: false, error: 'not_found' };
  }

  const data = transformFn(rawData);

  // Create session if interaction provided
  if (interaction !== undefined) {
    await sessionManager.set({
      userId,
      entityType,
      entityId,
      data,
      messageId: interaction.message.id,
      channelId: interaction.channelId,
    });
  }

  return { success: true, data, fromCache: false };
}

/**
 * Defer the interaction and get session, or show expired message.
 * Combines the common deferUpdate + getSessionOrExpired pattern
 * used across many dashboard button handlers.
 *
 * @returns Session or null if expired (interaction is deferred either way)
 *
 * @example
 * ```typescript
 * const session = await requireDeferredSession<FlattenedPresetData>(
 *   interaction, 'preset', entityId, '/preset browse'
 * );
 * if (session === null) return;
 *
 * // Use session.data (interaction is already deferred)
 * ```
 */
export async function requireDeferredSession<T>(
  interaction: ButtonInteraction,
  entityType: string,
  entityId: string,
  command: string
): Promise<DashboardSession<T> | null> {
  await interaction.deferUpdate();
  return getSessionOrExpired<T>(interaction, entityType, entityId, command);
}

/**
 * Get session or reply with expired message.
 * Returns null if session is expired (and reply is sent).
 *
 * @param interaction - The interaction to reply to
 * @param entityType - Entity type
 * @param entityId - Entity ID
 * @param command - Command hint for retry (e.g., '/persona browse')
 * @returns Session or null if expired
 *
 * @example
 * ```typescript
 * const session = await getSessionOrExpired(interaction, 'persona', entityId, '/persona browse');
 * if (session === null) return;
 *
 * // Use session.data
 * ```
 */
export async function getSessionOrExpired<T>(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  entityType: string,
  entityId: string,
  command: string
): Promise<DashboardSession<T> | null> {
  const sessionManager = getSessionManager();
  const session = await sessionManager.get<T>(interaction.user.id, entityType, entityId);

  if (session === null) {
    logger.warn({ entityType, entityId }, 'Session not found');
    await interaction.editReply({
      content: formatSessionExpiredMessage(command),
      embeds: [],
      components: [],
    });
    return null;
  }

  return session;
}

/**
 * Get session data or reply with error.
 * Simpler version that just needs the data, not full session.
 * Uses interaction.reply() for non-deferred interactions.
 *
 * @returns Session data or null if expired
 */
export async function getSessionDataOrReply<T>(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  entityType: string,
  entityId: string
): Promise<T | null> {
  const sessionManager = getSessionManager();
  const session = await sessionManager.get<T>(interaction.user.id, entityType, entityId);

  if (session === null) {
    await interaction.reply({
      content: DASHBOARD_MESSAGES.SESSION_EXPIRED,
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }

  return session.data;
}
