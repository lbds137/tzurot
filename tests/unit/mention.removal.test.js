/**
 * Tests for @mention removal functionality
 * 
 * Rather than trying to test the internal handlePersonalityInteraction function directly,
 * this test suite verifies the regex pattern and replacement logic used for removing
 * triggering @mentions from message content.
 */

describe('@Mention Removal', () => {
  /**
   * Helper function that simulates the mention removal logic used in bot.js
   * @param {string} content - Original message content
   * @param {string} triggeringMention - The mention that triggered the bot
   * @returns {string} - Content with the triggering mention removed
   */
  function removeTriggeringMention(content, triggeringMention) {
    if (!content || !triggeringMention) {
      return content;
    }
    
    // Escape special regex characters in the triggering mention
    const escapedMention = triggeringMention.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Create a regex to match the mention with the @ symbol and preserve spacing
    const specificMentionRegex = new RegExp(`@${escapedMention}\\b`, 'gi');
    
    // Remove the mention and clean up spacing
    const withMentionRemoved = content.replace(specificMentionRegex, '');
    
    // Fix spacing issues
    return withMentionRemoved
      .replace(/\s{2,}/g, ' ')  // Replace multiple spaces with a single space
      .replace(/\s,/g, ',')     // Fix spacing before commas
      .trim();
  }
  
  it('should remove a standard @mention from message content', () => {
    const original = 'Hey @testname can you help me with something?';
    const expected = 'Hey can you help me with something?';
    const result = removeTriggeringMention(original, 'testname');
    
    expect(result).toBe(expected);
  });
  
  it('should remove a multi-word @mention from message content', () => {
    const original = 'Hey @disposal chute can you help me with something?';
    const expected = 'Hey can you help me with something?';
    const result = removeTriggeringMention(original, 'disposal chute');
    
    expect(result).toBe(expected);
  });
  
  it('should preserve other @mentions when removing the triggering one', () => {
    const original = 'Hey @disposal chute, please tell @user1 and @user2 about recycling';
    const expected = 'Hey, please tell @user1 and @user2 about recycling';
    const result = removeTriggeringMention(original, 'disposal chute');
    
    expect(result).toBe(expected);
  });
  
  it('should not modify content when triggeringMention is null', () => {
    const original = 'Hey @someuser, I need help with a question';
    const result = removeTriggeringMention(original, null);
    
    expect(result).toBe(original);
  });
  
  it('should handle special regex characters in mentions', () => {
    const original = 'Hey @test.personality (bot) can you help with this regex?';
    const expected = 'Hey (bot) can you help with this regex?';
    const result = removeTriggeringMention(original, 'test.personality');
    
    expect(result).toBe(expected);
  });
  
  it('should handle multiple instances of the same mention', () => {
    const original = 'Hey @disposal chute, when I say @disposal chute I mean you!';
    const expected = 'Hey, when I say I mean you!';
    const result = removeTriggeringMention(original, 'disposal chute');
    
    expect(result).toBe(expected);
  });
  
  it('should handle mentions at the beginning of content', () => {
    const original = '@testname please help me';
    const expected = 'please help me';
    const result = removeTriggeringMention(original, 'testname');
    
    expect(result).toBe(expected);
  });
  
  it('should handle mentions at the end of content', () => {
    const original = 'I need help @testname';
    const expected = 'I need help';
    const result = removeTriggeringMention(original, 'testname');
    
    expect(result).toBe(expected);
  });
  
  it('should handle mentions with apostrophes and special characters', () => {
    const original = "Let's ask @bill's bot system about this";
    const expected = "Let's ask about this";
    const result = removeTriggeringMention(original, "bill's bot system");
    
    expect(result).toBe(expected);
  });
  
  it('should handle empty content gracefully', () => {
    const original = '';
    const result = removeTriggeringMention(original, 'testname');
    
    expect(result).toBe('');
  });
  
  it('should only remove exact matches for the triggering mention', () => {
    const original = '@testname1 and @testname are different bots';
    const expected = '@testname1 and are different bots';
    const result = removeTriggeringMention(original, 'testname');
    
    expect(result).toBe(expected);
  });
});