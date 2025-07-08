const MessageHistory = require('../../../../src/core/conversation/MessageHistory');
const logger = require('../../../../src/logger');

// Mock the logger
jest.mock('../../../../src/logger');

// Mock the personality module
jest.mock('../../../../src/core/personality', () => ({
  getAllPersonalities: jest.fn(),
}));

// Mock DDD modules
jest.mock('../../../../src/application/services/FeatureFlags');
jest.mock('../../../../src/application/bootstrap/ApplicationBootstrap');

describe('MessageHistory', () => {
  let messageHistory;
  let mockConversationTracker;
  let mockPersonalityModule;
  let mockFeatureFlags;
  let mockPersonalityRouter;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock conversation tracker
    mockConversationTracker = {
      getConversationByMessageId: jest.fn(),
    };

    // Create new instance
    messageHistory = new MessageHistory(mockConversationTracker);

    // Get the mocked personality module
    mockPersonalityModule = require('../../../../src/core/personality');

    // Mock DDD modules to use legacy system by default
    const { getFeatureFlags } = require('../../../../src/application/services/FeatureFlags');
    const { getApplicationBootstrap } = require('../../../../src/application/bootstrap/ApplicationBootstrap');
    
    mockFeatureFlags = {
      isEnabled: jest.fn().mockReturnValue(false), // Use legacy system
    };
    getFeatureFlags.mockReturnValue(mockFeatureFlags);

    mockPersonalityRouter = {
      getPersonality: jest.fn().mockResolvedValue(null),
    };
    const mockBootstrap = {
      getPersonalityRouter: jest.fn().mockReturnValue(mockPersonalityRouter),
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
      mockPersonalityModule.getAllPersonalities.mockReturnValue([
        { fullName: 'test-personality', displayName: 'TestPersonality' },
      ]);

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
        mockPersonalityModule.getAllPersonalities.mockReturnValue([
          { fullName: 'desidara-123', displayName: 'Desidara' },
          { fullName: 'other-456', displayName: 'Other' },
        ]);

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
        mockPersonalityModule.getAllPersonalities.mockReturnValue([
          { fullName: 'test-123', displayName: 'TestName' },
        ]);

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
        mockPersonalityModule.getAllPersonalities.mockReturnValue([
          { fullName: 'spaced-123', displayName: 'SpacedName' },
        ]);

        // Act
        const result = await messageHistory._getPersonalityFromWebhookUsername(webhookUsername);

        // Assert
        expect(result).toBe('spaced-123');
      });

      it('should match using webhook pattern regex', async () => {
        // Arrange
        const webhookUsername = 'PersonalityName | SomeTag';
        mockPersonalityModule.getAllPersonalities.mockReturnValue([
          { fullName: 'personality-123', displayName: 'PersonalityName' },
        ]);

        // Act
        const result = await messageHistory._getPersonalityFromWebhookUsername(webhookUsername);

        // Assert
        expect(result).toBe('personality-123');
        expect(logger.debug).toHaveBeenCalledWith(
          expect.stringContaining('Found personality match')
        );
      });
    });

    describe('exact matching', () => {
      it('should find exact match with full webhook username', async () => {
        // Arrange
        const webhookUsername = 'ExactMatch';
        mockPersonalityModule.getAllPersonalities.mockReturnValue([
          { fullName: 'exact-123', displayName: 'ExactMatch' },
        ]);

        // Act
        const result = await messageHistory._getPersonalityFromWebhookUsername(webhookUsername);

        // Assert
        expect(result).toBe('exact-123');
      });

      it('should find exact match with extracted base name', async () => {
        // Arrange
        const webhookUsername = 'BaseName | Suffix';
        mockPersonalityModule.getAllPersonalities.mockReturnValue([
          { fullName: 'base-123', displayName: 'BaseName' },
        ]);

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
        mockPersonalityModule.getAllPersonalities.mockReturnValue([
          { fullName: 'upper-123', displayName: 'uppercase' },
        ]);

        // Act
        const result = await messageHistory._getPersonalityFromWebhookUsername(webhookUsername);

        // Assert
        expect(result).toBe('upper-123');
      });

      it('should match case-insensitively with base name', async () => {
        // Arrange
        const webhookUsername = 'MixedCase | suffix';
        mockPersonalityModule.getAllPersonalities.mockReturnValue([
          { fullName: 'mixed-123', displayName: 'mixedcase' },
        ]);

        // Act
        const result = await messageHistory._getPersonalityFromWebhookUsername(webhookUsername);

        // Assert
        expect(result).toBe('mixed-123');
      });

      it('should handle Hebrew characters in webhook username', async () => {
        // Arrange
        const webhookUsername = 'TestName | שלום';
        mockPersonalityModule.getAllPersonalities.mockReturnValue([
          { fullName: 'test-123', displayName: 'TestName' },
        ]);

        // Act
        const result = await messageHistory._getPersonalityFromWebhookUsername(webhookUsername);

        // Assert
        expect(result).toBe('test-123');
      });
    });

    describe('error handling', () => {
      it('should handle getAllPersonalities returning null', async () => {
        // Arrange
        mockPersonalityModule.getAllPersonalities.mockReturnValue(null);

        // Act
        const result = await messageHistory._getPersonalityFromWebhookUsername('Test');

        // Assert
        expect(result).toBeNull();
        expect(logger.error).toHaveBeenCalledWith(
          expect.stringContaining('getAllPersonalities returned invalid data')
        );
      });

      it('should handle getAllPersonalities returning non-array', async () => {
        // Arrange
        mockPersonalityModule.getAllPersonalities.mockReturnValue('not-an-array');

        // Act
        const result = await messageHistory._getPersonalityFromWebhookUsername('Test');

        // Assert
        expect(result).toBeNull();
        expect(logger.error).toHaveBeenCalledWith(
          expect.stringContaining('getAllPersonalities returned invalid data')
        );
      });

      it('should handle personalities with missing displayName', async () => {
        // Arrange
        mockPersonalityModule.getAllPersonalities.mockReturnValue([
          { fullName: 'test-123' }, // No displayName
          { fullName: 'valid-456', displayName: 'Valid' },
        ]);

        // Act
        const result = await messageHistory._getPersonalityFromWebhookUsername('Valid');

        // Assert
        expect(result).toBe('valid-456');
      });

      it('should handle null personality entries', async () => {
        // Arrange
        mockPersonalityModule.getAllPersonalities.mockReturnValue([
          null,
          { fullName: 'valid-123', displayName: 'Valid' },
        ]);

        // Act
        const result = await messageHistory._getPersonalityFromWebhookUsername('Valid');

        // Assert
        expect(result).toBe('valid-123');
      });

      it('should handle personality module throwing error', async () => {
        // Arrange
        mockPersonalityModule.getAllPersonalities.mockImplementation(() => {
          throw new Error('Module error');
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
        mockPersonalityModule.getAllPersonalities.mockReturnValue([
          { fullName: 'other-123', displayName: 'Other' },
        ]);

        // Act
        const result = await messageHistory._getPersonalityFromWebhookUsername('NonExistent');

        // Assert
        expect(result).toBeNull();
        expect(logger.debug).toHaveBeenCalledWith(
          expect.stringContaining('No personality found matching webhook username')
        );
      });

      it('should return null for empty webhook username', async () => {
        // Arrange
        mockPersonalityModule.getAllPersonalities.mockReturnValue([
          { fullName: 'test-123', displayName: 'Test' },
        ]);

        // Act
        const result = await messageHistory._getPersonalityFromWebhookUsername('');

        // Assert
        expect(result).toBeNull();
      });

      it('should return null when no personalities exist', async () => {
        // Arrange
        mockPersonalityModule.getAllPersonalities.mockReturnValue([]);

        // Act
        const result = await messageHistory._getPersonalityFromWebhookUsername('Test');

        // Assert
        expect(result).toBeNull();
      });
    });

    describe('special characters in personality names', () => {
      it('should escape special regex characters in display name', async () => {
        // Arrange
        const webhookUsername = 'Test.Name* | suffix';
        mockPersonalityModule.getAllPersonalities.mockReturnValue([
          { fullName: 'special-123', displayName: 'Test.Name*' },
        ]);

        // Act
        const result = await messageHistory._getPersonalityFromWebhookUsername(webhookUsername);

        // Assert
        expect(result).toBe('special-123');
      });

      it('should handle display names with parentheses', async () => {
        // Arrange
        const webhookUsername = 'Name (Test) | tag';
        mockPersonalityModule.getAllPersonalities.mockReturnValue([
          { fullName: 'paren-123', displayName: 'Name (Test)' },
        ]);

        // Act
        const result = await messageHistory._getPersonalityFromWebhookUsername(webhookUsername);

        // Assert
        expect(result).toBe('paren-123');
      });
    });

    describe('priority of matching strategies', () => {
      it('should prefer exact match over case-insensitive match', async () => {
        // Arrange
        const webhookUsername = 'TestName';
        mockPersonalityModule.getAllPersonalities.mockReturnValue([
          { fullName: 'exact-123', displayName: 'TestName' },
          { fullName: 'case-456', displayName: 'testname' },
        ]);

        // Act
        const result = await messageHistory._getPersonalityFromWebhookUsername(webhookUsername);

        // Assert
        expect(result).toBe('exact-123');
      });

      it('should prefer base name match over pattern match', async () => {
        // Arrange
        const webhookUsername = 'TestName | Suffix';
        mockPersonalityModule.getAllPersonalities.mockReturnValue([
          { fullName: 'pattern-123', displayName: 'Test' }, // Would match pattern
          { fullName: 'base-456', displayName: 'TestName' }, // Exact base name match
        ]);

        // Act
        const result = await messageHistory._getPersonalityFromWebhookUsername(webhookUsername);

        // Assert
        expect(result).toBe('base-456');
      });
    });
  });
});
