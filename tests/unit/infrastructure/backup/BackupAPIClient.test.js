/**
 * Tests for BackupAPIClient infrastructure
 */

const { BackupAPIClient } = require('../../../../src/infrastructure/backup/BackupAPIClient');
const logger = require('../../../../src/logger');

// Mock dependencies
jest.mock('../../../../src/logger');
jest.mock('../../../../config', () => ({
  getPersonalityJargonTerm: jest.fn(),
  getPrivateProfileInfoPath: jest.fn(),
  botConfig: {
    isDevelopment: false,
  },
}));

const { getPersonalityJargonTerm, getPrivateProfileInfoPath } = require('../../../../config');

describe('BackupAPIClient', () => {
  let client;
  let mockFetch;
  let mockScheduler;
  let mockClearScheduler;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock fetch
    mockFetch = jest.fn();

    // Mock schedulers
    mockScheduler = jest.fn((callback, delay) => {
      // Simulate async timeout behavior
      return setTimeout(callback, 0);
    });
    mockClearScheduler = jest.fn();

    // Mock config functions
    getPersonalityJargonTerm.mockReturnValue('personalities');
    getPrivateProfileInfoPath.mockReturnValue('private/profile');

    // Mock environment
    process.env.SERVICE_WEBSITE = 'https://example.com';

    client = new BackupAPIClient({
      apiBaseUrl: 'https://example.com/api',
      timeout: 5000,
      scheduler: mockScheduler,
      clearScheduler: mockClearScheduler,
      fetch: mockFetch,
    });
  });

  afterEach(() => {
    delete process.env.SERVICE_WEBSITE;
  });

  describe('constructor', () => {
    it('should initialize with custom options', () => {
      expect(client.apiBaseUrl).toBe('https://example.com/api');
      expect(client.timeout).toBe(5000);
      expect(client.scheduler).toBe(mockScheduler);
      expect(client.fetch).toBe(mockFetch);
    });

    it('should use defaults when no options provided', () => {
      const defaultClient = new BackupAPIClient();
      expect(defaultClient.apiBaseUrl).toBe('https://example.com/api');
      expect(defaultClient.timeout).toBe(120000); // 2 minutes for large datasets
    });

    it('should handle missing SERVICE_WEBSITE', () => {
      delete process.env.SERVICE_WEBSITE;
      const clientWithoutEnv = new BackupAPIClient();
      expect(clientWithoutEnv.apiBaseUrl).toBeNull();
    });
  });

  describe('fetchPersonalityProfile()', () => {
    it('should fetch personality profile successfully', async () => {
      const profileData = { id: 'test-id', name: 'TestPersonality' };
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue(profileData),
      };
      mockFetch.mockResolvedValue(mockResponse);

      const authData = { cookie: 'session=abc123' };
      const result = await client.fetchPersonalityProfile('TestPersonality', authData);

      expect(result).toEqual(profileData);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/api/private/profile/TestPersonality',
        {
          headers: {
            'User-Agent': 'Tzurot Discord Bot Backup/2.0',
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Cookie: 'session=abc123',
          },
          signal: expect.any(AbortSignal),
        }
      );
      expect(logger.info).toHaveBeenCalledWith(
        '[BackupAPIClient] Fetching profile from: https://example.com/api/private/profile/TestPersonality'
      );
    });
  });

  describe('fetchAllMemories()', () => {
    it('should fetch all memories with pagination', async () => {
      const memories1 = [
        { id: 'mem3', content: 'Memory 3', created_at: 1609459300 },
        { id: 'mem2', content: 'Memory 2', created_at: 1609459200 },
      ];
      const memories2 = [{ id: 'mem1', content: 'Memory 1', created_at: 1609459100 }];

      // First page response
      const response1 = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          items: memories1,
          pagination: { total_pages: 2 },
        }),
      };

      // Second page response
      const response2 = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          items: memories2,
          pagination: { total_pages: 2 },
        }),
      };

      mockFetch.mockResolvedValueOnce(response1).mockResolvedValueOnce(response2);

      const authData = { cookie: 'session=abc123' };
      const result = await client.fetchAllMemories('personality-id', 'TestPersonality', authData);

      expect(result).toHaveLength(3);
      // Should be sorted chronologically (oldest first)
      expect(result[0].id).toBe('mem1');
      expect(result[1].id).toBe('mem2');
      expect(result[2].id).toBe('mem3');

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/api/memory/personality-id?page=1',
        expect.any(Object)
      );
      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/api/memory/personality-id?page=2',
        expect.any(Object)
      );
    });

    it('should handle single page of memories', async () => {
      const memories = [{ id: 'mem1', content: 'Memory 1', created_at: 1609459200 }];
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          items: memories,
          pagination: { total_pages: 1 },
        }),
      };
      mockFetch.mockResolvedValue(mockResponse);

      const authData = { cookie: 'session=abc123' };
      const result = await client.fetchAllMemories('personality-id', 'TestPersonality', authData);

      expect(result).toEqual(memories);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should handle empty memories response', async () => {
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({ items: [] }),
      };
      mockFetch.mockResolvedValue(mockResponse);

      const authData = { cookie: 'session=abc123' };
      const result = await client.fetchAllMemories('personality-id', 'TestPersonality', authData);

      expect(result).toEqual([]);
    });

    it('should handle memories with ISO timestamp format', async () => {
      const memories = [
        { id: 'mem1', content: 'Memory 1', created_at: '2021-01-01T00:00:00.000Z' },
        { id: 'mem2', content: 'Memory 2', created_at: '2021-01-01T00:01:00.000Z' },
      ];
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({ items: memories }),
      };
      mockFetch.mockResolvedValue(mockResponse);

      const authData = { cookie: 'session=abc123' };
      const result = await client.fetchAllMemories('personality-id', 'TestPersonality', authData);

      expect(result).toHaveLength(2);
      // Should be sorted chronologically
      expect(result[0].id).toBe('mem1');
      expect(result[1].id).toBe('mem2');
    });
  });

  describe('fetchKnowledgeData()', () => {
    it('should fetch knowledge data successfully', async () => {
      const knowledgeData = [{ id: 'know1', content: 'Knowledge 1' }];
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue(knowledgeData),
      };
      mockFetch.mockResolvedValue(mockResponse);

      const authData = { cookie: 'session=abc123' };
      const result = await client.fetchKnowledgeData('personality-id', 'TestPersonality', authData);

      expect(result).toEqual(knowledgeData);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/api/personalities/personality-id/story',
        expect.any(Object)
      );
    });

    it('should handle different response formats', async () => {
      const testCases = [
        // Array response
        { response: [{ id: 'know1' }], expected: [{ id: 'know1' }] },
        // Object with items
        { response: { items: [{ id: 'know1' }] }, expected: [{ id: 'know1' }] },
        // Object with story field
        { response: { story: [{ id: 'know1' }] }, expected: [{ id: 'know1' }] },
        // Object with knowledge field
        { response: { knowledge: [{ id: 'know1' }] }, expected: [{ id: 'know1' }] },
        // Single object
        {
          response: { id: 'know1', content: 'Knowledge' },
          expected: [{ id: 'know1', content: 'Knowledge' }],
        },
      ];

      for (const testCase of testCases) {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue(testCase.response),
        });

        const result = await client.fetchKnowledgeData('personality-id', 'TestPersonality', {
          cookie: 'test',
        });
        expect(result).toEqual(testCase.expected);
      }
    });

    it('should handle errors gracefully', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const authData = { cookie: 'session=abc123' };
      const result = await client.fetchKnowledgeData('personality-id', 'TestPersonality', authData);

      expect(result).toEqual([]);
      expect(logger.error).toHaveBeenCalledWith(
        '[BackupAPIClient] Error fetching knowledge for TestPersonality: Network error'
      );
    });

    it('should handle missing jargon term', async () => {
      getPersonalityJargonTerm.mockReturnValue(null);

      const authData = { cookie: 'session=abc123' };
      const result = await client.fetchKnowledgeData('personality-id', 'TestPersonality', authData);

      expect(result).toEqual([]);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('PERSONALITY_JARGON_TERM environment variable not configured')
      );
    });
  });

  describe('fetchTrainingData()', () => {
    it('should fetch training data successfully', async () => {
      const trainingData = [{ id: 'train1', input: 'Input', output: 'Output' }];
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue(trainingData),
      };
      mockFetch.mockResolvedValue(mockResponse);

      const authData = { cookie: 'session=abc123' };
      const result = await client.fetchTrainingData('personality-id', 'TestPersonality', authData);

      expect(result).toEqual(trainingData);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/api/personalities/personality-id/training',
        expect.any(Object)
      );
    });

    it('should handle different response formats', async () => {
      const testCases = [
        // Array response
        { response: [{ id: 'train1' }], expected: [{ id: 'train1' }] },
        // Object with items
        { response: { items: [{ id: 'train1' }] }, expected: [{ id: 'train1' }] },
        // Object with training field
        { response: { training: [{ id: 'train1' }] }, expected: [{ id: 'train1' }] },
        // Single object
        {
          response: { id: 'train1', input: 'Input' },
          expected: [{ id: 'train1', input: 'Input' }],
        },
      ];

      for (const testCase of testCases) {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue(testCase.response),
        });

        const result = await client.fetchTrainingData('personality-id', 'TestPersonality', {
          cookie: 'test',
        });
        expect(result).toEqual(testCase.expected);
      }
    });
  });

  describe('fetchUserPersonalizationData()', () => {
    it('should fetch user personalization data successfully', async () => {
      const personalizationData = { preferences: { theme: 'dark' } };
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue(personalizationData),
      };
      mockFetch.mockResolvedValue(mockResponse);

      const authData = { cookie: 'session=abc123' };
      const result = await client.fetchUserPersonalizationData(
        'personality-id',
        'TestPersonality',
        authData
      );

      expect(result).toEqual(personalizationData);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/api/personalities/personality-id/user',
        expect.any(Object)
      );
    });

    it('should handle empty response', async () => {
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({}),
      };
      mockFetch.mockResolvedValue(mockResponse);

      const authData = { cookie: 'session=abc123' };
      const result = await client.fetchUserPersonalizationData(
        'personality-id',
        'TestPersonality',
        authData
      );

      expect(result).toEqual({});
    });
  });

  describe('fetchChatHistory()', () => {
    it('should fetch complete chat history with pagination', async () => {
      const messages1 = [
        { ts: 1609459300, content: 'Message 3' },
        { ts: 1609459200, content: 'Message 2' },
      ];
      const messages2 = [{ ts: 1609459100, content: 'Message 1' }];

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue(messages1),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue(messages2),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue([]), // Empty response to end pagination
        });

      const authData = { cookie: 'session=abc123' };
      const result = await client.fetchChatHistory('personality-id', 'TestPersonality', authData);

      expect(result).toHaveLength(3);
      // Should be sorted chronologically (oldest first)
      expect(result[0].content).toBe('Message 1');
      expect(result[1].content).toBe('Message 2');
      expect(result[2].content).toBe('Message 3');

      // Check pagination URLs
      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/api/personalities/personality-id/chat/history?limit=50&shape_id=personality-id',
        expect.any(Object)
      );
      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/api/personalities/personality-id/chat/history?limit=50&shape_id=personality-id&before_ts=1609459100',
        expect.any(Object)
      );
    });

    it('should handle empty chat history', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue([]),
      });

      const authData = { cookie: 'session=abc123' };
      const result = await client.fetchChatHistory('personality-id', 'TestPersonality', authData);

      expect(result).toEqual([]);
    });

    it('should handle API errors gracefully', async () => {
      mockFetch.mockRejectedValue(new Error('API error'));

      const authData = { cookie: 'session=abc123' };
      const result = await client.fetchChatHistory('personality-id', 'TestPersonality', authData);

      expect(result).toEqual([]);
      expect(logger.error).toHaveBeenCalledWith(
        '[BackupAPIClient] Error fetching chat history: API error'
      );
    });
  });

  describe('_makeAuthenticatedRequest()', () => {
    it('should make authenticated request with session cookie', async () => {
      const responseData = { success: true };
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue(responseData),
      };
      mockFetch.mockResolvedValue(mockResponse);

      const authData = { cookie: 'session=abc123' };
      const result = await client._makeAuthenticatedRequest(
        'https://api.example.com/test',
        authData
      );

      expect(result).toEqual(responseData);
      expect(mockFetch).toHaveBeenCalledWith('https://api.example.com/test', {
        headers: {
          'User-Agent': 'Tzurot Discord Bot Backup/2.0',
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Cookie: 'session=abc123',
        },
        signal: expect.any(AbortSignal),
      });
    });

    it('should throw error when no cookie provided', async () => {
      const authData = {}; // No cookie

      await expect(
        client._makeAuthenticatedRequest('https://example.com/test', authData)
      ).rejects.toThrow('Session cookie required for backup operations');
    });

    it('should handle HTTP error responses', async () => {
      const mockResponse = {
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      };
      mockFetch.mockResolvedValue(mockResponse);

      const authData = { cookie: 'session=abc123' };

      await expect(
        client._makeAuthenticatedRequest('https://example.com/test', authData)
      ).rejects.toThrow('API error 401: Unauthorized');
    });

    it('should handle timeout errors', async () => {
      // Mock abort error
      const abortError = new Error('Request aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValue(abortError);

      const authData = { cookie: 'session=abc123' };

      await expect(
        client._makeAuthenticatedRequest('https://example.com/test', authData)
      ).rejects.toThrow('Request timed out');
    });

    it('should clear timeout on completion', async () => {
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({}),
      };
      mockFetch.mockResolvedValue(mockResponse);

      const authData = { cookie: 'session=abc123' };
      await client._makeAuthenticatedRequest('https://example.com/test', authData);

      expect(mockClearScheduler).toHaveBeenCalled();
    });

    it('should clear timeout on error', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const authData = { cookie: 'session=abc123' };

      await expect(
        client._makeAuthenticatedRequest('https://example.com/test', authData)
      ).rejects.toThrow('Network error');

      expect(mockClearScheduler).toHaveBeenCalled();
    });
  });

  describe('_getDefaultApiBaseUrl()', () => {
    it('should construct URL from SERVICE_WEBSITE', () => {
      process.env.SERVICE_WEBSITE = 'https://example.com';
      const testClient = new BackupAPIClient();

      expect(testClient._getDefaultApiBaseUrl()).toBe('https://example.com/api');
    });

    it('should return null if SERVICE_WEBSITE not set', () => {
      delete process.env.SERVICE_WEBSITE;
      const testClient = new BackupAPIClient();

      expect(testClient._getDefaultApiBaseUrl()).toBeNull();
    });
  });

  describe('fetchPersonalitiesByCategory()', () => {
    it('should fetch self personalities', async () => {
      const personalities = [
        { id: '123456789012345678', name: 'Personality1', username: 'user1' },
        { id: '223456789012345678', name: 'Personality2', username: 'user2' },
      ];
      
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue(personalities),
      };
      mockFetch.mockResolvedValue(mockResponse);
      
      const authData = { cookie: 'session=abc123' };
      const result = await client.fetchPersonalitiesByCategory('self', authData);
      
      expect(result).toEqual(personalities);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/api/personalities?category=self',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Cookie: 'session=abc123',
          }),
        })
      );
      expect(logger.info).toHaveBeenCalledWith(
        '[BackupAPIClient] Fetching self personalities from: https://example.com/api/personalities?category=self'
      );
      expect(logger.info).toHaveBeenCalledWith(
        '[BackupAPIClient] Retrieved 2 self personalities'
      );
    });
    
    it('should fetch recent personalities', async () => {
      const personalities = [
        { id: '323456789012345678', name: 'Personality3', username: 'user3' },
        { id: '423456789012345678', name: 'Personality4', username: 'user4' },
        { id: '523456789012345678', name: 'Personality5', username: 'user5' },
      ];
      
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue(personalities),
      };
      mockFetch.mockResolvedValue(mockResponse);
      
      const authData = { cookie: 'session=abc123' };
      const result = await client.fetchPersonalitiesByCategory('recent', authData);
      
      expect(result).toEqual(personalities);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/api/personalities?category=recent',
        expect.any(Object)
      );
    });
    
    it('should handle non-array response', async () => {
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({ error: 'Invalid response' }),
      };
      mockFetch.mockResolvedValue(mockResponse);
      
      const authData = { cookie: 'session=abc123' };
      const result = await client.fetchPersonalitiesByCategory('self', authData);
      
      expect(result).toEqual([]);
      expect(logger.error).toHaveBeenCalledWith(
        '[BackupAPIClient] Expected array of personalities, got:',
        'object'
      );
    });
    
    it('should propagate API errors', async () => {
      const mockResponse = {
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: jest.fn().mockResolvedValue({ error: 'Invalid session' }),
      };
      mockFetch.mockResolvedValue(mockResponse);
      
      const authData = { cookie: 'session=abc123' };
      
      await expect(
        client.fetchPersonalitiesByCategory('recent', authData)
      ).rejects.toThrow('API error 401: Unauthorized');
      
      expect(logger.error).toHaveBeenCalledWith(
        '[BackupAPIClient] Error fetching recent personalities:',
        'API error 401: Unauthorized'
      );
    });
  });
});
