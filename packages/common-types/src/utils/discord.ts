/**
 * Discord-specific utility functions
 */

const DISCORD_MAX_MESSAGE_LENGTH = 2000;

/**
 * Intelligently splits a message for Discord's 2000 character limit
 * Tries to split on natural boundaries (paragraphs, sentences, words)
 */
export function splitMessage(content: string, maxLength = DISCORD_MAX_MESSAGE_LENGTH): string[] {
  if (content.length <= maxLength) {
    return [content];
  }

  const chunks: string[] = [];

  // First try to split on double newlines (paragraphs)
  const paragraphs = content.split(/\n\n+/);
  let currentChunk = '';

  for (const paragraph of paragraphs) {
    // If a single paragraph is too long, we need to split it further
    if (paragraph.length > maxLength) {
      // Flush current chunk if any
      if (currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
      }

      // Split long paragraph on sentences (preserving all text including unpunctuated parts)
      const sentences = paragraph.split(/(?<=[.!?])\s+/);

      for (const sentence of sentences) {
        // If even a sentence is too long, split on words
        if (sentence.length > maxLength) {
          // Flush current chunk
          if (currentChunk) {
            chunks.push(currentChunk.trim());
            currentChunk = '';
          }

          // Split on word boundaries
          const words = sentence.split(/\s+/);
          for (const word of words) {
            // If even a single word is too long (like a URL), split it forcefully
            if (word.length > maxLength) {
              if (currentChunk) {
                chunks.push(currentChunk.trim());
                currentChunk = '';
              }

              // Force split long word/URL
              for (let i = 0; i < word.length; i += maxLength - 10) {
                chunks.push(word.slice(i, i + maxLength - 10) + '...');
              }
            } else if ((currentChunk + ' ' + word).length > maxLength) {
              chunks.push(currentChunk.trim());
              currentChunk = word;
            } else {
              currentChunk = currentChunk ? currentChunk + ' ' + word : word;
            }
          }
        } else if ((currentChunk + ' ' + sentence).length > maxLength) {
          chunks.push(currentChunk.trim());
          currentChunk = sentence;
        } else {
          currentChunk = currentChunk ? currentChunk + ' ' + sentence : sentence;
        }
      }
    } else if ((currentChunk + '\n\n' + paragraph).length > maxLength) {
      // Paragraph fits but would exceed limit with current chunk
      chunks.push(currentChunk.trim());
      currentChunk = paragraph;
    } else {
      // Add paragraph to current chunk
      currentChunk = currentChunk ? currentChunk + '\n\n' + paragraph : paragraph;
    }
  }

  // Don't forget the last chunk
  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }

  return chunks.filter(chunk => chunk.length > 0);
}

/**
 * Formats code blocks for Discord
 * Ensures code blocks don't get split awkwardly
 */
export function preserveCodeBlocks(content: string): string[] {
  // Defensive check: handle undefined/null/non-string input
  // Utility functions should be robust to bad input
  if (!content || typeof content !== 'string') {
    return [];
  }

  const codeBlockRegex = /```[\s\S]*?```/g;
  const codeBlocks = content.match(codeBlockRegex) ?? [];

  if (codeBlocks.length === 0) {
    return splitMessage(content);
  }

  // Replace code blocks with placeholders
  let processedContent = content;
  const placeholders: string[] = [];

  codeBlocks.forEach((block, index) => {
    const placeholder = `__CODE_BLOCK_${index}__`;
    placeholders.push(placeholder);
    processedContent = processedContent.replace(block, placeholder);
  });

  // Split the content
  const chunks = splitMessage(processedContent);

  // Restore code blocks
  const restoredChunks = chunks.map(chunk => {
    let restoredChunk = chunk;
    codeBlocks.forEach((block, index) => {
      restoredChunk = restoredChunk.replace(`__CODE_BLOCK_${index}__`, block);
    });
    return restoredChunk;
  });

  // Check if any restored chunks exceed the limit (can happen if code block is large)
  // If so, re-split those chunks
  const finalChunks: string[] = [];
  for (const chunk of restoredChunks) {
    if (chunk.length > DISCORD_MAX_MESSAGE_LENGTH) {
      // Re-split this chunk normally (without code block preservation to avoid infinite loop)
      finalChunks.push(...splitMessage(chunk));
    } else {
      finalChunks.push(chunk);
    }
  }

  return finalChunks;
}
