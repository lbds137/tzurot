const errorHandler = require('../../../src/handlers/errorHandler');
const { ERROR_MESSAGES } = require('../../../src/constants');
const { PermissionFlagsBits } = require('discord.js');

// Mock dependencies
jest.mock('../../../src/logger');

describe('errorHandler', () => {
  let mockClient;
  let mockMessage;
  let originalEmit;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock client with emit function
    mockClient = {
      emit: jest.fn(),
      user: {
        id: 'client-123'
      },
      channels: {
        cache: new Map()
      }
    };
    
    // Save original emit for reference
    originalEmit = mockClient.emit;
    
    // Mock message with webhook
    mockMessage = {
      id: 'message-456',
      webhookId: 'webhook-789',
      content: 'Normal message content',
      author: {
        id: 'author-123',
        username: 'TestUser'
      },
      channel: {
        id: 'channel-123',
        name: 'test-channel',
        isTextBased: () => true,
        isDMBased: () => false,
        guild: {
          id: 'guild-123'
        },
        permissionsFor: jest.fn().mockReturnValue({
          has: jest.fn().mockReturnValue(true)
        }),
        messages: {
          fetch: jest.fn().mockResolvedValue(new Map())
        }
      },
      deletable: true,
      delete: jest.fn().mockResolvedValue(undefined),
      embeds: []
    };
  });
  
  describe('patchClientForErrorFiltering', () => {
    it('should patch the client to filter error messages', () => {
      // Patch the client
      const patchedClient = errorHandler.patchClientForErrorFiltering(mockClient);
      
      // Should return the same client object
      expect(patchedClient).toBe(mockClient);
      
      // Original emit should have been replaced
      expect(patchedClient.emit).not.toBe(originalEmit);
    });
    
    it('should filter webhook messages with error patterns', () => {
      // Patch the client
      const patchedClient = errorHandler.patchClientForErrorFiltering(mockClient);
      
      // Create an error message
      const errorMessageContent = `This message contains ${ERROR_MESSAGES[0]} which is an error pattern`;
      const errorMessage = {
        ...mockMessage,
        content: errorMessageContent,
        deletable: true,
        delete: jest.fn().mockResolvedValue(undefined)
      };
      
      // Call the patched emit function
      const result = patchedClient.emit('messageCreate', errorMessage);
      
      // Should return false to block the event
      expect(result).toBe(false);
      
      // Should attempt to delete the message
      expect(errorMessage.delete).toHaveBeenCalled();
    });
    
    it('should pass through non-error messages', () => {
      // Patch the client
      const patchedClient = errorHandler.patchClientForErrorFiltering(mockClient);
      
      // Create a normal message
      const normalMessage = {
        ...mockMessage,
        content: 'This is a normal message without errors'
      };
      
      // Mock the original emit behavior
      originalEmit.mockReturnValue(true);
      
      // Call the patched emit function
      const result = patchedClient.emit('messageCreate', normalMessage);
      
      // Should return the result of the original emit
      expect(result).toBe(true);
      
      // Should not attempt to delete the message
      expect(normalMessage.delete).not.toHaveBeenCalled();
      
      // Original emit should have been called with the same arguments
      expect(originalEmit).toHaveBeenCalledWith('messageCreate', normalMessage);
    });
    
    it('should pass through non-webhook messages', () => {
      // Patch the client
      const patchedClient = errorHandler.patchClientForErrorFiltering(mockClient);
      
      // Create a non-webhook message
      const nonWebhookMessage = {
        ...mockMessage,
        webhookId: null
      };
      
      // Mock the original emit behavior
      originalEmit.mockReturnValue(true);
      
      // Call the patched emit function
      const result = patchedClient.emit('messageCreate', nonWebhookMessage);
      
      // Should return the result of the original emit
      expect(result).toBe(true);
      
      // Original emit should have been called with the same arguments
      expect(originalEmit).toHaveBeenCalledWith('messageCreate', nonWebhookMessage);
    });
  });
  
  describe('hasErrorPatterns', () => {
    it('should detect messages with error patterns', () => {
      // Create an error message
      const errorMessageContent = `This message contains ${ERROR_MESSAGES[0]} which is an error pattern`;
      const errorMessage = {
        ...mockMessage,
        content: errorMessageContent
      };
      
      // Should detect the error pattern
      expect(errorHandler.hasErrorPatterns(errorMessage)).toBe(true);
    });
    
    it('should not detect messages without error patterns', () => {
      // Create a normal message
      const normalMessage = {
        ...mockMessage,
        content: 'This is a normal message without errors'
      };
      
      // Should not detect any error patterns
      expect(errorHandler.hasErrorPatterns(normalMessage)).toBe(false);
    });
    
    it('should handle null or empty messages gracefully', () => {
      // Should not throw for null or empty messages
      expect(errorHandler.hasErrorPatterns(null)).toBe(false);
      expect(errorHandler.hasErrorPatterns({})).toBe(false);
      expect(errorHandler.hasErrorPatterns({ content: null })).toBe(false);
      expect(errorHandler.hasErrorPatterns({ content: '' })).toBe(false);
    });
  });
  
  describe('filterWebhookMessage', () => {
    it('should filter and delete webhook messages with error patterns', () => {
      // Create an error message
      const errorMessageContent = `This message contains ${ERROR_MESSAGES[0]} which is an error pattern`;
      const errorMessage = {
        ...mockMessage,
        content: errorMessageContent,
        deletable: true,
        delete: jest.fn().mockResolvedValue(undefined)
      };
      
      // Should filter the message
      const result = errorHandler.filterWebhookMessage(errorMessage);
      
      // Should return true to indicate the message was filtered
      expect(result).toBe(true);
      
      // Should attempt to delete the message
      expect(errorMessage.delete).toHaveBeenCalled();
    });
    
    it('should not filter non-webhook messages', () => {
      // Create a non-webhook message
      const nonWebhookMessage = {
        ...mockMessage,
        webhookId: null
      };
      
      // Should not filter the message
      const result = errorHandler.filterWebhookMessage(nonWebhookMessage);
      
      // Should return false to indicate the message was not filtered
      expect(result).toBe(false);
      
      // Should not attempt to delete the message
      expect(nonWebhookMessage.delete).not.toHaveBeenCalled();
    });
    
    it('should not filter webhook messages without error patterns', () => {
      // Create a normal webhook message
      const normalMessage = {
        ...mockMessage,
        content: 'This is a normal message without errors'
      };
      
      // Should not filter the message
      const result = errorHandler.filterWebhookMessage(normalMessage);
      
      // Should return false to indicate the message was not filtered
      expect(result).toBe(false);
      
      // Should not attempt to delete the message
      expect(normalMessage.delete).not.toHaveBeenCalled();
    });
    
    it('should handle non-deletable messages gracefully', () => {
      // Create an error message that is not deletable
      const errorMessageContent = `This message contains ${ERROR_MESSAGES[0]} which is an error pattern`;
      const nonDeletableMessage = {
        ...mockMessage,
        content: errorMessageContent,
        deletable: false,
        delete: jest.fn()
      };
      
      // Should filter the message
      const result = errorHandler.filterWebhookMessage(nonDeletableMessage);
      
      // Should return true to indicate the message was filtered
      expect(result).toBe(true);
      
      // Should not attempt to delete the message
      expect(nonDeletableMessage.delete).not.toHaveBeenCalled();
    });
  });
  
  describe('detectAndDeleteIncompleteEmbed', () => {
    it('should detect and delete incomplete "Personality Added" embeds', async () => {
      // Create a message with an incomplete embed
      const incompleteEmbedMessage = {
        ...mockMessage,
        embeds: [
          {
            title: 'Personality Added',
            fields: [
              {
                name: 'Display Name',
                value: 'Not set'
              }
            ],
            thumbnail: null
          }
        ],
        deletable: true,
        delete: jest.fn().mockResolvedValue(undefined)
      };
      
      // Should detect and delete the incomplete embed
      const result = await errorHandler.detectAndDeleteIncompleteEmbed(incompleteEmbedMessage);
      
      // Should return true to indicate the embed was detected and deleted
      expect(result).toBe(true);
      
      // Should attempt to delete the message
      expect(incompleteEmbedMessage.delete).toHaveBeenCalled();
    });
    
    it('should detect incomplete embeds with zeevat pattern', async () => {
      // Create a message with an incomplete embed
      const incompleteEmbedMessage = {
        ...mockMessage,
        embeds: [
          {
            title: 'Personality Added',
            fields: [
              {
                name: 'Display Name',
                value: 'testing-zeevat-something'
              }
            ],
            thumbnail: null
          }
        ],
        deletable: true,
        delete: jest.fn().mockResolvedValue(undefined)
      };
      
      // Should detect and delete the incomplete embed
      const result = await errorHandler.detectAndDeleteIncompleteEmbed(incompleteEmbedMessage);
      
      // Should return true to indicate the embed was detected and deleted
      expect(result).toBe(true);
      
      // Should attempt to delete the message
      expect(incompleteEmbedMessage.delete).toHaveBeenCalled();
    });
    
    it('should not detect complete "Personality Added" embeds', async () => {
      // Create a message with a complete embed
      const completeEmbedMessage = {
        ...mockMessage,
        embeds: [
          {
            title: 'Personality Added',
            fields: [
              {
                name: 'Display Name',
                value: 'Test Personality'
              }
            ],
            thumbnail: {
              url: 'https://example.com/avatar.png'
            }
          }
        ],
        deletable: true,
        delete: jest.fn().mockResolvedValue(undefined)
      };
      
      // Should not detect the complete embed as incomplete
      const result = await errorHandler.detectAndDeleteIncompleteEmbed(completeEmbedMessage);
      
      // Should return false to indicate no incomplete embed was detected
      expect(result).toBe(false);
      
      // Should not attempt to delete the message
      expect(completeEmbedMessage.delete).not.toHaveBeenCalled();
    });
    
    it('should handle other types of embeds gracefully', async () => {
      // Create a message with a different type of embed
      const otherEmbedMessage = {
        ...mockMessage,
        embeds: [
          {
            title: 'Some Other Embed',
            description: 'This is not a Personality Added embed'
          }
        ],
        deletable: true,
        delete: jest.fn().mockResolvedValue(undefined)
      };
      
      // Should not detect the other embed as incomplete
      const result = await errorHandler.detectAndDeleteIncompleteEmbed(otherEmbedMessage);
      
      // Should return false to indicate no incomplete embed was detected
      expect(result).toBe(false);
      
      // Should not attempt to delete the message
      expect(otherEmbedMessage.delete).not.toHaveBeenCalled();
    });
    
    it('should handle messages without embeds gracefully', async () => {
      // Create a message without embeds
      const noEmbedMessage = {
        ...mockMessage,
        embeds: []
      };
      
      // Should not detect any incomplete embeds
      const result = await errorHandler.detectAndDeleteIncompleteEmbed(noEmbedMessage);
      
      // Should return false to indicate no incomplete embed was detected
      expect(result).toBe(false);
    });
  });
  
  describe('startQueueCleaner', () => {
    let intervalId;
    
    afterEach(() => {
      // Clean up interval
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    });
    
    it('should start the queue cleaner interval', () => {
      // Mock setInterval to avoid timing issues
      const originalSetInterval = global.setInterval;
      global.setInterval = jest.fn().mockReturnValue(123);
      
      // Start the queue cleaner
      intervalId = errorHandler.startQueueCleaner(mockClient);
      
      // Should return the interval ID
      expect(intervalId).toBe(123);
      
      // Should have called setInterval with the expected interval
      expect(global.setInterval).toHaveBeenCalledWith(expect.any(Function), 7000);
      
      // Restore original setInterval
      global.setInterval = originalSetInterval;
    });
  });
});