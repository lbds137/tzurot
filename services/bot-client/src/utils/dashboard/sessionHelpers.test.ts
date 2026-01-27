/**
 * Tests for Dashboard Session Helpers
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageFlags } from 'discord.js';
import type { ButtonInteraction, StringSelectMenuInteraction } from 'discord.js';
import {
  fetchOrCreateSession,
  getSessionOrExpired,
  getSessionDataOrReply,
} from './sessionHelpers.js';
import * as SessionManagerModule from './SessionManager.js';

// Mock the session manager
vi.mock('./SessionManager.js', () => ({
  getSessionManager: vi.fn(),
}));

describe('sessionHelpers', () => {
  const mockSessionManager = {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
    update: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(SessionManagerModule.getSessionManager).mockReturnValue(
      mockSessionManager as unknown as SessionManagerModule.DashboardSessionManager
    );
  });

  describe('fetchOrCreateSession', () => {
    it('should return cached data when session exists', async () => {
      const sessionData = { name: 'Cached Persona' };
      mockSessionManager.get.mockResolvedValue({ data: sessionData });

      const result = await fetchOrCreateSession({
        userId: 'user-123',
        entityType: 'persona',
        entityId: 'entity-456',
        fetchFn: vi.fn(),
        transformFn: (d: unknown) => d,
      });

      expect(result).toEqual({
        success: true,
        data: sessionData,
        fromCache: true,
      });
      expect(mockSessionManager.get).toHaveBeenCalledWith('user-123', 'persona', 'entity-456');
    });

    it('should fetch and transform data when session does not exist', async () => {
      mockSessionManager.get.mockResolvedValue(null);
      const rawData = { id: '123', rawName: 'Test' };
      const transformedData = { name: 'Transformed Test' };
      const fetchFn = vi.fn().mockResolvedValue(rawData);
      const transformFn = vi.fn().mockReturnValue(transformedData);

      const result = await fetchOrCreateSession({
        userId: 'user-123',
        entityType: 'persona',
        entityId: 'entity-456',
        fetchFn,
        transformFn,
      });

      expect(result).toEqual({
        success: true,
        data: transformedData,
        fromCache: false,
      });
      expect(fetchFn).toHaveBeenCalled();
      expect(transformFn).toHaveBeenCalledWith(rawData);
    });

    it('should return error when fetch returns null', async () => {
      mockSessionManager.get.mockResolvedValue(null);
      const fetchFn = vi.fn().mockResolvedValue(null);

      const result = await fetchOrCreateSession({
        userId: 'user-123',
        entityType: 'persona',
        entityId: 'entity-456',
        fetchFn,
        transformFn: (d: unknown) => d,
      });

      expect(result).toEqual({
        success: false,
        error: 'not_found',
      });
    });

    it('should create session when interaction is provided', async () => {
      mockSessionManager.get.mockResolvedValue(null);
      const rawData = { name: 'Test' };
      const fetchFn = vi.fn().mockResolvedValue(rawData);
      const interaction = {
        message: { id: 'msg-123' },
        channelId: 'channel-456',
      } as unknown as StringSelectMenuInteraction;

      await fetchOrCreateSession({
        userId: 'user-123',
        entityType: 'persona',
        entityId: 'entity-456',
        fetchFn,
        transformFn: (d: unknown) => d,
        interaction,
      });

      expect(mockSessionManager.set).toHaveBeenCalledWith({
        userId: 'user-123',
        entityType: 'persona',
        entityId: 'entity-456',
        data: rawData,
        messageId: 'msg-123',
        channelId: 'channel-456',
      });
    });
  });

  describe('getSessionOrExpired', () => {
    it('should return session when it exists', async () => {
      const session = { data: { name: 'Test' } };
      mockSessionManager.get.mockResolvedValue(session);
      const interaction = {
        user: { id: 'user-123' },
        editReply: vi.fn(),
      } as unknown as ButtonInteraction;

      const result = await getSessionOrExpired(
        interaction,
        'persona',
        'entity-456',
        '/persona browse'
      );

      expect(result).toEqual(session);
      expect(interaction.editReply).not.toHaveBeenCalled();
    });

    it('should reply with expired message and return null when session is missing', async () => {
      mockSessionManager.get.mockResolvedValue(null);
      const interaction = {
        user: { id: 'user-123' },
        editReply: vi.fn(),
      } as unknown as ButtonInteraction;

      const result = await getSessionOrExpired(
        interaction,
        'persona',
        'entity-456',
        '/persona browse'
      );

      expect(result).toBeNull();
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: '⏰ Session expired. Please run `/persona browse` again.',
        embeds: [],
        components: [],
      });
    });
  });

  describe('getSessionDataOrReply', () => {
    it('should return session data when it exists', async () => {
      const sessionData = { name: 'Test' };
      mockSessionManager.get.mockResolvedValue({ data: sessionData });
      const interaction = {
        user: { id: 'user-123' },
        reply: vi.fn(),
      } as unknown as ButtonInteraction;

      const result = await getSessionDataOrReply(interaction, 'preset', 'preset-123');

      expect(result).toEqual(sessionData);
      expect(interaction.reply).not.toHaveBeenCalled();
    });

    it('should reply with error and return null when session is missing', async () => {
      mockSessionManager.get.mockResolvedValue(null);
      const interaction = {
        user: { id: 'user-123' },
        reply: vi.fn(),
      } as unknown as ButtonInteraction;

      const result = await getSessionDataOrReply(interaction, 'preset', 'preset-123');

      expect(result).toBeNull();
      expect(interaction.reply).toHaveBeenCalledWith({
        content: '⏰ Session expired. Please run the command again.',
        flags: MessageFlags.Ephemeral,
      });
    });
  });
});
