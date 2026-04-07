import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSet, mockGet, mockUpdate, mockFindByMessageId } = vi.hoisted(() => ({
  mockSet: vi.fn(),
  mockGet: vi.fn(),
  mockUpdate: vi.fn(),
  mockFindByMessageId: vi.fn(),
}));

vi.mock('../../utils/dashboard/index.js', () => ({
  getSessionManager: () => ({
    set: mockSet,
    get: mockGet,
    update: mockUpdate,
    findByMessageId: mockFindByMessageId,
  }),
}));

import {
  saveMemoryListSession,
  findMemoryListSessionByMessage,
  updateMemoryListSessionPage,
  MEMORY_BROWSE_ENTITY_TYPE,
  MEMORY_SEARCH_ENTITY_TYPE,
  type MemoryListSession,
} from './browseSession.js';

describe('browseSession', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('saveMemoryListSession', () => {
    it('persists a browse session with messageId as entityId', async () => {
      mockSet.mockResolvedValue({});
      const data: MemoryListSession = {
        kind: 'browse',
        personalityId: 'p-1',
        currentPage: 0,
      };

      await saveMemoryListSession({
        userId: 'user-1',
        messageId: 'msg-1',
        channelId: 'ch-1',
        entityType: MEMORY_BROWSE_ENTITY_TYPE,
        data,
      });

      expect(mockSet).toHaveBeenCalledWith({
        userId: 'user-1',
        entityType: MEMORY_BROWSE_ENTITY_TYPE,
        entityId: 'msg-1',
        data,
        messageId: 'msg-1',
        channelId: 'ch-1',
      });
    });

    it('persists a search session with search query', async () => {
      mockSet.mockResolvedValue({});
      const data: MemoryListSession = {
        kind: 'search',
        personalityId: 'p-2',
        currentPage: 0,
        searchQuery: 'love',
      };

      await saveMemoryListSession({
        userId: 'user-2',
        messageId: 'msg-2',
        channelId: 'ch-2',
        entityType: MEMORY_SEARCH_ENTITY_TYPE,
        data,
      });

      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: MEMORY_SEARCH_ENTITY_TYPE,
          entityId: 'msg-2',
          data: expect.objectContaining({ kind: 'search', searchQuery: 'love' }),
        })
      );
    });
  });

  describe('findMemoryListSessionByMessage', () => {
    it('returns the session when one exists', async () => {
      const session = { data: { kind: 'browse', currentPage: 2 } };
      mockFindByMessageId.mockResolvedValue(session);

      const result = await findMemoryListSessionByMessage('msg-1');

      expect(result).toBe(session);
      expect(mockFindByMessageId).toHaveBeenCalledWith('msg-1');
    });

    it('returns null when session does not exist', async () => {
      mockFindByMessageId.mockResolvedValue(null);

      const result = await findMemoryListSessionByMessage('msg-missing');

      expect(result).toBeNull();
    });
  });

  describe('updateMemoryListSessionPage', () => {
    it('updates the current page when session exists', async () => {
      mockGet.mockResolvedValue({
        data: { kind: 'browse', personalityId: 'p-1', currentPage: 0 },
      });

      const updated = await updateMemoryListSessionPage({
        userId: 'user-1',
        messageId: 'msg-1',
        entityType: MEMORY_BROWSE_ENTITY_TYPE,
        newPage: 3,
      });

      expect(updated).toBe(true);
      expect(mockUpdate).toHaveBeenCalledWith(
        'user-1',
        MEMORY_BROWSE_ENTITY_TYPE,
        'msg-1',
        expect.objectContaining({ currentPage: 3, personalityId: 'p-1' })
      );
    });

    it('returns false when session does not exist', async () => {
      mockGet.mockResolvedValue(null);

      const result = await updateMemoryListSessionPage({
        userId: 'user-1',
        messageId: 'msg-missing',
        entityType: MEMORY_BROWSE_ENTITY_TYPE,
        newPage: 1,
      });

      expect(result).toBe(false);
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('preserves existing session fields when updating page', async () => {
      mockGet.mockResolvedValue({
        data: {
          kind: 'search',
          personalityId: 'p-2',
          currentPage: 0,
          searchQuery: 'thoughts',
        },
      });

      await updateMemoryListSessionPage({
        userId: 'user-2',
        messageId: 'msg-2',
        entityType: MEMORY_SEARCH_ENTITY_TYPE,
        newPage: 1,
      });

      expect(mockUpdate).toHaveBeenCalledWith(
        'user-2',
        MEMORY_SEARCH_ENTITY_TYPE,
        'msg-2',
        expect.objectContaining({
          kind: 'search',
          personalityId: 'p-2',
          currentPage: 1,
          searchQuery: 'thoughts',
        })
      );
    });
  });
});
