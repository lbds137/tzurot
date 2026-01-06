/**
 * RAG Utility Functions
 *
 * Pure utility functions for the Conversational RAG Service.
 * These functions have no dependencies on class instances and can be used standalone.
 */

import { createLogger, AttachmentType } from '@tzurot/common-types';
import type { ProcessedAttachment } from './MultimodalProcessor.js';
import type { ParticipantInfo } from './ConversationalRAGService.js';

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
 * Generate stop sequences for LLM generation safety
 *
 * Stop sequences serve two critical purposes:
 * 1. **Hallucinated Turn Prevention**: Stop if the model starts a fake "user turn"
 *    (common failure mode in weaker/free-tier models that fail to emit stop tokens)
 * 2. **Identity Bleeding Prevention**: Stop if the model speaks as another participant
 *
 * Priority order (with 16-slot Gemini API limit):
 * - P1: XML end tag (</message>) - signals valid turn completion
 * - P2: Generic chat markers (User:, Human:) - catches hallucinated turns
 * - P3: Instruct format markers (###, <|user|>) - catches model-specific leaks
 * - P4: Self-labeling prevention (Assistant:, AI:)
 * - P5: Personality name - prevents self-quoting
 * - P6: Participant names - prevents speaking as users
 *
 * @param personalityName - Name of the AI personality
 * @param participantPersonas - Map of participant names to their persona info
 * @returns Array of stop sequences (max 16)
 */
export function generateStopSequences(
  personalityName: string,
  participantPersonas: Map<string, ParticipantInfo>
): string[] {
  // Priority 1: XML structure (2 slots)
  // </message> is the king - once generated, the turn is legally over
  // <message catches if model tries to start a new XML turn immediately
  const xmlStopSequences = ['</message>', '<message'];

  // Priority 2: Hallucinated turn prevention - PRIMARY defense (4 slots)
  // When weak models fail to stop, they revert to base instruct format (User:/Human:)
  // These are the most common culprits for the "two responses concatenated" bug
  const hallucinationPrimarySequences = [
    '\nUser:', // Most common hallucination pattern
    '\nHuman:', // Second most common
    'User:', // Backup without newline (bad formatting)
    'Human:', // Backup without newline
  ];

  // Priority 3: Instruct format markers (3 slots)
  // Catches model-specific chat template leaks
  const instructFormatSequences = [
    '###', // Llama/Mistral instruct format (### Instruction:, ### User:)
    '\nAssistant:', // Common self-labeling pattern
    '<|user|>', // ChatML format (Hermes, Yi)
  ];

  // Priority 4: Self-labeling prevention (1 slot)
  const selfLabelSequence = '\nAI:';

  // Priority 5: Personality name (1 slot)
  // Prevents AI from self-quoting in third person
  const personalityStopSequence = `\n${personalityName}:`;

  // Priority 6: Participant stop sequences (remaining slots)
  // Prevents speaking as users in the conversation
  const participantStopSequences = Array.from(participantPersonas.keys()).map(name => `\n${name}:`);

  // Calculate available slots for participants
  // Total budget: MAX_STOP_SEQUENCES (16)
  // Reserved: XML (2) + hallucination primary (4) + instruct (3) + self-label (1) + personality (1) = 11
  // Available for participants: 5
  const reservedCount =
    xmlStopSequences.length +
    hallucinationPrimarySequences.length +
    instructFormatSequences.length +
    1 + // selfLabelSequence
    1; // personalityStopSequence
  const availableForParticipants = MAX_STOP_SEQUENCES - reservedCount;

  // Truncate participants if necessary
  const truncatedParticipants = participantStopSequences.slice(0, availableForParticipants);
  const participantsTruncated = participantStopSequences.length - truncatedParticipants.length;

  // Combine in priority order (highest priority first)
  const stopSequences = [
    ...xmlStopSequences,
    ...hallucinationPrimarySequences,
    ...instructFormatSequences,
    selfLabelSequence,
    personalityStopSequence,
    ...truncatedParticipants,
  ];

  // Log summary
  logger.info(
    {
      count: stopSequences.length,
      maxAllowed: MAX_STOP_SEQUENCES,
      xmlCount: xmlStopSequences.length,
      hallucinationCount: hallucinationPrimarySequences.length,
      instructCount: instructFormatSequences.length,
      participantCount: participantStopSequences.length,
      participantsTruncated,
      participants: Array.from(participantPersonas.keys()),
      personalityName,
    },
    '[RAG] Generated stop sequences for hallucination and identity bleeding prevention'
  );

  return stopSequences;
}
