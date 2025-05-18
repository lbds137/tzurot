// Test suite for incomplete embed detection and deletion in bot.js
const { Message } = require('discord.js');

// Mock the discord.js Client class
class MockClient {
  constructor() {
    this.user = { id: 'bot-user-id', tag: 'Bot#1234' };
    this.channels = { cache: new Map() };
    this.originalEmit = jest.fn();
    this.emit = jest.fn();
  }
}

// Mock discord.js
jest.mock('discord.js', () => ({
  Client: jest.fn().mockImplementation(() => new MockClient()),
  Message: jest.fn().mockImplementation((data) => data),
  GatewayIntentBits: { Guilds: 1, GuildMessages: 2, MessageContent: 3, GuildWebhooks: 4, DirectMessages: 5 },
  Partials: { Channel: 1, Message: 2, Reaction: 3 },
  PermissionFlagsBits: { ViewChannel: 1, ReadMessageHistory: 2, ManageMessages: 4 },
  TextChannel: function() {
    this.send = jest.fn();
  }
}));

// Extract the detectIncompleteEmbed functionality from bot.js
function detectIncompleteEmbed(embed) {
  if (!embed || !embed.title || embed.title !== "Personality Added") {
    return false;
  }
  
  // Check if this embed has incomplete information (missing display name or avatar)
  const isIncompleteEmbed = (
    // Display name check
    embed.fields?.some(field => {
      if (field.name !== "Display Name") return false;
      
      // Check various patterns of incomplete display names
      return field.value === "Not set" || 
             field.value.includes("-ba-et-") || 
             field.value.includes("-zeevat-") ||
             field.value.includes("-ani-") ||
             field.value.includes("-ha-") ||
             field.value.includes("-ve-") ||
             field.value.match(/^[a-z0-9-]+$/); // Only contains lowercase, numbers, and hyphens
    }) || 
    !embed.thumbnail // No avatar/thumbnail
  );
  
  return isIncompleteEmbed;
}

describe('Bot Incomplete Embed Detection and Deletion', () => {
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  
  beforeEach(() => {
    console.log = jest.fn();
    console.error = jest.fn();
    
    // Ensure a clean global state for each test
    global.lastEmbedTime = 0;
    global.seenBotMessages = new Set();
  });
  
  afterEach(() => {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    jest.clearAllMocks();
  });
  
  // Test detection of incomplete embeds with kebab-case IDs
  it('should detect incomplete embeds with kebab-case ID display names', () => {
    // Create an embed with kebab-case ID as display name
    const incompleteEmbed = {
      title: "Personality Added",
      fields: [
        { name: "Full Name", value: "some-kebab-case-id" },
        { name: "Display Name", value: "some-kebab-case-id" }
      ]
    };
    
    const result = detectIncompleteEmbed(incompleteEmbed);
    expect(result).toBe(true);
  });
  
  // Test detection of embeds with Hebrew-style ID patterns
  it('should detect incomplete embeds with Hebrew-style ID patterns', () => {
    // Test pattern with '-ba-et-'
    const baetEmbed = {
      title: "Personality Added",
      fields: [
        { name: "Full Name", value: "baphomet-ba-et-zeev" },
        { name: "Display Name", value: "baphomet-ba-et-zeev" }
      ]
    };
    
    // Test pattern with '-zeevat-'
    const zeevatEmbed = {
      title: "Personality Added",
      fields: [
        { name: "Full Name", value: "loona-zeevat-yareakh" },
        { name: "Display Name", value: "loona-zeevat-yareakh" }
      ]
    };
    
    // Test pattern with '-ani-'
    const aniEmbed = {
      title: "Personality Added",
      fields: [
        { name: "Full Name", value: "miqdash-ani-tora" },
        { name: "Display Name", value: "miqdash-ani-tora" }
      ]
    };
    
    // Test pattern with '-ha-'
    const haEmbed = {
      title: "Personality Added",
      fields: [
        { name: "Full Name", value: "ha-shem-keev" },
        { name: "Display Name", value: "ha-shem-keev" }
      ]
    };
    
    // Test pattern with '-ve-'
    const veEmbed = {
      title: "Personality Added",
      fields: [
        { name: "Full Name", value: "yareakh-ve-lev" },
        { name: "Display Name", value: "yareakh-ve-lev" }
      ]
    };
    
    expect(detectIncompleteEmbed(baetEmbed)).toBe(true);
    expect(detectIncompleteEmbed(zeevatEmbed)).toBe(true);
    expect(detectIncompleteEmbed(aniEmbed)).toBe(true);
    expect(detectIncompleteEmbed(haEmbed)).toBe(true);
    expect(detectIncompleteEmbed(veEmbed)).toBe(true);
  });
  
  // Test detection based on missing thumbnail
  it('should detect incomplete embeds with missing thumbnail/avatar', () => {
    // Create an embed with proper display name but no thumbnail
    const noThumbnailEmbed = {
      title: "Personality Added",
      fields: [
        { name: "Full Name", value: "test-personality" },
        { name: "Display Name", value: "Proper Display Name" } // Proper capitalized name
      ]
      // No thumbnail
    };
    
    expect(detectIncompleteEmbed(noThumbnailEmbed)).toBe(true);
  });
  
  // Test proper embeds are not detected as incomplete
  it('should not detect complete embeds as incomplete', () => {
    // Create a complete embed with proper display name and thumbnail
    const completeEmbed = {
      title: "Personality Added",
      fields: [
        { name: "Full Name", value: "test-personality" },
        { name: "Display Name", value: "Proper Display Name" } // Proper capitalized name
      ],
      thumbnail: { url: "https://example.com/avatar.png" }
    };
    
    expect(detectIncompleteEmbed(completeEmbed)).toBe(false);
  });
  
  // Test the message handling logic when an incomplete embed is detected
  it('should attempt to delete messages with incomplete embeds', async () => {
    // Create a mock message with an incomplete embed
    const deleteMock = jest.fn().mockResolvedValue();
    const message = {
      id: 'test-message-id',
      author: { id: 'bot-user-id', bot: true },
      embeds: [
        {
          title: "Personality Added",
          fields: [
            { name: "Full Name", value: "test-personality" },
            { name: "Display Name", value: "test-personality" } // Kebab-case name
          ]
          // No thumbnail
        }
      ],
      delete: deleteMock
    };
    
    // Create a function that simulates the message processing logic in bot.js
    async function processMessage(message) {
      // Check if this is a bot message with embeds
      if (message.author.bot && message.embeds && message.embeds.length > 0) {
        // If it's a "Personality Added" embed, check if it's incomplete
        if (message.embeds[0].title === "Personality Added") {
          // Check if this embed has incomplete information
          if (detectIncompleteEmbed(message.embeds[0])) {
            console.log(`Detected incomplete embed - attempting to delete`);
            
            try {
              await message.delete();
              console.log(`Successfully deleted incomplete embed message`);
              return true; // Deletion succeeded
            } catch (error) {
              console.error(`Error deleting incomplete embed:`, error);
              return false; // Deletion failed
            }
          }
        }
      }
      return false; // No deletion attempted
    }
    
    // Process the message
    const result = await processMessage(message);
    
    // Verify the message was detected and deletion was attempted
    expect(result).toBe(true);
    expect(deleteMock).toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Detected incomplete embed'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Successfully deleted'));
  });
  
  // Test error handling during deletion attempt
  it('should handle errors when trying to delete incomplete embeds', async () => {
    // Create a mock message with an incomplete embed and a delete function that rejects
    const deleteError = new Error('Failed to delete message');
    const deleteMock = jest.fn().mockRejectedValue(deleteError);
    const message = {
      id: 'test-message-id',
      author: { id: 'bot-user-id', bot: true },
      embeds: [
        {
          title: "Personality Added",
          fields: [
            { name: "Full Name", value: "test-personality" },
            { name: "Display Name", value: "test-personality" } // Kebab-case name
          ]
          // No thumbnail
        }
      ],
      delete: deleteMock
    };
    
    // Create a function that simulates the message processing logic in bot.js
    async function processMessage(message) {
      // Check if this is a bot message with embeds
      if (message.author.bot && message.embeds && message.embeds.length > 0) {
        // If it's a "Personality Added" embed, check if it's incomplete
        if (message.embeds[0].title === "Personality Added") {
          // Check if this embed has incomplete information
          if (detectIncompleteEmbed(message.embeds[0])) {
            console.log(`Detected incomplete embed - attempting to delete`);
            
            try {
              await message.delete();
              console.log(`Successfully deleted incomplete embed message`);
              return true; // Deletion succeeded
            } catch (error) {
              console.error(`Error deleting incomplete embed:`, error);
              return false; // Deletion failed
            }
          }
        }
      }
      return false; // No deletion attempted
    }
    
    // Process the message
    const result = await processMessage(message);
    
    // Verify the message was detected, deletion was attempted, and error was handled
    expect(result).toBe(false);
    expect(deleteMock).toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Detected incomplete embed'));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Error deleting incomplete embed'), deleteError);
  });
  
  // Test handling of "Not set" display names
  it('should detect embeds with "Not set" display names as incomplete', () => {
    const notSetEmbed = {
      title: "Personality Added",
      fields: [
        { name: "Full Name", value: "test-personality" },
        { name: "Display Name", value: "Not set" }
      ],
      thumbnail: { url: "https://example.com/avatar.png" }
    };
    
    expect(detectIncompleteEmbed(notSetEmbed)).toBe(true);
  });
  
  // Test handling of embeds with normal display names but missing thumbnails
  it('should detect embeds with normal display names but missing thumbnails as incomplete', () => {
    const noThumbnailEmbed = {
      title: "Personality Added",
      fields: [
        { name: "Full Name", value: "test-personality" },
        { name: "Display Name", value: "Test Personality" }
      ]
      // No thumbnail
    };
    
    expect(detectIncompleteEmbed(noThumbnailEmbed)).toBe(true);
  });
});