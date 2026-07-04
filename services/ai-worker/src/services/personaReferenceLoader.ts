/**
 * Persona Reference Loader
 *
 * Loads participant personas from conversation history and resolves user
 * references (shapes.inc `@mention` formats) in a personality's static text
 * fields. Extracted from ConversationalRAGService to keep the orchestrator
 * within the file-size limit and to make the persona-load step independently
 * testable.
 */

import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { MemoryRetriever } from './MemoryRetriever.js';
import type { UserReferenceResolver } from './UserReferenceResolver.js';
import type { ConversationContext, PersonaLoadResult } from './ConversationalRAGTypes.js';

const logger = createLogger('personaReferenceLoader');

/**
 * Load participant personas and resolve user references in the system prompt.
 */
export async function loadPersonasAndResolveReferences(
  memoryRetriever: MemoryRetriever,
  userReferenceResolver: UserReferenceResolver,
  personality: LoadedPersonality,
  context: ConversationContext
): Promise<PersonaLoadResult> {
  // Fetch ALL participant personas from conversation history
  // Pass personalityId for resolving per-personality persona overrides
  const participantPersonas = await memoryRetriever.getAllParticipantPersonas(
    context,
    personality.id
  );
  if (participantPersonas.size > 0) {
    const names = Array.from(participantPersonas.keys());
    logger.debug({ count: participantPersonas.size, names }, 'Loaded participant personas');
  } else {
    logger.debug('No participant personas found in conversation history');
  }

  // Resolve user references across all personality text fields (shapes.inc format mentions).
  // Text-only transform: `@Lila` / `@[Lila](user:UUID)` / `<@discord_id>` in static personality
  // fields are replaced with the bare persona name in the rendered prompt. Resolved personas
  // are NOT injected into the participants list — personality fields are author-defined static
  // content, not live conversation. Live participants come from chat-log scan
  // (`extractParticipants`) and current-message @mentions (`mentionedPersonas`); a name
  // appearing in a personality's example text does not mean that user is in the conversation.
  const { resolvedPersonality: processedPersonality, resolvedPersonas } =
    await userReferenceResolver.resolvePersonalityReferences(personality);

  if (resolvedPersonas.length > 0) {
    logger.info(
      { count: resolvedPersonas.length },
      'Resolved user refs in personality fields (text-only; not added to participants)'
    );
  }

  return { participantPersonas, processedPersonality };
}
