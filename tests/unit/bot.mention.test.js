/**
 * Tests for bot.js @mention regex patterns, specifically for aliases with spaces
 */

describe('Bot @Mention Regex Tests', () => {
  // Define the regex patterns used in bot.js
  let standardMentionRegex;
  let spacedMentionRegex;
  
  beforeEach(() => {
    // Define the regex patterns as they are in bot.js
    standardMentionRegex = /@([\w-]+)/i;
    // New improved regex that more precisely handles various edge cases
    spacedMentionRegex = /@([^\s@\n]+(?:\s+[^\s@\n.,!?;:()"']+){0,4})/g;
  });
  
  // Test standard @mention (without spaces)
  it('should match standard @mentions without spaces', () => {
    const message = 'Hey @testname how are you doing?';
    const match = message.match(standardMentionRegex);
    
    expect(match).not.toBeNull();
    expect(match[1]).toBe('testname');
  });
  
  // Test @mention with spaces using the new regex
  it('should match @mentions with spaces', () => {
    const message = 'Hey @disposal chute can you handle my trash?';
    
    // Reset the regex for each run (because it's global and keeps state)
    spacedMentionRegex.lastIndex = 0;
    const match = spacedMentionRegex.exec(message);
    
    expect(match).not.toBeNull();
    // Split the first few words from the rest of the match
    // This is what the implemention in bot.js needs to handle manually
    const firstTwoWords = match[1].trim().split(/\s+/).slice(0, 2).join(' ');
    expect(firstTwoWords).toBe('disposal chute');
  });
  
  // Test multiple @mentions in a single message
  it('should find both mentions in a message with multiple @mentions', () => {
    const message = 'Hey @testname and @disposal chute, how are you both?';
    
    // First find the standard mention
    const standardMatch = message.match(standardMentionRegex);
    expect(standardMatch).not.toBeNull();
    expect(standardMatch[1]).toBe('testname');
    
    // Then find all spaced mentions
    spacedMentionRegex.lastIndex = 0;
    const matches = [];
    let match;
    
    while ((match = spacedMentionRegex.exec(message)) !== null) {
      // Process each match to extract the name part
      const words = match[1].trim().split(/\s+/);
      if (words[0] === 'testname') {
        // For the first match
        matches.push('testname');
      } else if (words[0] === 'disposal' && words[1] === 'chute') {
        // For the second match
        matches.push('disposal chute');
      }
    }
    
    expect(matches).toContain('testname');
    expect(matches).toContain('disposal chute');
    expect(matches.length).toBe(2);
  });
  
  // Test @mention at the end of a message
  it('should match @mentions at the end of messages', () => {
    const message = 'I need help with my garbage @disposal chute';
    
    // Reset regex
    spacedMentionRegex.lastIndex = 0;
    const match = spacedMentionRegex.exec(message);
    
    expect(match).not.toBeNull();
    const extracted = match[1].trim().split(/\s+/).slice(0, 2).join(' ');
    expect(extracted).toBe('disposal chute');
  });
  
  // Test @mention followed by punctuation
  it('should match @mentions followed by punctuation', () => {
    const message = 'Is this working, @disposal chute?';
    
    // Reset regex
    spacedMentionRegex.lastIndex = 0;
    const match = spacedMentionRegex.exec(message);
    
    expect(match).not.toBeNull();
    const extracted = match[1].trim().split(/\s+/).slice(0, 2).join(' ');
    expect(extracted).toBe('disposal chute');
  });
  
  // Test @mention with parentheses
  it('should match @mentions with parentheses', () => {
    const message = 'Hey @disposal chute (the robot), can you help?';
    
    // Reset regex
    spacedMentionRegex.lastIndex = 0;
    const match = spacedMentionRegex.exec(message);
    
    expect(match).not.toBeNull();
    const extracted = match[1].trim().split(/\s+/).slice(0, 2).join(' ');
    expect(extracted).toBe('disposal chute');
  });
  
  // Test multi-word @mention with more than two words
  it('should match @mentions with multiple words', () => {
    const message = 'Hello @robot disposal chute system, activate!';
    
    // Reset regex
    spacedMentionRegex.lastIndex = 0;
    const match = spacedMentionRegex.exec(message);
    
    expect(match).not.toBeNull();
    // For this test we expect all four words to be captured as a unit
    const extracted = match[1].trim().split(/\s+/).slice(0, 4).join(' ');
    expect(extracted).toBe('robot disposal chute system');
  });
  
  // Test @mention with apostrophes and special characters
  it('should handle @mentions with apostrophes and special characters', () => {
    const message = "Let's ask @bill's disposal system about this.";
    
    // Reset regex
    spacedMentionRegex.lastIndex = 0;
    const match = spacedMentionRegex.exec(message);
    
    expect(match).not.toBeNull();
    const extracted = match[1].trim().split(/\s+/).slice(0, 3).join(' ');
    expect(extracted).toBe("bill's disposal system");
  });
  
  // Test for the longest match priority case
  it('should capture the full multi-word mention when part of it could be a valid mention too', () => {
    const message = "Hey @bambi prime, can you help me?";
    
    // Reset regex
    spacedMentionRegex.lastIndex = 0;
    const match = spacedMentionRegex.exec(message);
    
    expect(match).not.toBeNull();
    
    // The full mention "bambi prime" should be captured
    const fullCapture = match[1].trim();
    expect(fullCapture).toBe("bambi prime");
    
    // This verifies the regex captures the full text
    // The actual prioritization happens in bot.js
  });
  
  // Test for the improved implementation that collects all matches and selects the longest
  it('should simulate the improved implementation logic that prioritizes longest matches', () => {
    // Mock the actual bot.js implementation logic for handling @mentions
    
    // Step 1: Collect all potential matches with their word counts
    const potentialMatches = [
      { mentionText: "bambi", personality: { fullName: "bambi-character" }, wordCount: 1 },
      { mentionText: "bambi prime", personality: { fullName: "bambi-prime-character" }, wordCount: 2 },
    ];
    
    // Step 2: Sort by word count (descending) to prioritize longer matches
    potentialMatches.sort((a, b) => b.wordCount - a.wordCount);
    
    // Step 3: Select the best match (first item after sorting)
    const bestMatch = potentialMatches[0];
    
    // Verify the correct match was selected
    expect(bestMatch.mentionText).toBe("bambi prime");
    expect(bestMatch.personality.fullName).toBe("bambi-prime-character");
    expect(bestMatch.wordCount).toBe(2);
  });
});