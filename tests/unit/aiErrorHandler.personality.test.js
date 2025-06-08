/**
 * Tests for personality-specific error messages in aiErrorHandler
 */

// Mock dependencies
jest.mock('../../src/logger');
jest.mock('../../src/utils/errorTracker', () => ({
  ErrorCategory: {
    API_CONTENT: 'API_CONTENT',
  },
  trackError: jest.fn(),
}));

jest.mock('../../src/core/personality', () => ({
  getPersonality: jest.fn(),
}));

const logger = require('../../src/logger');
const { getPersonality } = require('../../src/core/personality');
const { analyzeErrorAndGenerateMessage } = require('../../src/utils/aiErrorHandler');

describe('AI Error Handler - Personality-Specific Messages', () => {
  const mockAddToBlackoutList = jest.fn();
  const mockContext = { userId: 'test-user-123', channelId: 'test-channel-123' };

  beforeEach(() => {
    jest.clearAllMocks();
    // Set up logger mock
    logger.info = jest.fn();
    logger.debug = jest.fn();
    logger.error = jest.fn();
  });

  describe('Personality error messages', () => {
    it('should use personality error message when available', async () => {
      // Mock personality with error message
      getPersonality.mockResolvedValue({
        fullName: 'test-personality',
        errorMessage: '*sighs dramatically* Something went wrong! ||*(an error has occurred)*||',
      });

      const result = await analyzeErrorAndGenerateMessage(
        'NoneType object has no attribute',
        'test-personality',
        mockContext,
        mockAddToBlackoutList
      );

      // Should replace the marker with reference ID
      expect(result).toMatch(/\*sighs dramatically\* Something went wrong! \|\|\*\(an error has occurred; reference: \w+\)\*\|\|/);
      expect(logger.info).toHaveBeenCalledWith(
        '[AIErrorHandler] Using personality-specific error message for test-personality'
      );
    });

    it('should append error marker if personality message does not have one', async () => {
      // Mock personality with error message without marker
      getPersonality.mockResolvedValue({
        fullName: 'test-personality',
        errorMessage: 'Oops! My circuits are fried!',
      });

      const result = await analyzeErrorAndGenerateMessage(
        'NoneType object has no attribute',
        'test-personality',
        mockContext,
        mockAddToBlackoutList
      );

      // Should append the marker with reference ID
      expect(result).toMatch(/Oops! My circuits are fried! \|\|\*\(an error has occurred; reference: \w+\)\*\|\|/);
    });

    it('should handle personality error messages with different spoiler patterns', async () => {
      // Mock personality with different spoiler pattern
      getPersonality.mockResolvedValue({
        fullName: 'test-personality',
        errorMessage: 'Error detected! ||*(system malfunction)*||',
      });

      const result = await analyzeErrorAndGenerateMessage(
        'NoneType object has no attribute',
        'test-personality',
        mockContext,
        mockAddToBlackoutList
      );

      // Should update the existing spoiler pattern with reference
      expect(result).toMatch(/Error detected! \|\|\*\(system malfunction; reference: \w+\)\*\|\|/);
    });

    it('should fall back to default messages when personality has no error message', async () => {
      // Mock personality without error message
      getPersonality.mockResolvedValue({
        fullName: 'test-personality',
        displayName: 'Test',
      });

      const result = await analyzeErrorAndGenerateMessage(
        'NoneType object has no attribute',
        'test-personality',
        mockContext,
        mockAddToBlackoutList
      );

      // Should use default message
      expect(result).toMatch(/I encountered a processing error.*\|\|\(Reference: \w+\)\|\|/);
    });

    it('should fall back to default messages when personality is not found', async () => {
      // Mock no personality found
      getPersonality.mockResolvedValue(null);

      const result = await analyzeErrorAndGenerateMessage(
        '',
        'unknown-personality',
        mockContext,
        mockAddToBlackoutList
      );

      // Should use default empty response message
      expect(result).toMatch(/Hmm, I couldn't generate a response.*\|\|\(Reference: \w+\)\|\|/);
    });

    it('should handle errors when fetching personality data', async () => {
      // Mock error when getting personality
      getPersonality.mockRejectedValue(new Error('Database error'));

      const result = await analyzeErrorAndGenerateMessage(
        'rate limit',
        'test-personality',
        mockContext,
        mockAddToBlackoutList
      );

      // Should fall back to default message
      expect(result).toMatch(/I'm getting too many requests.*\|\|\(Reference: \w+\)\|\|/);
      expect(logger.debug).toHaveBeenCalledWith(
        '[AIErrorHandler] Could not fetch personality data: Database error'
      );
    });

    it('should generate unique reference IDs for each error', async () => {
      getPersonality.mockResolvedValue({
        fullName: 'test-personality',
        errorMessage: 'Error! ||*(an error has occurred)*||',
      });

      const result1 = await analyzeErrorAndGenerateMessage(
        'error',
        'test-personality',
        mockContext,
        mockAddToBlackoutList
      );
      const result2 = await analyzeErrorAndGenerateMessage(
        'error',
        'test-personality',
        mockContext,
        mockAddToBlackoutList
      );

      // Extract reference IDs
      const ref1 = result1.match(/reference: (\w+)/)[1];
      const ref2 = result2.match(/reference: (\w+)/)[1];

      expect(ref1).not.toBe(ref2);
    });
  });

  describe('Error type detection with personality messages', () => {
    beforeEach(() => {
      // Set up personality with error message
      getPersonality.mockResolvedValue({
        fullName: 'test-personality',
        errorMessage: 'Oops! Something broke! ||*(an error has occurred)*||',
      });
    });

    it('should use personality message for attribute errors', async () => {
      const result = await analyzeErrorAndGenerateMessage(
        "AttributeError: 'NoneType' object has no attribute 'text'",
        'test-personality',
        mockContext,
        mockAddToBlackoutList
      );

      expect(result).toMatch(/Oops! Something broke!/);
      expect(mockAddToBlackoutList).toHaveBeenCalledWith(
        'test-personality',
        mockContext,
        5 * 60 * 1000 // Technical errors get 5 minutes
      );
    });

    it('should use personality message for empty responses', async () => {
      const result = await analyzeErrorAndGenerateMessage(
        '',
        'test-personality',
        mockContext,
        mockAddToBlackoutList
      );

      expect(result).toMatch(/Oops! Something broke!/);
      expect(mockAddToBlackoutList).toHaveBeenCalledWith(
        'test-personality',
        mockContext,
        30 * 1000 // User-friendly errors get 30 seconds
      );
    });

    it('should use personality message with existing error marker for empty responses', async () => {
      // This is the specific bug case - personality already has the error marker
      getPersonality.mockResolvedValue({
        fullName: 'test-personality',
        errorMessage: 'My circuits are fried! ||*(an error has occurred)*||',
      });

      const result = await analyzeErrorAndGenerateMessage(
        '', // empty response
        'test-personality',
        mockContext,
        mockAddToBlackoutList
      );

      // Should use personality message and replace the marker with reference
      expect(result).toMatch(/My circuits are fried! \|\|\*\(an error has occurred; reference: \w+\)\*\|\|/);
      expect(result).not.toContain('Hmm, I couldn\'t generate a response'); // Should NOT use default
      expect(logger.info).toHaveBeenCalledWith(
        '[AIErrorHandler] Using personality-specific error message for test-personality'
      );
    });

    it('should use personality message for rate limit errors', async () => {
      const result = await analyzeErrorAndGenerateMessage(
        'Too many requests. Rate limit exceeded.',
        'test-personality',
        mockContext,
        mockAddToBlackoutList
      );

      expect(result).toMatch(/Oops! Something broke!/);
      expect(mockAddToBlackoutList).toHaveBeenCalledWith(
        'test-personality',
        mockContext,
        30 * 1000
      );
    });
  });
});