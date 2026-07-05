/**
 * Session storage helpers for the settings dashboard.
 *
 * Thin wrappers over the shared Redis-backed SessionManager. Update handlers
 * are NOT session state: they are rebuilt per-interaction by
 * `createSettingsCommandHandlers` (`createUpdateHandler(entityId)`), so
 * nothing handler-shaped is stored here. A previous in-memory Map of
 * per-session handlers was written on every dashboard open and read by
 * nothing — and, being deleted only on the explicit Close path, it leaked a
 * closure for every natively-dismissed dashboard.
 */

import type { SettingsDashboardSession } from './types.js';
import { getSessionManager } from '../SessionManager.js';

export async function storeSession(
  session: SettingsDashboardSession,
  entityType: string
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
}
