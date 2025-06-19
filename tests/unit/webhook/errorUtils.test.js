// Mock dependencies before imports
jest.mock('../../../src/logger');
jest.mock('../../../src/constants', () => ({
  ERROR_MESSAGES: [
    "I'm having trouble connecting",
    'ERROR_MESSAGE_PREFIX:',
    'trouble connecting to my brain',
    'technical issue',
    'Error ID:',
    'issue with my configuration',
    'issue with my response system',
    'momentary lapse',
    'try again later',
    'HARD_BLOCKED_RESPONSE_DO_NOT_DISPLAY',
    'Please try again',
    'connection unstable',
    'unable to formulate',
  ],
}));

const logger = require('../../../src/logger');
const {
  isErrorContent,
  markErrorContent,
  isErrorWebhookMessage,
} = require('../../../src/webhook/errorUtils');

describe('errorUtils', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Mock console methods
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  describe('isErrorContent', () => {
    it('should return false for null content', () => {
      expect(isErrorContent(null)).toBe(false);
    });

    it('should return false for undefined content', () => {
      expect(isErrorContent(undefined)).toBe(false);
    });

    it('should return false for non-string content', () => {
      expect(isErrorContent(123)).toBe(false);
      expect(isErrorContent({})).toBe(false);
      expect(isErrorContent([])).toBe(false);
    });

    it('should detect standard error messages from constants', () => {
      expect(isErrorContent("I'm having trouble connecting")).toBe(true);
      expect(isErrorContent('ERROR_MESSAGE_PREFIX: Something went wrong')).toBe(true);
      expect(isErrorContent('trouble connecting to my brain')).toBe(true);
      expect(isErrorContent('technical issue occurred')).toBe(true);
      expect(isErrorContent('Error ID: 12345')).toBe(true);
    });

    it('should detect connection unstable combination', () => {
      expect(isErrorContent('The connection is unstable')).toBe(true);
      expect(isErrorContent('unstable connection detected')).toBe(true);
      expect(isErrorContent('connection seems unstable')).toBe(true);
    });

    it('should be case sensitive for exact matches', () => {
      expect(isErrorContent('ERROR_MESSAGE_PREFIX:')).toBe(true);
      expect(isErrorContent('error_message_prefix:')).toBe(false);
    });

    it('should not detect partial matches of error phrases in normal content', () => {
      expect(isErrorContent('I have no trouble with this')).toBe(false);
      expect(isErrorContent('This is a stable connection')).toBe(false);
      expect(isErrorContent('Please continue with your request')).toBe(false);
    });

    it('should detect HARD_BLOCKED_RESPONSE marker', () => {
      expect(isErrorContent('HARD_BLOCKED_RESPONSE_DO_NOT_DISPLAY')).toBe(true);
      expect(isErrorContent('Message with HARD_BLOCKED_RESPONSE_DO_NOT_DISPLAY marker')).toBe(true);
    });

    it('should handle empty strings', () => {
      expect(isErrorContent('')).toBe(false);
    });

    it('should handle strings with only whitespace', () => {
      expect(isErrorContent('   ')).toBe(false);
      expect(isErrorContent('\n\t')).toBe(false);
    });
  });

  describe('markErrorContent', () => {
    it('should return empty string for null content', () => {
      expect(markErrorContent(null)).toBe('');
    });

    it('should return empty string for undefined content', () => {
      expect(markErrorContent(undefined)).toBe('');
    });

    it('should add prefix to error content', () => {
      const errorContent = "I'm having trouble connecting";
      expect(markErrorContent(errorContent)).toBe('ERROR_MESSAGE_PREFIX: ' + errorContent);
    });

    it('should not add prefix to normal content', () => {
      const normalContent = 'This is a normal message';
      expect(markErrorContent(normalContent)).toBe(normalContent);
    });

    it('should not double-prefix already prefixed content', () => {
      const prefixedContent = 'ERROR_MESSAGE_PREFIX: Already marked';
      expect(markErrorContent(prefixedContent)).toBe(prefixedContent);
    });

    it('should handle connection unstable errors', () => {
      const content = 'The connection seems unstable right now';
      expect(markErrorContent(content)).toBe('ERROR_MESSAGE_PREFIX: ' + content);
    });

    it('should handle empty string', () => {
      expect(markErrorContent('')).toBe('');
    });

    it('should preserve original content when not an error', () => {
      const content = 'Hello, how can I help you today?';
      expect(markErrorContent(content)).toBe(content);
    });
  });

  describe('isErrorWebhookMessage', () => {
    it('should return false for null options', () => {
      expect(isErrorWebhookMessage(null)).toBe(false);
    });

    it('should return false for undefined options', () => {
      expect(isErrorWebhookMessage(undefined)).toBe(false);
    });

    it('should return false for options without content', () => {
      expect(isErrorWebhookMessage({})).toBe(false);
      expect(isErrorWebhookMessage({ username: 'Bot' })).toBe(false);
    });

    it('should allow all thread messages regardless of content', () => {
      const threadMessage = {
        content: 'error occurred',
        threadId: 'thread-123',
      };
      expect(isErrorWebhookMessage(threadMessage)).toBe(false);
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Allowing potential error message in thread')
      );
    });

    it('should allow thread messages with thread_id', () => {
      const threadMessage = {
        content: 'failed to process',
        thread_id: 'thread-456',
      };
      expect(isErrorWebhookMessage(threadMessage)).toBe(false);
    });

    it('should detect error indicators in content', () => {
      expect(isErrorWebhookMessage({ content: 'error occurred while processing' })).toBe(true);
      expect(isErrorWebhookMessage({ content: 'Error: Something went wrong' })).toBe(true);
      expect(isErrorWebhookMessage({ content: 'Failed to complete the request' })).toBe(true);
      expect(isErrorWebhookMessage({ content: 'Unable to process your request' })).toBe(true);
      expect(isErrorWebhookMessage({ content: 'Cannot find the resource' })).toBe(true);
    });

    it('should detect error formatting patterns', () => {
      expect(isErrorWebhookMessage({ content: '[error] Something went wrong' })).toBe(true);
      expect(isErrorWebhookMessage({ content: 'error: invalid input' })).toBe(true);
      expect(isErrorWebhookMessage({ content: '⚠️ Warning message' })).toBe(true);
      expect(isErrorWebhookMessage({ content: '❌ Operation failed' })).toBe(true);
    });

    it('should detect various error types', () => {
      expect(isErrorWebhookMessage({ content: 'Invalid request format' })).toBe(true);
      expect(isErrorWebhookMessage({ content: 'Exception thrown during processing' })).toBe(true);
      expect(isErrorWebhookMessage({ content: 'Resource not found' })).toBe(true);
      expect(isErrorWebhookMessage({ content: 'Access denied to resource' })).toBe(true);
      expect(isErrorWebhookMessage({ content: 'Forbidden action attempted' })).toBe(true);
      expect(isErrorWebhookMessage({ content: 'Unauthorized access' })).toBe(true);
    });

    it('should detect rate limiting and timeout errors', () => {
      expect(isErrorWebhookMessage({ content: 'Rate limit exceeded' })).toBe(true);
      expect(isErrorWebhookMessage({ content: 'Request timeout after 30s' })).toBe(true);
      expect(isErrorWebhookMessage({ content: 'Bad request format' })).toBe(true);
    });

    it('should not detect normal messages as errors', () => {
      expect(isErrorWebhookMessage({ content: 'Hello, how can I help?' })).toBe(false);
      expect(isErrorWebhookMessage({ content: 'The operation was successful' })).toBe(false);
      expect(isErrorWebhookMessage({ content: 'Everything is working fine' })).toBe(false);
    });

    it('should handle case insensitive error detection', () => {
      expect(isErrorWebhookMessage({ content: 'ERROR OCCURRED' })).toBe(true);
      expect(isErrorWebhookMessage({ content: 'Failed To Process' })).toBe(true);
      expect(isErrorWebhookMessage({ content: 'UNABLE TO COMPLETE' })).toBe(true);
    });

    it('should not flag messages with error words in different context', () => {
      expect(isErrorWebhookMessage({ content: 'I cannot wait to see you!' })).toBe(true); // Still triggers on 'cannot'
      expect(isErrorWebhookMessage({ content: 'The movie was not found to be entertaining' })).toBe(
        true
      ); // Triggers on 'not found'
      expect(isErrorWebhookMessage({ content: 'This is exceptionally good' })).toBe(true); // 'exception' is detected as substring
    });

    it('should handle empty content', () => {
      expect(isErrorWebhookMessage({ content: '' })).toBe(false);
    });

    it('should handle whitespace content', () => {
      expect(isErrorWebhookMessage({ content: '   ' })).toBe(false);
      expect(isErrorWebhookMessage({ content: '\n\t' })).toBe(false);
    });

    it('should prioritize thread check over error detection', () => {
      const errorThreadMessage = {
        content: '[error] Critical failure occurred!',
        threadId: 'thread-789',
      };
      expect(isErrorWebhookMessage(errorThreadMessage)).toBe(false);

      // Same message without thread should be detected as error
      const errorNonThreadMessage = {
        content: '[error] Critical failure occurred!',
      };
      expect(isErrorWebhookMessage(errorNonThreadMessage)).toBe(true);
    });
  });
});
