/**
 * Session storage helpers for the settings dashboard.
 *
 * Wraps the shared SessionManager with settings-specific metadata
 * (the non-serializable update handler is stored in a separate Map).
 */

import type { SettingsDashboardSession, SettingUpdateHandler } from './types.js';
import { getSessionManager } from '../SessionManager.js';

interface SessionMetadata {
  updateHandler: SettingUpdateHandler;
}

const sessionMetadata = new Map<string, SessionMetadata>();

function getSessionKey(userId: string, entityType: string, entityId: string): string {
  return `${userId}:${entityType}:${entityId}`;
}

export async function storeSession(
  session: SettingsDashboardSession,
  entityType: string,
  updateHandler: SettingUpdateHandler
): Promise<void> {
  const manager = getSessionManager();
  await manager.set({
    userId: session.userId,
    entityType,
    entityId: session.entityId,
    data: session,
    messageId: session.messageId,
    channelId: session.channelId,
  });

  // Store handler separately (can't be serialized)
  const key = getSessionKey(session.userId, entityType, session.entityId);
  sessionMetadata.set(key, { updateHandler });
}

export async function getSession(
  userId: string,
  entityType: string,
  entityId: string
): Promise<SettingsDashboardSession | null> {
  const manager = getSessionManager();
  const dashboardSession = await manager.get<SettingsDashboardSession>(
    userId,
    entityType,
    entityId
  );
  return dashboardSession?.data ?? null;
}

export async function deleteSession(
  userId: string,
  entityType: string,
  entityId: string
): Promise<void> {
  const manager = getSessionManager();
  await manager.delete(userId, entityType, entityId);

  const key = getSessionKey(userId, entityType, entityId);
  sessionMetadata.delete(key);
}

/**
 * Get the update handler for a session
 */
export function getUpdateHandler(
  userId: string,
  entityType: string,
  entityId: string
): SettingUpdateHandler | undefined {
  const key = getSessionKey(userId, entityType, entityId);
  return sessionMetadata.get(key)?.updateHandler;
}
