const MessageHistory = require('../../../../src/core/conversation/MessageHistory');
const logger = require('../../../../src/logger');

// Mock the logger
jest.mock('../../../../src/logger');

// Mock DDD modules
jest.mock('../../../../src/application/bootstrap/ApplicationBootstrap');

describe('MessageHistory', () => {
  let messageHistory;
  let mockConversationTracker;
  let mockPersonalityApplicationService;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock conversation tracker
    mockConversationTracker = {
      getConversationByMessageId: jest.fn(),
    };

    // Create new instance
    messageHistory = new MessageHistory(mockConversationTracker);

    // Mock DDD modules
    const { getApplicationBootstrap } = require('../../../../src/application/bootstrap/ApplicationBootstrap');

    mockPersonalityApplicationService = {
      getPersonality: jest.fn().mockResolvedValue(null),
    };
    const mockBootstrap = {
      getPersonalityApplicationService: jest.fn().mockReturnValue(mockPersonalityApplicationService),
    };
    getApplicationBootstrap.mockReturnValue(mockBootstrap);
  });

  describe('getPersonalityFromMessage', () => {
    it('should return personality from conversation tracker if found', async () => {
      // Arrange
      const messageId = '12345';
      const expectedPersonality = 'test-personality';
      mockConversationTracker.getConversationByMessageId.mockReturnValue({
        personalityName: expectedPersonality,
      });

      // Act
      const result = await messageHistory.getPersonalityFromMessage(messageId);

      // Assert
      expect(result).toBe(expectedPersonality);
      expect(mockConversationTracker.getConversationByMessageId).toHaveBeenCalledWith(messageId);
    });

    it('should fallback to webhook username lookup if not in tracker', async () => {
      // Arrange
      const messageId = '12345';
      const webhookUsername = 'TestPersonality';
      mockConversationTracker.getConversationByMessageId.mockReturnValue(null);
      
      // Mock router to return personality when queried with webhook username
      mockPersonalityApplicationService.getPersonality.mockImplementation(async (nameOrAlias) => {
        if (nameOrAlias.toLowerCase() === 'testpersonality') {
          return { fullName: 'test-personality' };
        }
        return null;
      });

      // Act
      const result = await messageHistory.getPersonalityFromMessage(messageId, { webhookUsername });

      // Assert
      expect(result).toBe('test-personality');
    });

    it('should return null if no personality found', async () => {
      // Arrange
      const messageId = '12345';
      mockConversationTracker.getConversationByMessageId.mockReturnValue(null);

      // Act
      const result = await messageHistory.getPersonalityFromMessage(messageId);

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('_getPersonalityFromWebhookUsername', () => {
    describe('webhook username with pipe character', () => {
      it('should extract base name before pipe and match personality', async () => {
        // Arrange
        const webhookUsername = 'Desidara | תשב';
        
        // Mock router to return personality for "Desidara" or "desidara"
        mockPersonalityApplicationService.getPersonality.mockImplementation(async (nameOrAlias) => {
          if (nameOrAlias.toLowerCase() === 'desidara') {
            return { fullName: 'desidara-123' };
          }
          return null;
        });

        // Act
        const result = await messageHistory._getPersonalityFromWebhookUsername(webhookUsername);

        // Assert
        expect(result).toBe('desidara-123');
        expect(logger.debug).toHaveBeenCalledWith(
          expect.stringContaining('Extracted base name from webhook: "Desidara"')
        );
      });

      it('should handle webhook username with multiple pipes', async () => {
        // Arrange
        const webhookUsername = 'TestName | System | Extra';
        
        // Mock router to return personality for "TestName"
        mockPersonalityApplicationService.getPersonality.mockImplementation(async (nameOrAlias) => {
          if (nameOrAlias.toLowerCase() === 'testname') {
            return { fullName: 'test-123' };
          }
          return null;
        });

        // Act
        const result = await messageHistory._getPersonalityFromWebhookUsername(webhookUsername);

        // Assert
        expect(result).toBe('test-123');
        expect(logger.debug).toHaveBeenCalledWith(
          expect.stringContaining('Extracted base name from webhook: "TestName"')
        );
      });

      it('should trim whitespace around extracted base name', async () => {
        // Arrange
        const webhookUsername = '  SpacedName   |   Suffix  ';
        
        // Mock router to return personality for "SpacedName"
        mockPersonalityApplicationService.getPersonality.mockImplementation(async (nameOrAlias) => {
          if (nameOrAlias.toLowerCase() === 'spacedname') {
            return { fullName: 'spaced-123' };
          }
          return null;
        });

        // Act
        const result = await messageHistory._getPersonalityFromWebhookUsername(webhookUsername);

        // Assert
        expect(result).toBe('spaced-123');
      });

      it('should match using webhook pattern regex', async () => {
        // Arrange
        const webhookUsername = 'PersonalityName | SomeTag';
        
        // Mock router to return personality
        mockPersonalityApplicationService.getPersonality.mockImplementation(async (nameOrAlias) => {
          if (nameOrAlias.toLowerCase() === 'personalityname') {
            return { fullName: 'personality-123' };
          }
          return null;
        });

        // Act
        const result = await messageHistory._getPersonalityFromWebhookUsername(webhookUsername);

        // Assert
        expect(result).toBe('personality-123');
        expect(logger.debug).toHaveBeenCalledWith(
          expect.stringContaining('Found personality match through DDD service')
        );
      });
    });

    describe('exact matching', () => {
      it('should find exact match with full webhook username', async () => {
        // Arrange
        const webhookUsername = 'ExactMatch';
        
        // Mock router to return personality
        mockPersonalityApplicationService.getPersonality.mockImplementation(async (nameOrAlias) => {
          if (nameOrAlias === 'ExactMatch' || nameOrAlias.toLowerCase() === 'exactmatch') {
            return { fullName: 'exact-123' };
          }
          return null;
        });

        // Act
        const result = await messageHistory._getPersonalityFromWebhookUsername(webhookUsername);

        // Assert
        expect(result).toBe('exact-123');
      });

      it('should find exact match with extracted base name', async () => {
        // Arrange
        const webhookUsername = 'BaseName | Suffix';
        
        // Mock router to return personality
        mockPersonalityApplicationService.getPersonality.mockImplementation(async (nameOrAlias) => {
          if (nameOrAlias.toLowerCase() === 'basename') {
            return { fullName: 'base-123' };
          }
          return null;
        });

        // Act
        const result = await messageHistory._getPersonalityFromWebhookUsername(webhookUsername);

        // Assert
        expect(result).toBe('base-123');
      });
    });

    describe('case-insensitive matching', () => {
      it('should match case-insensitively with full username', async () => {
        // Arrange
        const webhookUsername = 'UPPERCASE';
        
        // Mock router to handle case-insensitive matching
        mockPersonalityApplicationService.getPersonality.mockImplementation(async (nameOrAlias) => {
          if (nameOrAlias.toLowerCase() === 'uppercase') {
            return { fullName: 'upper-123' };
          }
          return null;
        });

        // Act
        const result = await messageHistory._getPersonalityFromWebhookUsername(webhookUsername);

        // Assert
        expect(result).toBe('upper-123');
      });

      it('should match case-insensitively with base name', async () => {
        // Arrange
        const webhookUsername = 'MixedCase | suffix';
        
        // Mock router to handle case-insensitive matching
        mockPersonalityApplicationService.getPersonality.mockImplementation(async (nameOrAlias) => {
          if (nameOrAlias.toLowerCase() === 'mixedcase') {
            return { fullName: 'mixed-123' };
          }
          return null;
        });

        // Act
        const result = await messageHistory._getPersonalityFromWebhookUsername(webhookUsername);

        // Assert
        expect(result).toBe('mixed-123');
      });

      it('should handle Hebrew characters in webhook username', async () => {
        // Arrange
        const webhookUsername = 'TestName | שלום';
        
        // Mock router to return personality
        mockPersonalityApplicationService.getPersonality.mockImplementation(async (nameOrAlias) => {
          if (nameOrAlias.toLowerCase() === 'testname') {
            return { fullName: 'test-123' };
          }
          return null;
        });

        // Act
        const result = await messageHistory._getPersonalityFromWebhookUsername(webhookUsername);

        // Assert
        expect(result).toBe('test-123');
      });
    });

    describe('error handling', () => {
      it('should handle router returning null', async () => {
        // Arrange
        mockPersonalityApplicationService.getPersonality.mockResolvedValue(null);

        // Act
        const result = await messageHistory._getPersonalityFromWebhookUsername('Test');

        // Assert
        expect(result).toBeNull();
      });

      it('should handle router throwing error', async () => {
        // Arrange
        mockPersonalityApplicationService.getPersonality.mockRejectedValue(new Error('Router error'));

        // Act
        const result = await messageHistory._getPersonalityFromWebhookUsername('Test');

        // Assert
        expect(result).toBeNull();
        expect(logger.error).toHaveBeenCalledWith(
          expect.stringContaining('Error looking up personality by webhook username')
        );
      });

      it('should handle ApplicationBootstrap throwing error', async () => {
        // Arrange
        const { getApplicationBootstrap } = require('../../../../src/application/bootstrap/ApplicationBootstrap');
        getApplicationBootstrap.mockImplementation(() => {
          throw new Error('Bootstrap error');
        });

        // Act
        const result = await messageHistory._getPersonalityFromWebhookUsername('Test');

        // Assert
        expect(result).toBeNull();
        expect(logger.error).toHaveBeenCalledWith(
          expect.stringContaining('Error looking up personality by webhook username')
        );
      });
    });

    describe('no matches found', () => {
      it('should return null when no personalities match', async () => {
        // Arrange
        mockPersonalityApplicationService.getPersonality.mockResolvedValue(null);

        // Act
        const result = await messageHistory._getPersonalityFromWebhookUsername('NonExistent');

        // Assert
        expect(result).toBeNull();
        expect(logger.debug).toHaveBeenCalledWith(
          '[MessageHistory] No match found through DDD service after trying all variations'
        );
      });

      it('should return null for empty webhook username', async () => {
        // Act
        const result = await messageHistory._getPersonalityFromWebhookUsername('');

        // Assert
        expect(result).toBeNull();
      });

      it('should return null when router returns empty result', async () => {
        // Arrange
        mockPersonalityApplicationService.getPersonality.mockResolvedValue(null);

        // Act
        const result = await messageHistory._getPersonalityFromWebhookUsername('Test');

        // Assert
        expect(result).toBeNull();
      });
    });

    describe('special characters in personality names', () => {
      it('should handle special characters in webhook names', async () => {
        // Arrange
        const webhookUsername = 'Test.Name-123 | Suffix';
        
        // Mock router to handle special characters
        mockPersonalityApplicationService.getPersonality.mockImplementation(async (nameOrAlias) => {
          if (nameOrAlias === 'Test.Name-123' || nameOrAlias.toLowerCase() === 'test.name-123') {
            return { fullName: 'test-name-123' };
          }
          return null;
        });

        // Act
        const result = await messageHistory._getPersonalityFromWebhookUsername(webhookUsername);

        // Assert
        expect(result).toBe('test-name-123');
      });

      it('should handle display names with parentheses', async () => {
        // Arrange
        const webhookUsername = 'Name (Special) | Tag';
        
        // Mock router to handle parentheses
        mockPersonalityApplicationService.getPersonality.mockImplementation(async (nameOrAlias) => {
          if (nameOrAlias === 'Name (Special)' || nameOrAlias.toLowerCase() === 'name (special)') {
            return { fullName: 'name-special' };
          }
          return null;
        });

        // Act
        const result = await messageHistory._getPersonalityFromWebhookUsername(webhookUsername);

        // Assert
        expect(result).toBe('name-special');
      });
    });

    describe('priority of matching strategies', () => {
      it('should try multiple variations in order', async () => {
        // Arrange
        const webhookUsername = 'TestName | Suffix';
        const callOrder = [];
        
        // Mock router to track call order but only return match on lowercase
        mockPersonalityApplicationService.getPersonality.mockImplementation(async (nameOrAlias) => {
          callOrder.push(nameOrAlias);
          // Only return a match for the lowercase version to ensure all variations are tried
          if (nameOrAlias === 'testname') {
            return { fullName: 'test-123' };
          }
          return null;
        });

        // Act
        await messageHistory._getPersonalityFromWebhookUsername(webhookUsername);

        // Assert
        expect(callOrder).toContain('TestName | Suffix'); // Full name
        expect(callOrder).toContain('TestName'); // Base name
        expect(callOrder).toContain('testname'); // Lowercase base name
      });
    });
  });
});