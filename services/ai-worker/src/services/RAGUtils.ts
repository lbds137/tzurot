/**
 * RAG Utility Functions
 *
 * Pure utility functions for the Conversational RAG Service.
 * These functions have no dependencies on class instances and can be used standalone.
 */

import { createLogger, AttachmentType } from '@tzurot/common-types';
import type { ProcessedAttachment } from './MultimodalProcessor.js';

const logger = createLogger('RAGUtils');

/**
 * Maximum stop sequences allowed by Google/Gemini API.
 * Error says "from 1 (inclusive) to 17 (exclusive)", meaning max is 16.
 * We apply this limit universally since other providers have higher limits.
 */
const MAX_STOP_SEQUENCES = 16;

/**
 * Build attachment descriptions for storage and display
 *
 * Formats processed attachments into human-readable descriptions with headers
 * indicating the type (Image, Audio, Voice message).
 */
export function buildAttachmentDescriptions(
  processedAttachments: ProcessedAttachment[]
): string | undefined {
  if (processedAttachments.length === 0) {
    return undefined;
  }

  return processedAttachments
    .map(a => {
      let header = '';
      if (a.type === AttachmentType.Image) {
        header = `[Image: ${a.metadata.name !== undefined && a.metadata.name.length > 0 ? a.metadata.name : 'attachment'}]`;
      } else if (a.type === AttachmentType.Audio) {
        if (
          a.metadata.isVoiceMessage === true &&
          a.metadata.duration !== undefined &&
          a.metadata.duration !== null &&
          a.metadata.duration > 0
        ) {
          header = `[Voice message: ${a.metadata.duration.toFixed(1)}s]`;
        } else {
          header = `[Audio: ${a.metadata.name !== undefined && a.metadata.name.length > 0 ? a.metadata.name : 'attachment'}]`;
        }
      }
      return `${header}\n${a.description}`;
    })
    .join('\n\n');
}

/**
 * Generate stop sequences for identity bleeding prevention
 *
 * These sequences tell the LLM to stop generating if it starts speaking as another participant.
 * This is a technical kill-switch that works at the API level, complementing the XML structure
 * and prompt instructions.
 *
 * Stop sequences include:
 * - "\nParticipantName:" for each participant (users)
 * - "\nPersonalityName:" for the AI itself (prevent third-person then self-quoting)
 * - "<msg " to prevent outputting XML structure
 *
 * @param personalityName - Name of the AI personality
 * @param participantPersonas - Map of participant names to their persona info
 * @returns Array of stop sequences
 */
export function generateStopSequences(
  personalityName: string,
  participantPersonas: Map<string, { content: string; isActive: boolean }>
): string[] {
  // Priority 1: XML tag stop sequences (most critical - prevent format leakage)
  // Must match actual tags used in formatConversationHistoryAsXml()
  const xmlStopSequences = [
    '<message ',
    '<message>',
    '</message>',
    '<chat_log>',
    '</chat_log>',
    '<quoted_messages>',
    '</quoted_messages>',
    '<quote ',
    '<quote>',
    '</quote>',
  ];

  // Priority 2: Personality name stop sequence (prevent self-quoting)
  const personalityStopSequence = `\n${personalityName}:`;

  // Priority 3: Participant stop sequences (can truncate if many participants)
  // Use newline prefix to catch the common "Name:" pattern at line start
  const participantStopSequences = Array.from(participantPersonas.keys()).map(
    name => `\n${name}:`
  );

  // Calculate available slots for participants
  // Total budget: MAX_STOP_SEQUENCES (16)
  // Reserved: XML sequences (10) + personality (1) = 11
  // Available for participants: 5
  const reservedCount = xmlStopSequences.length + 1; // XML + personality
  const availableForParticipants = MAX_STOP_SEQUENCES - reservedCount;

  // Truncate participants if necessary (newest/most recent should be prioritized,
  // but since we don't have ordering info, just take first N)
  const truncatedParticipants = participantStopSequences.slice(0, availableForParticipants);
  const participantsTruncated = participantStopSequences.length - truncatedParticipants.length;

  // Combine in priority order
  const stopSequences = [...truncatedParticipants, personalityStopSequence, ...xmlStopSequences];

  // Log summary
  if (stopSequences.length > 0) {
    logger.info(
      {
        count: stopSequences.length,
        maxAllowed: MAX_STOP_SEQUENCES,
        participantCount: participantStopSequences.length,
        participantsTruncated,
        participants: Array.from(participantPersonas.keys()),
        personalityName,
      },
      '[RAG] Generated stop sequences for identity bleeding prevention'
    );
  }

  return stopSequences;
}
