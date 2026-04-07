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
  fetchPageWithEmptyFallback,
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
        pageSize: 5,
      };

      await saveMemoryListSession({
        userId: 'user-2',
        messageId: 'msg-2',
        channelId: 'ch-2',
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
        kind: 'browse',
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
        kind: 'browse',
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
          pageSize: 5,
        },
      });

      await updateMemoryListSessionPage({
        userId: 'user-2',
        messageId: 'msg-2',
        kind: 'search',
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
          pageSize: 5,
        })
      );
    });
  });

  describe('fetchPageWithEmptyFallback', () => {
    it('returns the initial page when it has results', async () => {
      const fetchPage = vi.fn().mockResolvedValue({ items: [1, 2, 3] });

      const result = await fetchPageWithEmptyFallback({
        currentPage: 2,
        fetchPage,
        isEmpty: d => (d as { items: number[] }).items.length === 0,
      });

      expect(result).toEqual({ data: { items: [1, 2, 3] }, page: 2, steppedBack: false });
      expect(fetchPage).toHaveBeenCalledTimes(1);
      expect(fetchPage).toHaveBeenCalledWith(2);
    });

    it('steps back one page when current page is empty and page > 0', async () => {
      const fetchPage = vi
        .fn()
        .mockResolvedValueOnce({ items: [] }) // page 2 → empty
        .mockResolvedValueOnce({ items: [9, 10] }); // page 1 → has data

      const result = await fetchPageWithEmptyFallback({
        currentPage: 2,
        fetchPage,
        isEmpty: d => (d as { items: number[] }).items.length === 0,
      });

      expect(result).toEqual({ data: { items: [9, 10] }, page: 1, steppedBack: true });
      expect(fetchPage).toHaveBeenCalledTimes(2);
      expect(fetchPage).toHaveBeenNthCalledWith(1, 2);
      expect(fetchPage).toHaveBeenNthCalledWith(2, 1);
    });

    it('does NOT step back from page 0 when empty (nowhere to go)', async () => {
      const fetchPage = vi.fn().mockResolvedValue({ items: [] });

      const result = await fetchPageWithEmptyFallback({
        currentPage: 0,
        fetchPage,
        isEmpty: d => (d as { items: number[] }).items.length === 0,
      });

      expect(result).toEqual({ data: { items: [] }, page: 0, steppedBack: false });
      expect(fetchPage).toHaveBeenCalledTimes(1);
    });

    it('returns null when the initial fetch fails', async () => {
      const fetchPage = vi.fn().mockResolvedValue(null);

      const result = await fetchPageWithEmptyFallback({
        currentPage: 2,
        fetchPage,
        isEmpty: () => false,
      });

      expect(result).toBeNull();
      expect(fetchPage).toHaveBeenCalledTimes(1);
    });

    it('returns null when the retry fetch fails', async () => {
      const fetchPage = vi
        .fn()
        .mockResolvedValueOnce({ items: [] }) // initial returns empty
        .mockResolvedValueOnce(null); // retry fails

      const result = await fetchPageWithEmptyFallback({
        currentPage: 3,
        fetchPage,
        isEmpty: d => (d as { items: number[] }).items.length === 0,
      });

      expect(result).toBeNull();
      expect(fetchPage).toHaveBeenCalledTimes(2);
    });
  });
});
