/**
 * Embed detection and deletion tests
 * Enhanced with bot integration test patterns
 */

// Import enhanced test helpers
const { createMigrationHelper } = require('../utils/testEnhancements');

describe('Embed detection and deletion', () => {
  let migrationHelper;
  let consoleMock;
  
  beforeEach(() => {
    // Create bot integration migration helper
    migrationHelper = createMigrationHelper('bot');
    
    // Enhanced console mocking
    consoleMock = migrationHelper.bridge.mockConsole();
    
    // Enhanced global state setup
    migrationHelper.bridge.setupBotGlobals();
  });
  
  afterEach(() => {
    // Enhanced cleanup
    consoleMock.restore();
    migrationHelper.bridge.cleanupBotGlobals();
  });
  
  // Define a function that replicates the embed detection logic from bot.js
  const detectIncompleteEmbed = (message) => {
    if (!message.embeds || message.embeds.length === 0 || !message.embeds[0].title) {
      return false;
    }
    
    if (message.embeds[0].title === "Personality Added") {
      // Check if this embed has incomplete information (missing display name or avatar)
      const isIncompleteEmbed = (
        message.embeds[0].fields?.some(field => 
          field.name === "Display Name" && 
          (field.value === "Not set" || field.value.includes("-ba-et-") || field.value.includes("-zeevat-"))
        ) || 
        !message.embeds[0].thumbnail // No avatar/thumbnail
      );
      
      return isIncompleteEmbed;
    }
    
    return false;
  };
  
  // Define a function that mocks the actual deletion logic
  const handleEmbedMessage = async (message) => {
    if (detectIncompleteEmbed(message)) {
      try {
        await message.delete();
        return true;
      } catch (error) {
        console.error("Error deleting message:", error);
        return false;
      }
    }
    return false;
  };

  it('should detect incomplete embed with raw display name', async () => {
    // Create a mock message with an incomplete embed
    const incompleteEmbed = {
      title: "Personality Added",
      description: "Successfully added personality: test-name-ba-et-something",
      fields: [
        { name: "Full Name", value: "test-name-ba-et-something" },
        { name: "Display Name", value: "test-name-ba-et-something" },
        { name: "Alias", value: "None set" }
      ],
      // No thumbnail/avatar
    };
    
    const message = migrationHelper.bridge.createCompatibleMockMessage({ 
      id: 'mock-message-1', 
      embeds: [incompleteEmbed],
      isBot: true 
    });
    
    // Test the detection
    expect(detectIncompleteEmbed(message)).toBe(true);
    
    // Test the handler
    const result = await handleEmbedMessage(message);
    expect(result).toBe(true);
    expect(message.delete).toHaveBeenCalled();
  });
  
  it('should detect incomplete embed with "Not set" display name', async () => {
    // Create a mock message with an incomplete embed
    const incompleteEmbed = {
      title: "Personality Added",
      description: "Successfully added personality: test-name",
      fields: [
        { name: "Full Name", value: "test-name" },
        { name: "Display Name", value: "Not set" },
        { name: "Alias", value: "None set" }
      ],
      // No thumbnail/avatar
    };
    
    const message = migrationHelper.bridge.createCompatibleMockMessage({ 
      id: 'mock-message-2', 
      embeds: [incompleteEmbed],
      isBot: true 
    });
    
    // Test the detection
    expect(detectIncompleteEmbed(message)).toBe(true);
  });
  
  it('should detect incomplete embed with missing thumbnail', async () => {
    // Create a mock message with an incomplete embed
    const incompleteEmbed = {
      title: "Personality Added",
      description: "Successfully added personality: test-name",
      fields: [
        { name: "Full Name", value: "test-name" },
        { name: "Display Name", value: "Proper Name" }, // Proper display name
        { name: "Alias", value: "None set" }
      ],
      // No thumbnail/avatar
    };
    
    const message = migrationHelper.bridge.createCompatibleMockMessage({ 
      id: 'mock-message-3', 
      embeds: [incompleteEmbed],
      isBot: true 
    });
    
    // Test the detection
    expect(detectIncompleteEmbed(message)).toBe(true);
  });
  
  it('should not detect complete embed with proper display name and thumbnail', async () => {
    // Create a mock message with a complete embed
    const completeEmbed = {
      title: "Personality Added",
      description: "Successfully added personality: Test Name",
      fields: [
        { name: "Full Name", value: "test-name" },
        { name: "Display Name", value: "Test Name" }, // Proper display name
        { name: "Alias", value: "test" }
      ],
      thumbnail: { url: "https://example.com/avatar.png" } // Has thumbnail/avatar
    };
    
    const message = migrationHelper.bridge.createCompatibleMockMessage({ 
      id: 'mock-message-4', 
      embeds: [completeEmbed],
      isBot: true 
    });
    
    // Test the detection
    expect(detectIncompleteEmbed(message)).toBe(false);
    
    // Test the handler
    const result = await handleEmbedMessage(message);
    expect(result).toBe(false);
    expect(message.delete).not.toHaveBeenCalled();
  });
  
  it('should ignore non-personality embeds', async () => {
    // Create a mock message with a different kind of embed
    const otherEmbed = {
      title: "Some Other Embed",
      description: "This is not a personality embed",
      fields: []
    };
    
    const message = migrationHelper.bridge.createCompatibleMockMessage({ 
      id: 'mock-message-5', 
      embeds: [otherEmbed],
      isBot: true 
    });
    
    // Test the detection
    expect(detectIncompleteEmbed(message)).toBe(false);
  });
  
  it('should handle embeds with zeevat pattern in display name', async () => {
    // Create a mock message with an incomplete embed
    const incompleteEmbed = {
      title: "Personality Added",
      description: "Successfully added personality: loona-zeevat-yareakh-ve-lev",
      fields: [
        { name: "Full Name", value: "loona-zeevat-yareakh-ve-lev" },
        { name: "Display Name", value: "loona-zeevat-yareakh-ve-lev" },
        { name: "Alias", value: "None set" }
      ],
      // No thumbnail/avatar
    };
    
    const message = migrationHelper.bridge.createCompatibleMockMessage({ 
      id: 'mock-message-6', 
      embeds: [incompleteEmbed],
      isBot: true 
    });
    
    // Test the detection
    expect(detectIncompleteEmbed(message)).toBe(true);
  });
});