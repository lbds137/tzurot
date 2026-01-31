/**
 * Test for mock factories
 * Verifies that our mock factories generate working mocks
 */

// Import the mock factories
const {
  createValidatorMock,
  createPersonalityManagerMock,
  createEmbedBuilderMock,
  createConversationManagerMock,
} = require('../../utils/mockFactories');

describe('Mock Factories', () => {
  describe('Validator Mock', () => {
    it('should create a validator mock with default options', () => {
      const mockValidator = createValidatorMock();

      // Check that all expected functions exist
      expect(mockValidator.createDirectSend).toBeDefined();
      expect(mockValidator.isAdmin).toBeDefined();
      expect(mockValidator.canManageMessages).toBeDefined();
      expect(mockValidator.isNsfwChannel).toBeDefined();
      expect(mockValidator.getPermissionErrorMessage).toBeDefined();

      // Check default return values
      expect(mockValidator.isAdmin()).toBe(false);
      expect(mockValidator.canManageMessages()).toBe(false);
      expect(mockValidator.isNsfwChannel()).toBe(false);
      expect(mockValidator.getPermissionErrorMessage()).toBe('Permission error message');
    });

    it('should create a validator mock with custom options', () => {
      const mockValidator = createValidatorMock({
        isAdmin: true,
        canManageMessages: true,
        isNsfwChannel: true,
      });

      // Check custom return values
      expect(mockValidator.isAdmin()).toBe(true);
      expect(mockValidator.canManageMessages()).toBe(true);
      expect(mockValidator.isNsfwChannel()).toBe(true);
    });

    it('should create a working directSend function', async () => {
      const mockValidator = createValidatorMock();

      // Create a mock message
      const mockMessage = {
        channel: {
          send: jest.fn().mockResolvedValue({ id: 'mock-channel-msg-123' }),
        },
      };

      // Get the directSend function
      const mockDirectSend = mockValidator.createDirectSend(mockMessage);
      expect(mockDirectSend).toBeInstanceOf(Function);

      // Test with a string
      const result1 = await mockDirectSend('Test message');
      expect(mockMessage.channel.send).toHaveBeenCalledWith('Test message');
      expect(result1.id).toBe('mock-channel-msg-123');

      // Test with an embed
      const mockEmbed = { embeds: [{ title: 'Test Embed' }] };
      const result2 = await mockDirectSend(mockEmbed);
      expect(mockMessage.channel.send).toHaveBeenCalledWith(mockEmbed);
      expect(result2.id).toBe('mock-channel-msg-123');
    });

    it('should handle missing message or channel in directSend', async () => {
      const mockValidator = createValidatorMock();

      // Create directSend with null message
      const mockDirectSend = mockValidator.createDirectSend(null);

      // It should still work, using the default implementation
      const result = await mockDirectSend('Test message');
      expect(result.id).toBe('direct-send-123');
      expect(result.content).toBe('Test message');

      // Test with an embed
      const resultEmbed = await mockDirectSend({ embeds: [{ title: 'Test' }] });
      expect(resultEmbed.id).toBe('direct-send-123');
      expect(resultEmbed.content).toBe('embed message');
    });
  });

  describe('Personality Manager Mock', () => {
    it('should create a personality manager mock with default options', () => {
      const mockPM = createPersonalityManagerMock();

      // Check that all expected functions exist
      expect(mockPM.getPersonality).toBeDefined();
      expect(mockPM.getPersonalityByAlias).toBeDefined();
      expect(mockPM.removePersonality).toBeDefined();
      expect(mockPM.addPersonality).toBeDefined();
      expect(mockPM.addAlias).toBeDefined();
      expect(mockPM.listPersonalitiesForUser).toBeDefined();
      expect(mockPM.activatePersonality).toBeDefined();
      expect(mockPM.deactivatePersonality).toBeDefined();
      expect(mockPM.getActivatedPersonality).toBeDefined();

      // Check default return values
      const defaultPersonality = mockPM.getPersonality();
      expect(defaultPersonality.fullName).toBe('test-personality');
      expect(defaultPersonality.displayName).toBe('Test Personality');
      expect(mockPM.getPersonalityByAlias()).toBeNull();
      expect(mockPM.getActivatedPersonality()).toBeNull();
    });

    it('should create personality manager mock with custom options', () => {
      const customPersonality = {
        fullName: 'custom-personality',
        displayName: 'Custom Personality',
        avatarUrl: 'https://example.com/custom.png',
      };

      const customAlias = {
        fullName: 'alias-personality',
        displayName: 'Alias Personality',
        avatarUrl: 'https://example.com/alias.png',
      };

      const mockPM = createPersonalityManagerMock({
        defaultPersonality: customPersonality,
        defaultAlias: customAlias,
        removeSuccess: false,
      });

      // Check custom return values
      expect(mockPM.getPersonality().fullName).toBe('custom-personality');
      expect(mockPM.getPersonalityByAlias().fullName).toBe('alias-personality');

      // Check remove success flag
      return mockPM.removePersonality().then(result => {
        expect(result.success).toBe(false);
      });
    });

    it('should properly mock async functions', async () => {
      const mockPM = createPersonalityManagerMock();

      const removeResult = await mockPM.removePersonality();
      expect(removeResult.success).toBe(true);

      const addResult = await mockPM.addPersonality();
      expect(addResult.success).toBe(true);

      const aliasResult = await mockPM.addAlias();
      expect(aliasResult.success).toBe(true);
    });
  });

  describe('EmbedBuilder Mock', () => {
    it('should create a functioning embed builder mock', () => {
      const mockEmbedBuilder = createEmbedBuilderMock();

      // Create a new embed instance
      const mockEmbed = new mockEmbedBuilder();

      // Test that method chaining works
      const result = mockEmbed
        .setTitle('Test Title')
        .setDescription('Test Description')
        .setColor(0xff0000)
        .addFields({ name: 'Field 1', value: 'Value 1' });

      // Should return the same instance
      expect(result).toBe(mockEmbed);

      // Check function calls
      expect(mockEmbed.setTitle).toHaveBeenCalledWith('Test Title');
      expect(mockEmbed.setDescription).toHaveBeenCalledWith('Test Description');
      expect(mockEmbed.setColor).toHaveBeenCalledWith(0xff0000);
      expect(mockEmbed.addFields).toHaveBeenCalledWith({ name: 'Field 1', value: 'Value 1' });

      // Check toJSON
      const json = mockEmbed.toJSON();
      expect(json.title).toBe('Test Embed'); // Default from mock
      expect(json.description).toBe('Test description'); // Default from mock
      expect(json.color).toBe(0x0099ff); // Default from mock
    });
  });

  describe('Conversation Manager Mock', () => {
    it('should create a conversation manager mock with default options', () => {
      const mockCM = createConversationManagerMock();

      // Check that all expected functions exist
      expect(mockCM.hasActiveConversation).toBeDefined();
      expect(mockCM.isAutoRespondEnabled).toBeDefined();
      expect(mockCM.trackMessage).toBeDefined();
      expect(mockCM.getLastPersonalityForChannel).toBeDefined();
      expect(mockCM.clearConversation).toBeDefined();
      expect(mockCM.setAutoRespond).toBeDefined();
      expect(mockCM.isReferencedMessageFromPersonality).toBeDefined();
      expect(mockCM.getPersonalityFromReferencedMessage).toBeDefined();

      // Check default return values
      expect(mockCM.hasActiveConversation()).toBe(false);
      expect(mockCM.isAutoRespondEnabled()).toBe(false);
      expect(mockCM.trackMessage()).toBe(true);
      expect(mockCM.getLastPersonalityForChannel()).toBeNull();
      expect(mockCM.clearConversation()).toBe(true);
      expect(mockCM.setAutoRespond()).toBe(true);
      expect(mockCM.isReferencedMessageFromPersonality()).toBe(false);
      expect(mockCM.getPersonalityFromReferencedMessage()).toBeNull();
    });

    it('should create conversation manager mock with custom options', () => {
      const mockCM = createConversationManagerMock({
        hasActiveConversation: true,
        autoRespondEnabled: true,
        clearSuccess: false,
      });

      // Check custom return values
      expect(mockCM.hasActiveConversation()).toBe(true);
      expect(mockCM.isAutoRespondEnabled()).toBe(true);
      expect(mockCM.clearConversation()).toBe(false);
    });
  });
});
