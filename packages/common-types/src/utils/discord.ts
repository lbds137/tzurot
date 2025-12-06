/**
 * Discord-specific utility functions
 */

const DISCORD_MAX_MESSAGE_LENGTH = 2000;

/**
 * Internal helper: splits text at natural boundaries (paragraphs, sentences, words)
 * This is an implementation detail - use splitMessage() for the public API
 * @internal
 */
function splitAtNaturalBoundaries(
  content: string,
  maxLength = DISCORD_MAX_MESSAGE_LENGTH
): string[] {
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
 * Splits a message for Discord's character limit while preserving code blocks
 *
 * This is the main entry point for message splitting. It:
 * 1. Preserves code blocks (``` ```) when possible
 * 2. Falls back to natural boundary splitting (paragraphs, sentences, words)
 * 3. Force-splits only when absolutely necessary
 *
 * @param content - The content to split
 * @param maxLength - Maximum length per chunk (default: Discord's 2000 char limit)
 */
export function splitMessage(content: string, maxLength = DISCORD_MAX_MESSAGE_LENGTH): string[] {
  // Defensive check: handle undefined/null/non-string input
  // Utility functions should be robust to bad input
  if (!content || typeof content !== 'string') {
    return [];
  }

  const codeBlockRegex = /```[\s\S]*?```/g;
  const codeBlocks = content.match(codeBlockRegex) ?? [];

  // No code blocks - use simple natural boundary splitting
  if (codeBlocks.length === 0) {
    return splitAtNaturalBoundaries(content, maxLength);
  }

  // Replace code blocks with placeholders to protect them during splitting
  let processedContent = content;
  const placeholders: string[] = [];

  codeBlocks.forEach((block, index) => {
    const placeholder = `__CODE_BLOCK_${index}__`;
    placeholders.push(placeholder);
    processedContent = processedContent.replace(block, placeholder);
  });

  // Split the content with placeholders
  const chunks = splitAtNaturalBoundaries(processedContent, maxLength);

  // Restore code blocks
  const restoredChunks = chunks.map(chunk => {
    let restoredChunk = chunk;
    codeBlocks.forEach((block, index) => {
      restoredChunk = restoredChunk.replace(`__CODE_BLOCK_${index}__`, block);
    });
    return restoredChunk;
  });

  // Check if any restored chunks exceed the limit (can happen if code block is large)
  // If so, re-split those chunks (code block will be split, but that's unavoidable)
  const finalChunks: string[] = [];
  for (const chunk of restoredChunks) {
    if (chunk.length > maxLength) {
      // Re-split this chunk at natural boundaries (code block protection disabled to avoid infinite loop)
      finalChunks.push(...splitAtNaturalBoundaries(chunk, maxLength));
    } else {
      finalChunks.push(chunk);
    }
  }

  return finalChunks;
}
