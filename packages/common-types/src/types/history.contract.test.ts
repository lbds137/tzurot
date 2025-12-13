/**
 * History API Endpoint Contract Tests
 *
 * These tests verify the contract between bot-client (API consumer) and
 * api-gateway (API provider) for the /user/history/* endpoints.
 *
 * WHY THIS EXISTS:
 * - History endpoints manage STM (Short-Term Memory) via epoch-based filtering
 * - Schema changes could silently break the bot-client ↔ api-gateway contract
 * - These tests catch those breaks at build time
 *
 * ENDPOINTS COVERED:
 * - POST /user/history/clear - Set context epoch (soft reset)
 * - POST /user/history/undo - Restore previous epoch
 * - GET /user/history/stats - Get history statistics
 * - DELETE /user/history/hard-delete - Permanently delete history
 */

import { describe, it, expect } from 'vitest';
import {
  historyClearRequestSchema,
  historyClearResponseSchema,
  historyUndoRequestSchema,
  historyUndoResponseSchema,
  historyStatsQuerySchema,
  historyStatsResponseSchema,
  historyHardDeleteRequestSchema,
  historyHardDeleteResponseSchema,
  type HistoryClearRequest,
  type HistoryClearResponse,
  type HistoryUndoRequest,
  type HistoryUndoResponse,
  type HistoryStatsQuery,
  type HistoryStatsResponse,
  type HistoryHardDeleteRequest,
  type HistoryHardDeleteResponse,
} from './api-types.js';

describe('History API Endpoint Contract Tests', () => {
  describe('POST /user/history/clear - Request Schema', () => {
    it('should validate a valid clear request', () => {
      const validRequest: HistoryClearRequest = {
        personalitySlug: 'lilith',
      };

      const result = historyClearRequestSchema.safeParse(validRequest);
      expect(result.success).toBe(true);
    });

    it('should reject empty personalitySlug', () => {
      const invalidRequest = {
        personalitySlug: '',
      };

      const result = historyClearRequestSchema.safeParse(invalidRequest);
      expect(result.success).toBe(false);
    });

    it('should reject missing personalitySlug', () => {
      const invalidRequest = {};

      const result = historyClearRequestSchema.safeParse(invalidRequest);
      expect(result.success).toBe(false);
    });
  });

  describe('POST /user/history/clear - Response Schema', () => {
    it('should validate a successful clear response', () => {
      const validResponse: HistoryClearResponse = {
        success: true,
        epoch: '2025-12-13T10:30:00.000Z',
        canUndo: false,
        message:
          'Conversation context cleared. Previous messages will not be included in AI context.',
      };

      const result = historyClearResponseSchema.safeParse(validResponse);
      expect(result.success).toBe(true);
    });

    it('should validate clear response with canUndo true', () => {
      const validResponse: HistoryClearResponse = {
        success: true,
        epoch: '2025-12-13T10:30:00.000Z',
        canUndo: true,
        message:
          'Conversation context cleared. Previous messages will not be included in AI context.',
      };

      const result = historyClearResponseSchema.safeParse(validResponse);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.canUndo).toBe(true);
      }
    });

    it('should reject response missing required fields', () => {
      const invalidResponse = {
        success: true,
        epoch: '2025-12-13T10:30:00.000Z',
        // Missing: canUndo, message
      };

      const result = historyClearResponseSchema.safeParse(invalidResponse);
      expect(result.success).toBe(false);
    });
  });

  describe('POST /user/history/undo - Request Schema', () => {
    it('should validate a valid undo request', () => {
      const validRequest: HistoryUndoRequest = {
        personalitySlug: 'lilith',
      };

      const result = historyUndoRequestSchema.safeParse(validRequest);
      expect(result.success).toBe(true);
    });

    it('should reject empty personalitySlug', () => {
      const invalidRequest = {
        personalitySlug: '',
      };

      const result = historyUndoRequestSchema.safeParse(invalidRequest);
      expect(result.success).toBe(false);
    });
  });

  describe('POST /user/history/undo - Response Schema', () => {
    it('should validate a successful undo response', () => {
      const validResponse: HistoryUndoResponse = {
        success: true,
        restoredEpoch: '2025-12-12T08:00:00.000Z',
        message: 'Previous context restored. The last clear operation has been undone.',
      };

      const result = historyUndoResponseSchema.safeParse(validResponse);
      expect(result.success).toBe(true);
    });

    it('should validate undo response with null restoredEpoch', () => {
      const validResponse: HistoryUndoResponse = {
        success: true,
        restoredEpoch: null,
        message: 'Previous context restored. The last clear operation has been undone.',
      };

      const result = historyUndoResponseSchema.safeParse(validResponse);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.restoredEpoch).toBeNull();
      }
    });
  });

  describe('GET /user/history/stats - Query Schema', () => {
    it('should validate valid stats query parameters', () => {
      const validQuery: HistoryStatsQuery = {
        personalitySlug: 'lilith',
        channelId: '1234567890',
      };

      const result = historyStatsQuerySchema.safeParse(validQuery);
      expect(result.success).toBe(true);
    });

    it('should reject missing personalitySlug', () => {
      const invalidQuery = {
        channelId: '1234567890',
      };

      const result = historyStatsQuerySchema.safeParse(invalidQuery);
      expect(result.success).toBe(false);
    });

    it('should reject missing channelId', () => {
      const invalidQuery = {
        personalitySlug: 'lilith',
      };

      const result = historyStatsQuerySchema.safeParse(invalidQuery);
      expect(result.success).toBe(false);
    });

    it('should reject empty personalitySlug', () => {
      const invalidQuery = {
        personalitySlug: '',
        channelId: '1234567890',
      };

      const result = historyStatsQuerySchema.safeParse(invalidQuery);
      expect(result.success).toBe(false);
    });
  });

  describe('GET /user/history/stats - Response Schema', () => {
    it('should validate a full stats response', () => {
      const validResponse: HistoryStatsResponse = {
        channelId: '1234567890',
        personalitySlug: 'lilith',
        visible: {
          totalMessages: 10,
          userMessages: 5,
          assistantMessages: 5,
          oldestMessage: '2025-12-10T08:00:00.000Z',
          newestMessage: '2025-12-13T10:30:00.000Z',
        },
        hidden: {
          count: 3,
        },
        total: {
          totalMessages: 13,
          oldestMessage: '2025-12-01T08:00:00.000Z',
        },
        contextEpoch: '2025-12-10T08:00:00.000Z',
        canUndo: true,
      };

      const result = historyStatsResponseSchema.safeParse(validResponse);
      expect(result.success).toBe(true);
    });

    it('should validate stats response with null dates (no history)', () => {
      const validResponse: HistoryStatsResponse = {
        channelId: '1234567890',
        personalitySlug: 'lilith',
        visible: {
          totalMessages: 0,
          userMessages: 0,
          assistantMessages: 0,
          oldestMessage: null,
          newestMessage: null,
        },
        hidden: {
          count: 0,
        },
        total: {
          totalMessages: 0,
          oldestMessage: null,
        },
        contextEpoch: null,
        canUndo: false,
      };

      const result = historyStatsResponseSchema.safeParse(validResponse);
      expect(result.success).toBe(true);
    });

    it('should validate stats response with epoch set but no hidden messages', () => {
      const validResponse: HistoryStatsResponse = {
        channelId: '1234567890',
        personalitySlug: 'lilith',
        visible: {
          totalMessages: 5,
          userMessages: 3,
          assistantMessages: 2,
          oldestMessage: '2025-12-13T08:00:00.000Z',
          newestMessage: '2025-12-13T10:30:00.000Z',
        },
        hidden: {
          count: 0,
        },
        total: {
          totalMessages: 5,
          oldestMessage: '2025-12-13T08:00:00.000Z',
        },
        contextEpoch: '2025-12-01T00:00:00.000Z',
        canUndo: false,
      };

      const result = historyStatsResponseSchema.safeParse(validResponse);
      expect(result.success).toBe(true);
    });

    it('should reject response missing visible stats', () => {
      const invalidResponse = {
        channelId: '1234567890',
        personalitySlug: 'lilith',
        // Missing: visible
        hidden: { count: 0 },
        total: { totalMessages: 0, oldestMessage: null },
        contextEpoch: null,
        canUndo: false,
      };

      const result = historyStatsResponseSchema.safeParse(invalidResponse);
      expect(result.success).toBe(false);
    });
  });

  describe('DELETE /user/history/hard-delete - Request Schema', () => {
    it('should validate a valid hard-delete request', () => {
      const validRequest: HistoryHardDeleteRequest = {
        personalitySlug: 'lilith',
        channelId: '1234567890',
      };

      const result = historyHardDeleteRequestSchema.safeParse(validRequest);
      expect(result.success).toBe(true);
    });

    it('should reject missing personalitySlug', () => {
      const invalidRequest = {
        channelId: '1234567890',
      };

      const result = historyHardDeleteRequestSchema.safeParse(invalidRequest);
      expect(result.success).toBe(false);
    });

    it('should reject missing channelId', () => {
      const invalidRequest = {
        personalitySlug: 'lilith',
      };

      const result = historyHardDeleteRequestSchema.safeParse(invalidRequest);
      expect(result.success).toBe(false);
    });

    it('should reject empty strings', () => {
      const invalidRequest = {
        personalitySlug: '',
        channelId: '',
      };

      const result = historyHardDeleteRequestSchema.safeParse(invalidRequest);
      expect(result.success).toBe(false);
    });
  });

  describe('DELETE /user/history/hard-delete - Response Schema', () => {
    it('should validate a successful hard-delete response', () => {
      const validResponse: HistoryHardDeleteResponse = {
        success: true,
        deletedCount: 15,
        message: 'Permanently deleted 15 messages from conversation history.',
      };

      const result = historyHardDeleteResponseSchema.safeParse(validResponse);
      expect(result.success).toBe(true);
    });

    it('should validate hard-delete response with zero deleted', () => {
      const validResponse: HistoryHardDeleteResponse = {
        success: true,
        deletedCount: 0,
        message: 'Permanently deleted 0 messages from conversation history.',
      };

      const result = historyHardDeleteResponseSchema.safeParse(validResponse);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.deletedCount).toBe(0);
      }
    });

    it('should validate hard-delete response with single message', () => {
      const validResponse: HistoryHardDeleteResponse = {
        success: true,
        deletedCount: 1,
        message: 'Permanently deleted 1 message from conversation history.',
      };

      const result = historyHardDeleteResponseSchema.safeParse(validResponse);
      expect(result.success).toBe(true);
    });
  });

  describe('Producer-Consumer Contract', () => {
    it('should document the history API contract: bot-client ↔ api-gateway', () => {
      // This test serves as documentation:
      //
      // PRODUCER (bot-client - slash commands):
      // - /history clear <personality> → POST /user/history/clear
      // - /history undo <personality> → POST /user/history/undo
      // - /history stats <personality> → GET /user/history/stats
      // - /history hard-delete <personality> → DELETE /user/history/hard-delete
      //
      // CONSUMER (api-gateway - history routes):
      // - Validates requests against Zod schemas
      // - Manages epoch timestamps in UserPersonalityConfig
      // - Returns standardized responses
      //
      // CONTRACT:
      // - All requests validated by shared Zod schemas
      // - Timestamps are ISO 8601 strings
      // - personalitySlug is used (not personality ID) for user-facing API
      // - channelId is Discord channel ID string
      //
      // EPOCH-BASED STM:
      // - Context "clear" sets lastContextReset = now
      // - Messages before epoch are hidden from AI but preserved
      // - Single-level undo via previousContextReset
      // - Hard-delete is permanent and irreversible

      expect(true).toBe(true); // Documentation test always passes
    });
  });
});
