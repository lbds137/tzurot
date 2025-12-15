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
  const stopSequences: string[] = [];

  // Add stop sequence for each participant (users)
  // Use newline prefix to catch the common "Name:" pattern at line start
  for (const participantName of participantPersonas.keys()) {
    stopSequences.push(`\n${participantName}:`);
  }

  // Add stop sequence for the AI itself (prevent "Lilith: [third person]" then self-quoting)
  stopSequences.push(`\n${personalityName}:`);

  // Add XML tag stop sequences to prevent AI from outputting chat_log structure
  // Must match actual tags used in formatConversationHistoryAsXml()
  stopSequences.push('<message ');
  stopSequences.push('<message>');
  stopSequences.push('</message>');
  stopSequences.push('<chat_log>');
  stopSequences.push('</chat_log>');
  // Stop sequences for quoted message structure
  stopSequences.push('<quoted_messages>');
  stopSequences.push('</quoted_messages>');
  stopSequences.push('<quote ');
  stopSequences.push('<quote>');
  stopSequences.push('</quote>');

  // Log summary
  if (stopSequences.length > 0) {
    logger.info(
      {
        count: stopSequences.length,
        participants: Array.from(participantPersonas.keys()),
        personalityName,
      },
      '[RAG] Generated stop sequences for identity bleeding prevention'
    );
  }

  return stopSequences;
}
