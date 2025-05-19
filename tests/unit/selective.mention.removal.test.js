/**
 * Tests for selective @mention removal functionality
 * 
 * This test suite verifies the enhanced regex pattern and replacement logic
 * for removing triggering @mentions only from the beginning or end of messages,
 * while preserving mentions in the middle of messages.
 */

describe('Selective @Mention Removal', () => {
  /**
   * Helper function that simulates the selective mention removal logic used in bot.js
   * @param {string} content - Original message content
   * @param {string} triggeringMention - The mention that triggered the bot
   * @returns {string} - Content with the triggering mention removed only from beginning/end
   */
  function selectivelyRemoveTriggeringMention(content, triggeringMention) {
    if (!content || !triggeringMention) {
      return content;
    }
    
    // Escape special regex characters in the triggering mention
    const escapedMention = triggeringMention.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    // Create regex patterns to match the mention at the beginning or end of the message
    // These patterns also handle punctuation and spacing
    const mentionAtStartRegex = new RegExp(`^\\s*@${escapedMention}\\b\\s*[,;:.!?]?\\s*`, 'i');
    const mentionAtEndRegex = new RegExp(`\\s*@${escapedMention}\\b\\s*$`, 'i');
    
    // Store original content for comparison
    let withMentionRemoved = content;
    
    // Only remove if at beginning or end
    if (mentionAtStartRegex.test(content)) {
      withMentionRemoved = withMentionRemoved.replace(mentionAtStartRegex, '');
    }
    
    if (mentionAtEndRegex.test(withMentionRemoved)) { // Use withMentionRemoved in case we already removed from start
      withMentionRemoved = withMentionRemoved.replace(mentionAtEndRegex, '');
    }
    
    // Fix spacing issues
    return withMentionRemoved
      .replace(/\s{2,}/g, ' ')  // Replace multiple spaces with a single space
      .replace(/\s,/g, ',')     // Fix spacing before commas
      .trim();
  }
  
  it('should remove a mention from the beginning of a message', () => {
    const original = '@testname can you help me with something?';
    const expected = 'can you help me with something?';
    const result = selectivelyRemoveTriggeringMention(original, 'testname');
    
    expect(result).toBe(expected);
  });
  
  it('should remove a mention from the end of a message', () => {
    const original = 'Can you help me with something @testname';
    const expected = 'Can you help me with something';
    const result = selectivelyRemoveTriggeringMention(original, 'testname');
    
    expect(result).toBe(expected);
  });
  
  it('should NOT remove a mention from the middle of a message', () => {
    const original = 'Hey can you @testname help me with something?';
    const expected = 'Hey can you @testname help me with something?';
    const result = selectivelyRemoveTriggeringMention(original, 'testname');
    
    expect(result).toBe(expected);
  });
  
  it('should handle a multi-word mention at the beginning of a message', () => {
    const original = '@disposal chute can you help me?';
    const expected = 'can you help me?';
    const result = selectivelyRemoveTriggeringMention(original, 'disposal chute');
    
    expect(result).toBe(expected);
  });
  
  it('should handle a multi-word mention at the end of a message', () => {
    const original = 'I need help with disposal @disposal chute';
    const expected = 'I need help with disposal';
    const result = selectivelyRemoveTriggeringMention(original, 'disposal chute');
    
    expect(result).toBe(expected);
  });
  
  it('should NOT remove a multi-word mention from the middle of a message', () => {
    const original = 'Can you @disposal chute help me with this trash?';
    const expected = 'Can you @disposal chute help me with this trash?';
    const result = selectivelyRemoveTriggeringMention(original, 'disposal chute');
    
    expect(result).toBe(expected);
  });
  
  it('should handle mentions with special characters at beginning or end only', () => {
    const original = '@test.name is not the same as telling @test.name something';
    const expected = 'is not the same as telling @test.name something';
    const result = selectivelyRemoveTriggeringMention(original, 'test.name');
    
    expect(result).toBe(expected);
  });
  
  it('should handle both beginning and end mentions in the same message', () => {
    const original = '@testname I want to ask you something @testname';
    const expected = 'I want to ask you something';
    const result = selectivelyRemoveTriggeringMention(original, 'testname');
    
    expect(result).toBe(expected);
  });
  
  it('should preserve other mentions when removing from beginning/end', () => {
    const original = '@profile1 please tell @user1 and @user2 about yourself @profile1';
    const expected = 'please tell @user1 and @user2 about yourself';
    const result = selectivelyRemoveTriggeringMention(original, 'profile1');
    
    expect(result).toBe(expected);
  });
  
  it('should work with punctuation after the mention', () => {
    const original = '@testname, can you help me?';
    const expected = 'can you help me?';
    const result = selectivelyRemoveTriggeringMention(original, 'testname');
    
    expect(result).toBe(expected);
  });
  
  it('should preserve punctuation when removing a mention at the end', () => {
    const original = 'I need help! @testname';
    const expected = 'I need help!';
    const result = selectivelyRemoveTriggeringMention(original, 'testname');
    
    expect(result).toBe(expected);
  });
  
  it('should handle unusual spacing properly', () => {
    const original = '  @testname    I have weird spacing   @testname  ';
    const expected = 'I have weird spacing';
    const result = selectivelyRemoveTriggeringMention(original, 'testname');
    
    expect(result).toBe(expected);
  });
  
  it('should handle message consisting of only the mention', () => {
    const original = '@testname';
    const expected = '';
    const result = selectivelyRemoveTriggeringMention(original, 'testname');
    
    expect(result).toBe(expected);
  });
});