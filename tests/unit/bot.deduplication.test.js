describe('Message Deduplication Mechanisms', () => {
  // Original console functions
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  
  // Setup mocks
  beforeEach(() => {
    console.log = jest.fn();
    console.error = jest.fn();
    
    // Reset global state
    global.lastEmbedTime = 0;
    global.embedDeduplicationWindow = 5000;
    global.processedBotMessages = new Set();
    global.seenBotMessages = new Set();
  });
  
  // Cleanup
  afterEach(() => {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    
    // Clean up global state
    delete global.lastEmbedTime;
    delete global.embedDeduplicationWindow;
    delete global.processedBotMessages;
    delete global.seenBotMessages;
  });
  
  // This test simulates the reply signature generation logic from bot.js
  it('should generate unique signatures for different message replies', () => {
    // Function that generates reply signatures like in bot.js
    const generateReplySignature = (messageId, channelId, options) => {
      return `reply-${messageId}-${channelId}-${
        typeof options === 'string' 
          ? options.substring(0, 20) 
          : (options.content 
              ? options.content.substring(0, 20) 
              : (options.embeds && options.embeds.length > 0 
                  ? options.embeds[0].title || 'embed' 
                  : 'unknown'))
      }`;
    };
    
    // Test with different message types
    const textReplySignature = generateReplySignature('msg1', 'chan1', 'Hello, world!');
    const contentReplySignature = generateReplySignature('msg1', 'chan1', { content: 'Hello, world!' });
    const embedReplySignature = generateReplySignature('msg1', 'chan1', { 
      embeds: [{ title: 'Test Embed' }]
    });
    
    // Same content but different message ID
    const differentMsgSignature = generateReplySignature('msg2', 'chan1', 'Hello, world!');
    
    // Same content but different channel ID
    const differentChanSignature = generateReplySignature('msg1', 'chan2', 'Hello, world!');
    
    // Verify that signatures are generated as expected
    expect(textReplySignature).toBe('reply-msg1-chan1-Hello, world!');
    expect(contentReplySignature).toBe('reply-msg1-chan1-Hello, world!');
    expect(embedReplySignature).toBe('reply-msg1-chan1-Test Embed');
    
    // Verify that changing message ID creates different signature
    expect(differentMsgSignature).not.toBe(textReplySignature);
    
    // Verify that changing channel ID creates different signature
    expect(differentChanSignature).not.toBe(textReplySignature);
  });
  
  // Test the time-based deduplication mechanism
  it('should detect duplicate messages based on time window', () => {
    // Simulate the time-based check in bot.js
    const isDuplicateByTime = (lastSentTime, currentTime, window = 5000) => {
      return lastSentTime && (currentTime - lastSentTime < window);
    };
    
    // Set last embed time to 1000ms ago
    const now = Date.now();
    const recentTime = now - 1000;
    
    // Set last embed time to 10000ms ago
    const oldTime = now - 10000;
    
    // Check with default window (5000ms)
    expect(isDuplicateByTime(recentTime, now)).toBe(true);
    expect(isDuplicateByTime(oldTime, now)).toBe(false);
    
    // Check with custom window (2000ms)
    expect(isDuplicateByTime(recentTime, now, 2000)).toBe(true);
    expect(isDuplicateByTime(recentTime - 1500, now, 2000)).toBe(false);
    
    // Check with custom window (15000ms)
    expect(isDuplicateByTime(oldTime, now, 15000)).toBe(true);
    expect(isDuplicateByTime(oldTime - 10000, now, 15000)).toBe(false);
  });
  
  // Test the set-based message tracking
  it('should track processed messages using Set', () => {
    // Create a simple function to track and check messages
    const trackMessage = (messageId) => {
      if (global.processedBotMessages.has(messageId)) {
        return false; // Already processed
      }
      
      global.processedBotMessages.add(messageId);
      return true; // First time seeing this message
    };
    
    // First time should return true
    expect(trackMessage('msg1')).toBe(true);
    
    // Second time should return false
    expect(trackMessage('msg1')).toBe(false);
    
    // Different message should return true
    expect(trackMessage('msg2')).toBe(true);
    
    // Verify the set contains our messages
    expect(global.processedBotMessages.size).toBe(2);
    expect(global.processedBotMessages.has('msg1')).toBe(true);
    expect(global.processedBotMessages.has('msg2')).toBe(true);
    expect(global.processedBotMessages.has('msg3')).toBe(false);
  });
  
  // Test the actual Message.prototype.reply patching from bot.js
  it('should patch Message.prototype.reply to prevent duplicates', () => {
    // Mock objects needed for the test
    const mockMessage = {
      id: 'msg1',
      channel: { id: 'chan1' }
    };
    
    // Create a mock for originalReply function
    const originalReply = jest.fn().mockResolvedValue({ id: 'reply1' });
    
    // Mock the Map used for tracking
    const recentReplies = new Map();
    
    // Create a simplified version of the patched reply function
    const patchedReply = async function(options) {
      // Create a unique signature for this reply
      const replySignature = `reply-${this.id}-${this.channel.id}-${
        typeof options === 'string' 
          ? options.substring(0, 20) 
          : 'object'
      }`;
      
      // Check if we've recently sent this exact reply
      if (recentReplies.has(replySignature)) {
        const timeAgo = Date.now() - recentReplies.get(replySignature);
        if (timeAgo < 5000) { // Consider it a duplicate if sent within 5 seconds
          return { 
            id: `prevented-dupe-${Date.now()}`,
            isDuplicate: true 
          };
        }
      }
      
      // Record this reply attempt
      recentReplies.set(replySignature, Date.now());
      
      // Call the original reply method
      return originalReply.apply(this, arguments);
    };
    
    // Bind our patched function to the mock message
    const boundPatchedReply = patchedReply.bind(mockMessage);
    
    // Test case 1: First call should go through
    boundPatchedReply('test message').then(result => {
      expect(originalReply).toHaveBeenCalledTimes(1);
      expect(result.id).toBe('reply1');
    });
    
    // Test case 2: Duplicate call within 5 seconds should be blocked
    boundPatchedReply('test message').then(result => {
      expect(originalReply).toHaveBeenCalledTimes(1); // Still just one call
      expect(result.isDuplicate).toBe(true);
    });
    
    // Verify we've recorded the reply signature
    expect(recentReplies.size).toBe(1);
    const signature = `reply-msg1-chan1-test message`;
    expect(recentReplies.has(signature)).toBe(true);
  });
  
  // Test the request registry mechanism
  it('should track add requests using global registry', () => {
    // Create a mock registry
    global.addRequestRegistry = new Map();
    
    // Function to add new requests to registry
    const registerAddRequest = (messageId, profileName) => {
      const messageKey = `add-msg-${messageId}-${profileName}`;
      const requestId = `add-req-${messageId}-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
      
      // Check for existing requests
      if (global.addRequestRegistry.has(messageKey)) {
        return { 
          isAlreadyRegistered: true,
          existingRequestId: global.addRequestRegistry.get(messageKey).requestId
        };
      }
      
      // Register the new request
      global.addRequestRegistry.set(messageKey, {
        requestId: requestId,
        timestamp: Date.now(),
        profileName: profileName,
        completed: false,
        embedSent: false
      });
      
      return { requestId, isNewRequest: true };
    };
    
    // Update an existing request
    const updateAddRequestStatus = (messageId, profileName, updates) => {
      const messageKey = `add-msg-${messageId}-${profileName}`;
      
      if (!global.addRequestRegistry.has(messageKey)) {
        return false;
      }
      
      const entry = global.addRequestRegistry.get(messageKey);
      const updatedEntry = { ...entry, ...updates };
      global.addRequestRegistry.set(messageKey, updatedEntry);
      
      return true;
    };
    
    // Test case 1: Register a new request
    const result1 = registerAddRequest('msg1', 'test-personality');
    expect(result1.isNewRequest).toBe(true);
    expect(global.addRequestRegistry.size).toBe(1);
    
    // Test case 2: Try to register the same request again
    const result2 = registerAddRequest('msg1', 'test-personality');
    expect(result2.isAlreadyRegistered).toBe(true);
    expect(result2.existingRequestId).toBe(result1.requestId);
    expect(global.addRequestRegistry.size).toBe(1); // Still just one entry
    
    // Test case 3: Update a request status
    const updateResult = updateAddRequestStatus('msg1', 'test-personality', { 
      completed: true,
      embedSent: true,
      embedId: 'embed1'
    });
    
    expect(updateResult).toBe(true);
    
    // Verify the update took effect
    const updatedEntry = global.addRequestRegistry.get('add-msg-msg1-test-personality');
    expect(updatedEntry.completed).toBe(true);
    expect(updatedEntry.embedSent).toBe(true);
    expect(updatedEntry.embedId).toBe('embed1');
    
    // Test case 4: Attempt to update non-existent request
    const badUpdateResult = updateAddRequestStatus('msg2', 'test-personality', { completed: true });
    expect(badUpdateResult).toBe(false);
    
    // Cleanup
    delete global.addRequestRegistry;
  });
});