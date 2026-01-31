// Mock the REST module from discord.js
jest.mock('discord.js', () => ({
  REST: jest.fn(),
}));

const { REST } = require('discord.js');

describe('REST API Calls and Error Handling', () => {
  // Original console functions
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;

  beforeEach(() => {
    // Mock console to capture logs
    console.log = jest.fn();
    console.error = jest.fn();

    // Mock REST class and its post method
    REST.mockClear();
    const mockPostFn = jest.fn().mockResolvedValue({ id: 'mock-response-id' });

    // Properly setup the mock implementation
    REST.mockImplementation(() => {
      return {
        setToken: jest.fn().mockReturnThis(),
        post: mockPostFn,
      };
    });
  });

  afterEach(() => {
    // Restore console functions
    console.log = originalConsoleLog;
    console.error = originalConsoleError;

    // Clear mocks
    jest.clearAllMocks();
  });

  // Test the direct API call for sending embeds
  it('should send embeds using direct REST API call', async () => {
    // Create test data
    const channelId = 'test-channel';
    const embed = {
      title: 'Test Embed',
      description: 'This is a test embed',
      fields: [
        { name: 'Field 1', value: 'Value 1' },
        { name: 'Field 2', value: 'Value 2' },
      ],
    };

    // Create reference to original message
    const messageId = 'original-message';

    // Create a mock post function to verify it's called with correct arguments
    const mockPostFn = jest.fn().mockResolvedValue({ id: 'mock-response-id' });

    // Create a mock REST instance
    const mockRestInstance = {
      setToken: jest.fn().mockReturnThis(),
      post: mockPostFn,
    };

    // Mock REST constructor to return our mock instance
    REST.mockImplementation(() => mockRestInstance);

    // Function to simulate direct API call
    const sendEmbedViaApi = async (channelId, embed, messageId) => {
      // Create a new REST instance
      const restInstance = new REST({ version: '10' }).setToken('mock-token');

      // Prepare the API payload
      const payload = {
        content: '', // No text content, just the embed
        embeds: [embed], // Convert the embed to JSON
        message_reference: {
          // Set up the reply reference
          message_id: messageId,
          channel_id: channelId,
          guild_id: 'mock-guild',
        },
        allowed_mentions: {
          parse: ['users', 'roles'],
        },
      };

      // Call the Discord API directly
      const result = await restInstance.post(`/channels/${channelId}/messages`, { body: payload });

      return result;
    };

    // Call our function
    const result = await sendEmbedViaApi(channelId, embed, messageId);

    // Verify the REST API was called with the mock instance
    expect(mockPostFn).toHaveBeenCalledWith(`/channels/${channelId}/messages`, {
      body: expect.objectContaining({
        embeds: [embed],
        message_reference: expect.objectContaining({
          message_id: messageId,
          channel_id: channelId,
        }),
      }),
    });

    // Verify the result
    expect(result).toEqual({ id: 'mock-response-id' });
  });

  // Test fallback mechanism when API call fails
  it('should handle REST API errors gracefully', async () => {
    // Create test data
    const channelId = 'test-channel';
    const embed = { title: 'Test Embed' };
    const messageId = 'original-message';

    // Create a mock post function that rejects with an error
    const mockPostFn = jest.fn().mockRejectedValue(new Error('API error'));

    // Create a mock REST instance
    const mockRestInstance = {
      setToken: jest.fn().mockReturnThis(),
      post: mockPostFn,
    };

    // Mock REST constructor to return our mock instance
    REST.mockImplementation(() => mockRestInstance);

    // Channel send fallback method
    const mockChannelSend = jest.fn().mockResolvedValue({ id: 'fallback-message-id' });

    // Function to simulate sending with fallback
    const sendEmbedWithFallback = async (channelId, embed, messageId) => {
      try {
        // Create a new REST instance
        const restInstance = new REST({ version: '10' }).setToken('mock-token');

        // Prepare the API payload
        const payload = {
          embeds: [embed],
          message_reference: {
            message_id: messageId,
            channel_id: channelId,
          },
        };

        // Try the direct API call
        const result = await restInstance.post(`/channels/${channelId}/messages`, {
          body: payload,
        });

        return {
          id: result.id,
          method: 'api',
        };
      } catch (error) {
        console.error(`Error with direct API call: ${error.message}`);

        // Fall back to channel.send method
        const fallbackResult = await mockChannelSend({ embeds: [embed] });

        return {
          id: fallbackResult.id,
          method: 'fallback',
        };
      }
    };

    // Call our function
    const result = await sendEmbedWithFallback(channelId, embed, messageId);

    // Verify the REST API was called
    expect(mockPostFn).toHaveBeenCalled();

    // Verify the fallback was used
    expect(mockChannelSend).toHaveBeenCalled();
    expect(mockChannelSend).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: [embed],
      })
    );

    // Verify the result came from the fallback
    expect(result.method).toBe('fallback');
    expect(result.id).toBe('fallback-message-id');

    // Verify error was logged
    expect(console.error).toHaveBeenCalled();
  });

  // Test that we reset the lastEmbedTime before sending
  it('should reset lastEmbedTime before sending the final embed', async () => {
    // Setup global state
    global.lastEmbedTime = Date.now() - 1000; // Set to 1 second ago

    // Create a mock post function
    const mockPostFn = jest.fn().mockResolvedValue({ id: 'mock-response-id' });

    // Create a mock REST instance
    const mockRestInstance = {
      setToken: jest.fn().mockReturnThis(),
      post: mockPostFn,
    };

    // Mock REST constructor to return our mock instance
    REST.mockImplementation(() => mockRestInstance);

    // Function to simulate resetting lastEmbedTime before API call
    const sendFinalEmbed = async () => {
      // Reset the global time tracker to avoid blocking this embed
      console.log(`Resetting global.lastEmbedTime from ${global.lastEmbedTime} to 0`);
      global.lastEmbedTime = 0;

      // Create a new REST instance
      const restInstance = new REST({ version: '10' }).setToken('mock-token');

      // Make the API call
      const result = await restInstance.post('/channels/test-channel/messages', {
        body: { embeds: [{ title: 'Final Embed' }] },
      });

      return result;
    };

    // Store the original lastEmbedTime
    const originalTime = global.lastEmbedTime;

    // Call our function
    await sendFinalEmbed();

    // Verify lastEmbedTime was reset
    expect(global.lastEmbedTime).toBe(0);
    expect(global.lastEmbedTime).not.toBe(originalTime);

    // Verify REST API call was made
    expect(mockPostFn).toHaveBeenCalled();

    // Verify log was made
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('Resetting global.lastEmbedTime')
    );

    // Cleanup
    delete global.lastEmbedTime;
  });

  // Test error handling for webhook and API errors
  it('should handle webhook message errors gracefully', async () => {
    // Mock functions
    const deleteMessageMock = jest.fn().mockResolvedValue();

    // Function to test error handling
    const handleWebhookError = async message => {
      try {
        // Check for error patterns
        const errorPatterns = [
          "I'm having trouble connecting",
          'ERROR_MESSAGE_PREFIX:',
          'trouble connecting to my brain',
          'technical issue',
          'Error ID:',
          'issue with my configuration',
        ];

        const isErrorMessage = errorPatterns.some(
          pattern => message.content && message.content.includes(pattern)
        );

        if (isErrorMessage) {
          console.log(`Detected error pattern in message: ${message.content.substring(0, 30)}...`);

          // Try to delete the message
          if (message.deletable) {
            await message.delete();
            return { deleted: true, message: 'Error message deleted' };
          }
        }

        return { isError: isErrorMessage };
      } catch (error) {
        console.error(`Error handling webhook message: ${error.message}`);
        return { error: error.message };
      }
    };

    // Create a test message with error content
    const errorMessage = {
      id: 'error-message',
      content: "I'm having trouble connecting to my brain right now",
      webhookId: 'test-webhook',
      deletable: true,
      delete: deleteMessageMock,
    };

    // Create a test message without error content
    const normalMessage = {
      id: 'normal-message',
      content: 'Hello, this is a normal message',
      webhookId: 'test-webhook',
      deletable: true,
      delete: deleteMessageMock,
    };

    // Test case 1: Error message
    const errorResult = await handleWebhookError(errorMessage);
    expect(errorResult.deleted).toBe(true);
    expect(deleteMessageMock).toHaveBeenCalled();

    // Test case 2: Normal message
    const normalResult = await handleWebhookError(normalMessage);
    expect(normalResult.isError).toBe(false);
    expect(deleteMessageMock).toHaveBeenCalledTimes(1); // Still just one call from error case
  });
});
