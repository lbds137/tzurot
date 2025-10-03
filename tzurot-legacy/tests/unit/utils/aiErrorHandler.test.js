// Mock dependencies first
jest.mock('../../../src/logger');
jest.mock('../../../src/utils/errorTracker', () => ({
  ErrorCategory: {
    API_CONTENT: 'API_CONTENT',
    AI_SERVICE: 'AI_SERVICE',
  },
  trackError: jest.fn(),
}));
jest.mock('../../../src/application/bootstrap/ApplicationBootstrap', () => ({
  getApplicationBootstrap: jest.fn()
}));

// Then require modules
const {
  isErrorResponse,
  analyzeErrorAndGenerateMessage,
  handleApiError,
} = require('../../../src/utils/aiErrorHandler');
const logger = require('../../../src/logger');
const { MARKERS } = require('../../../src/constants');
const { getApplicationBootstrap } = require('../../../src/application/bootstrap/ApplicationBootstrap');


describe('AI Error Handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Legacy personalityManager removed - now using DDD system
  });

  describe('isErrorResponse', () => {
    describe('uncovered error patterns', () => {
      it('should detect ValueError patterns', () => {
        expect(isErrorResponse('ValueError: invalid literal for int()')).toBe(true);
      });

      it('should detect KeyError patterns', () => {
        expect(isErrorResponse("KeyError: 'missing_key'")).toBe(true);
      });

      it('should detect IndexError patterns', () => {
        expect(isErrorResponse('IndexError: list index out of range')).toBe(true);
      });

      it('should detect ModuleNotFoundError patterns', () => {
        expect(isErrorResponse("ModuleNotFoundError: No module named 'missing_module'")).toBe(true);
      });

      it('should detect ImportError patterns', () => {
        expect(isErrorResponse("ImportError: cannot import name 'function' from 'module'")).toBe(
          true
        );
      });

      it('should detect standalone Error: at line start', () => {
        expect(isErrorResponse('Error: Something went wrong')).toBe(true);
      });

      it('should detect Error: after newline', () => {
        expect(isErrorResponse('Some text\nError: Failed to process')).toBe(true);
      });

      it('should detect Traceback with line references', () => {
        expect(
          isErrorResponse('Traceback (most recent call last):\n  File "test.py", line 10')
        ).toBe(true);
      });

      it('should detect Exception with raised keyword', () => {
        expect(isErrorResponse('Exception raised during processing')).toBe(true);
      });

      it('should detect Exception with caught keyword', () => {
        expect(isErrorResponse('Exception caught in handler')).toBe(true);
      });

      it('should detect Exception with thrown keyword', () => {
        expect(isErrorResponse('Exception thrown by the API')).toBe(true);
      });

      it('should detect Exception with threw keyword', () => {
        expect(isErrorResponse('The function threw an Exception')).toBe(true);
      });
    });
  });

  describe('analyzeErrorAndGenerateMessage', () => {
    const mockAddToBlackoutList = jest.fn();
    const mockContext = { userId: 'test-user', channelId: 'test-channel' };

    beforeEach(() => {
      mockAddToBlackoutList.mockClear();
    });

    describe('specific error types', () => {
      it('should handle ValueError content', async () => {
        const result = await analyzeErrorAndGenerateMessage(
          'ValueError: invalid literal for int()',
          'test-personality',
          mockContext,
          mockAddToBlackoutList
        );

        expect(result).toContain('I encountered a processing error');
        expect(logger.error).toHaveBeenCalledWith(
          '[AIService] Error in content from test-personality: value_error'
        );
        expect(mockAddToBlackoutList).toHaveBeenCalledWith(
          'test-personality',
          mockContext,
          5 * 60 * 1000
        );
      });

      it('should handle KeyError content', async () => {
        const result = await analyzeErrorAndGenerateMessage(
          "KeyError: 'missing_key'",
          'test-personality',
          mockContext,
          mockAddToBlackoutList
        );

        expect(result).toContain('I encountered a processing error');
        expect(logger.error).toHaveBeenCalledWith(
          '[AIService] Error in content from test-personality: key_error'
        );
      });

      it('should handle IndexError content', async () => {
        const result = await analyzeErrorAndGenerateMessage(
          'IndexError: list index out of range',
          'test-personality',
          mockContext,
          mockAddToBlackoutList
        );

        expect(result).toContain('I encountered a processing error');
        expect(logger.error).toHaveBeenCalledWith(
          '[AIService] Error in content from test-personality: index_error'
        );
      });

      it('should handle API server error (500)', async () => {
        const result = await analyzeErrorAndGenerateMessage(
          'Internal Server Error 500',
          'test-personality',
          mockContext,
          mockAddToBlackoutList
        );

        expect(result).toContain('AI service seems to be having issues');
        expect(logger.error).toHaveBeenCalledWith(
          '[AIService] Error in content from test-personality: api_server_error'
        );
        expect(mockAddToBlackoutList).toHaveBeenCalledWith(
          'test-personality',
          mockContext,
          30 * 1000
        );
      });

      it('should handle rate limit error', async () => {
        const result = await analyzeErrorAndGenerateMessage(
          'Error: Rate limit exceeded. Too many requests.',
          'test-personality',
          mockContext,
          mockAddToBlackoutList
        );

        expect(result).toContain('too many requests right now');
        expect(logger.error).toHaveBeenCalledWith(
          '[AIService] Error in content from test-personality: rate_limit_error'
        );
        expect(mockAddToBlackoutList).toHaveBeenCalledWith(
          'test-personality',
          mockContext,
          30 * 1000
        );
      });

      it('should handle timeout error', async () => {
        const result = await analyzeErrorAndGenerateMessage(
          'Request timeout: Operation timed out after 30 seconds',
          'test-personality',
          mockContext,
          mockAddToBlackoutList
        );

        expect(result).toContain('took too long to generate');
        expect(logger.error).toHaveBeenCalledWith(
          '[AIService] Error in content from test-personality: timeout_error'
        );
        expect(mockAddToBlackoutList).toHaveBeenCalledWith(
          'test-personality',
          mockContext,
          30 * 1000
        );
      });

      it('should handle exception with traceback', async () => {
        const result = await analyzeErrorAndGenerateMessage(
          'Traceback (most recent call last):\n  File "test.py", line 10\nNameError: name not defined',
          'test-personality',
          mockContext,
          mockAddToBlackoutList
        );

        expect(result).toContain('Something unexpected happened');
        expect(logger.error).toHaveBeenCalledWith(
          '[AIService] Error in content from test-personality: exception'
        );
        expect(logger.error).toHaveBeenCalledWith(
          '[AIService] Error details: File "test.py", line 10'
        );
      });

      it('should handle generic error', async () => {
        const result = await analyzeErrorAndGenerateMessage(
          'Some weird error that does not match any pattern',
          'test-personality',
          mockContext,
          mockAddToBlackoutList
        );

        expect(result).toContain('technical error');
        expect(logger.error).toHaveBeenCalledWith(
          '[AIService] Error in content from test-personality: error_in_content'
        );
        expect(mockAddToBlackoutList).toHaveBeenCalledWith(
          'test-personality',
          mockContext,
          60 * 1000
        );
      });
    });

    describe('non-string content', () => {
      it('should handle object content', async () => {
        const result = await analyzeErrorAndGenerateMessage(
          { error: 'Some error object' },
          'test-personality',
          mockContext,
          mockAddToBlackoutList
        );

        expect(result).toContain('technical error');
        expect(logger.error).toHaveBeenCalledWith(
          '[AIService] Non-string error from test-personality'
        );
        expect(logger.error).toHaveBeenCalledWith(
          '[AIService] Non-string content sample: {"error":"Some error object"}'
        );
      });

      it('should handle null content', async () => {
        const result = await analyzeErrorAndGenerateMessage(
          null,
          'test-personality',
          mockContext,
          mockAddToBlackoutList
        );

        expect(result).toContain('technical error');
        expect(logger.error).toHaveBeenCalledWith(
          '[AIService] Non-string error from test-personality'
        );
      });

      it('should handle undefined content', async () => {
        const result = await analyzeErrorAndGenerateMessage(
          undefined,
          'test-personality',
          mockContext,
          mockAddToBlackoutList
        );

        expect(result).toContain('technical error');
        expect(logger.error).toHaveBeenCalledWith(
          '[AIService] Non-string error from test-personality'
        );
      });
    });

    describe('context handling', () => {
      it('should handle missing userId in context', async () => {
        const contextWithoutUser = { channelId: 'test-channel' };
        const result = await analyzeErrorAndGenerateMessage(
          'TypeError: Something went wrong',
          'test-personality',
          contextWithoutUser,
          mockAddToBlackoutList
        );

        expect(result).toBeDefined();
        // Should not log user context when userId is missing
        expect(logger.error).not.toHaveBeenCalledWith(
          expect.stringContaining('Error context - User:')
        );
      });
    });
  });

  describe('handleApiError', () => {
    // Mock PersonalityApplicationService
    beforeEach(() => {
      const mockPersonality = {
        toJSON: () => ({
          profile: {
            errorMessage: 'Error occurred ||*(an error has occurred)*||'
          }
        })
      };
      
      const mockBootstrap = {
        getPersonalityApplicationService: jest.fn().mockReturnValue({
          getPersonality: jest.fn().mockResolvedValue(mockPersonality)
        })
      };
      
      getApplicationBootstrap.mockReturnValue(mockBootstrap);
    });

    it('should handle 404 errors with BOT_ERROR_MESSAGE', async () => {
      const error = { status: 404 };
      const result = await handleApiError(error, 'test-personality', {});

      expect(result).toBe(
        `${MARKERS.BOT_ERROR_MESSAGE}⚠️ I couldn't find the personality "test-personality". The personality might not be available on the server.`
      );
    });

    it('should handle 429 rate limit errors with personality error message', async () => {
      const error = { status: 429 };
      const result = await handleApiError(error, 'test-personality', {});

      // Should return personality-specific error message
      expect(result).toMatch(/Error occurred.*\|\|\*\(an error has occurred; reference: \w+\)\*\|\|$/);
    });

    it('should handle 500 server errors with personality error message', async () => {
      const error = { status: 500 };
      const result = await handleApiError(error, 'test-personality', {});

      // Should return personality-specific error message
      expect(result).toMatch(/Error occurred.*\|\|\*\(an error has occurred; reference: \w+\)\*\|\|$/);
    });

    it('should handle 502 bad gateway errors with personality error message', async () => {
      const error = { status: 502 };
      const result = await handleApiError(error, 'test-personality', {});

      // Should return personality-specific error message
      expect(result).toMatch(/Error occurred.*\|\|\*\(an error has occurred; reference: \w+\)\*\|\|$/);
    });

    it('should handle 503 service unavailable errors with personality error message', async () => {
      const error = { status: 503 };
      const result = await handleApiError(error, 'test-personality', {});

      // Should return personality-specific error message
      expect(result).toMatch(/Error occurred.*\|\|\*\(an error has occurred; reference: \w+\)\*\|\|$/);
    });

    it('should handle generic errors with personality error message', async () => {
      const error = { status: 400 };
      const result = await handleApiError(error, 'test-personality', {});

      // Should return personality-specific error message
      expect(result).toMatch(/Error occurred.*\|\|\*\(an error has occurred; reference: \w+\)\*\|\|$/);
    });

    it('should fall back to generic message when personality not found', async () => {
      // Mock personality not found
      const mockBootstrap = {
        getPersonalityApplicationService: jest.fn().mockReturnValue({
          getPersonality: jest.fn().mockResolvedValue(null)
        })
      };
      
      getApplicationBootstrap.mockReturnValue(mockBootstrap);

      const error = { status: 502 };
      const result = await handleApiError(error, 'test-personality', {});

      expect(result).toMatch(/The AI service seems to be having issues right now.*\|\|\*\(Error ID: \w+\)\*\|\|$/);
    });

    it('should handle timeout errors with appropriate message', async () => {
      // Mock personality not found for clearer test
      const mockBootstrap = {
        getPersonalityApplicationService: jest.fn().mockReturnValue({
          getPersonality: jest.fn().mockResolvedValue(null)
        })
      };
      
      getApplicationBootstrap.mockReturnValue(mockBootstrap);

      const error = { timeout: true };
      const result = await handleApiError(error, 'test-personality', {});

      expect(result).toMatch(/My response took too long to generate.*\|\|\*\(Error ID: \w+\)\*\|\|$/);
    });
  });
});
