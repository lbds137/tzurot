// Import Discord.js mock
const { Message } = require('discord.js');

// We need to create a way to test the internal functionality of bot.js
// without actually running the entire bot

// First we'll create some test helpers
const createMockMessage = (id, embeds) => {
  const mockMessage = new Message(id, '', 'mock-user-id', 'mock-channel-id');
  mockMessage.author = { id: 'bot-id', bot: true, username: 'MockBot' };
  mockMessage.embeds = embeds || [];
  mockMessage.delete = jest.fn().mockResolvedValue();
  return mockMessage;
};

describe('Embed detection and deletion', () => {
  // Save original console functions
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  
  // Mock console functions to clean up test output
  beforeEach(() => {
    console.log = jest.fn();
    console.error = jest.fn();
    
    // We need to reset the global state before each test
    global.lastEmbedTime = 0;
  });
  
  // Restore console functions
  afterEach(() => {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
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
    
    const message = createMockMessage('mock-message-1', [incompleteEmbed]);
    
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
    
    const message = createMockMessage('mock-message-2', [incompleteEmbed]);
    
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
    
    const message = createMockMessage('mock-message-3', [incompleteEmbed]);
    
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
    
    const message = createMockMessage('mock-message-4', [completeEmbed]);
    
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
    
    const message = createMockMessage('mock-message-5', [otherEmbed]);
    
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
    
    const message = createMockMessage('mock-message-6', [incompleteEmbed]);
    
    // Test the detection
    expect(detectIncompleteEmbed(message)).toBe(true);
  });
});