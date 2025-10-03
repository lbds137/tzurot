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


jest.mock('../../src/application/bootstrap/ApplicationBootstrap', () => ({
  getApplicationBootstrap: jest.fn().mockReturnValue({
    getPersonalityApplicationService: jest.fn().mockReturnValue({
      getPersonality: jest.fn(),
    }),
  }),
}));

const logger = require('../../src/logger');
const { analyzeErrorAndGenerateMessage } = require('../../src/utils/aiErrorHandler');
const { getApplicationBootstrap } = require('../../src/application/bootstrap/ApplicationBootstrap');

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
    let mockBootstrap;
    let mockPersonalityApplicationService;

    beforeEach(() => {
      // Set up mocks for each test
      mockPersonalityApplicationService = {
        getPersonality: jest.fn(),
      };
      
      mockBootstrap = {
        getPersonalityApplicationService: jest.fn().mockReturnValue(mockPersonalityApplicationService),
      };
      
      // Apply the mocks
      getApplicationBootstrap.mockReturnValue(mockBootstrap);
    });

    it('should use personality error message when available', async () => {
      // Mock personality with error message
      mockPersonalityApplicationService.getPersonality.mockResolvedValue({
        fullName: 'test-personality',
        profile: {
          errorMessage: '*sighs dramatically* Something went wrong! ||*(an error has occurred)*||',
        },
      });

      const result = await analyzeErrorAndGenerateMessage(
        'NoneType object has no attribute',
        'test-personality',
        mockContext,
        mockAddToBlackoutList
      );

      // Should replace the marker with reference ID
      expect(result).toMatch(
        /\*sighs dramatically\* Something went wrong! \|\|\*\(an error has occurred; reference: \w+\)\*\|\|/
      );
      expect(logger.info).toHaveBeenCalledWith(
        '[AIErrorHandler] Using personality-specific error message for test-personality'
      );
    });

    it('should append error marker if personality message does not have one', async () => {
      // Mock personality with error message without marker
      mockPersonalityApplicationService.getPersonality.mockResolvedValue({
        fullName: 'test-personality',
        profile: {
          errorMessage: 'Oops! My circuits are fried!',
        },
      });

      const result = await analyzeErrorAndGenerateMessage(
        'NoneType object has no attribute',
        'test-personality',
        mockContext,
        mockAddToBlackoutList
      );

      // Should append the marker with reference ID
      expect(result).toMatch(
        /Oops! My circuits are fried! \|\|\*\(an error has occurred; reference: \w+\)\*\|\|/
      );
    });

    it('should handle personality error messages with different spoiler patterns', async () => {
      // Mock personality with different spoiler pattern
      mockPersonalityApplicationService.getPersonality.mockResolvedValue({
        fullName: 'test-personality',
        profile: {
          errorMessage: 'Error detected! ||*(system malfunction)*||',
        },
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
      mockPersonalityApplicationService.getPersonality.mockResolvedValue({
        fullName: 'test-personality',
        displayName: 'Test',
        profile: {
          displayName: 'Test',
        },
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
      mockPersonalityApplicationService.getPersonality.mockResolvedValue(null);

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
      mockPersonalityApplicationService.getPersonality.mockRejectedValue(new Error('Database error'));

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
      mockPersonalityApplicationService.getPersonality.mockResolvedValue({
        fullName: 'test-personality',
        profile: {
          errorMessage: 'Error! ||*(an error has occurred)*||',
        },
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
    let mockBootstrap;
    let mockPersonalityApplicationService;

    beforeEach(() => {
      // Set up mocks for each test
      mockPersonalityApplicationService = {
        getPersonality: jest.fn(),
      };
      
      mockBootstrap = {
        getPersonalityApplicationService: jest.fn().mockReturnValue(mockPersonalityApplicationService),
      };
      
      // Apply the mocks
      getApplicationBootstrap.mockReturnValue(mockBootstrap);

      // Set up personality with error message
      mockPersonalityApplicationService.getPersonality.mockResolvedValue({
        fullName: 'test-personality',
        profile: {
          errorMessage: 'Oops! Something broke! ||*(an error has occurred)*||',
        },
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
      mockPersonalityApplicationService.getPersonality.mockResolvedValue({
        fullName: 'test-personality',
        profile: {
          errorMessage: 'My circuits are fried! ||*(an error has occurred)*||',
        },
      });

      const result = await analyzeErrorAndGenerateMessage(
        '', // empty response
        'test-personality',
        mockContext,
        mockAddToBlackoutList
      );

      // Should use personality message and replace the marker with reference
      expect(result).toMatch(
        /My circuits are fried! \|\|\*\(an error has occurred; reference: \w+\)\*\|\|/
      );
      expect(result).not.toContain("Hmm, I couldn't generate a response"); // Should NOT use default
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

  describe('PersonalityApplicationService Integration', () => {
    let mockBootstrap;
    let mockPersonalityApplicationService;

    beforeEach(() => {
      // Set up mocks for each test
      mockPersonalityApplicationService = {
        getPersonality: jest.fn(),
      };
      
      mockBootstrap = {
        getPersonalityApplicationService: jest.fn().mockReturnValue(mockPersonalityApplicationService),
      };
      
      // Apply the mocks
      getApplicationBootstrap.mockReturnValue(mockBootstrap);
    });

    it('should use PersonalityApplicationService to fetch personality error messages', async () => {
      // Mock PersonalityApplicationService response
      mockPersonalityApplicationService.getPersonality.mockResolvedValue({
        fullName: 'test-personality',
        displayName: 'Test Personality',
        profile: {
          displayName: 'Test Personality',
          errorMessage: 'Test Error! ||*(an error has occurred)*||',
        },
      });

      const result = await analyzeErrorAndGenerateMessage(
        '',
        'test-personality',
        mockContext,
        mockAddToBlackoutList
      );

      // Should use PersonalityApplicationService
      expect(mockPersonalityApplicationService.getPersonality).toHaveBeenCalledWith('test-personality');

      // Should use personality error message
      expect(result).toMatch(/Test Error! \|\|\*\(an error has occurred; reference: \w+\)\*\|\|/);
      expect(logger.debug).toHaveBeenCalledWith(
        '[AIErrorHandler] Using PersonalityApplicationService for test-personality'
      );
    });


    it('should handle missing errorMessage in personality gracefully', async () => {
      // Mock PersonalityApplicationService response without errorMessage
      mockPersonalityApplicationService.getPersonality.mockResolvedValue({
        fullName: 'test-personality',
        displayName: 'Test Personality',
        profile: {
          displayName: 'Test Personality',
          // No errorMessage field
        },
      });

      const result = await analyzeErrorAndGenerateMessage(
        '',
        'test-personality',
        mockContext,
        mockAddToBlackoutList
      );

      // Should log warning about missing errorMessage
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('No errorMessage found in PersonalityApplicationService response')
      );

      // Should fall back to default error message
      expect(result).toMatch(/Hmm, I couldn't generate a response.*\|\|\(Reference: \w+\)\|\|/);
    });

    it('should handle PersonalityApplicationService errors gracefully', async () => {
      // Mock PersonalityApplicationService to throw error
      mockPersonalityApplicationService.getPersonality.mockRejectedValue(new Error('Router error'));

      const result = await analyzeErrorAndGenerateMessage(
        'rate limit',
        'test-personality',
        mockContext,
        mockAddToBlackoutList
      );

      // Should log the error
      expect(logger.debug).toHaveBeenCalledWith(
        '[AIErrorHandler] Could not fetch personality data: Router error'
      );

      // Should fall back to default rate limit message
      expect(result).toMatch(/I'm getting too many requests.*\|\|\(Reference: \w+\)\|\|/);
    });

    it('should use correct error message format from PersonalityApplicationService', async () => {
      // Mock PersonalityApplicationService with different error message format
      mockPersonalityApplicationService.getPersonality.mockResolvedValue({
        fullName: 'test-personality',
        displayName: 'Test Personality',
        profile: {
          displayName: 'Test Personality',
          errorMessage: 'System malfunction detected ||*(critical failure)*||',
        },
      });

      const result = await analyzeErrorAndGenerateMessage(
        'TypeError: Cannot read property',
        'test-personality',
        mockContext,
        mockAddToBlackoutList
      );

      // Should use personality error message with proper reference
      expect(result).toMatch(
        /System malfunction detected \|\|\*\(critical failure; reference: \w+\)\*\|\|/
      );
    });
  });
});
