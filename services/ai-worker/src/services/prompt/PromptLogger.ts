/**
 * Prompt Logger
 *
 * Detailed prompt assembly logging, gated on a development NODE_ENV plus an explicit LOG_PROMPT_ASSEMBLY opt-in.
 * Extracted from PromptBuilder to reduce file size.
 */

import { getConfig } from '@tzurot/common-types/config/config';
import { TEXT_LIMITS } from '@tzurot/common-types/constants/discord';
import { formatMemoryTimestamp } from '@tzurot/common-types/utils/dateFormatting';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { ConversationContext } from '../ConversationalRAGTypes.js';

const logger = createLogger('PromptBuilder');
const config = getConfig();

/** Options for detailed prompt assembly logging */
export interface PromptAssemblyLogOptions {
  personality: { id: string; name: string };
  persona: string;
  protocol: string;
  context: ConversationContext;
  historyLength: number;
  fullSystemPrompt: string;
}

/**
 * Log detailed prompt assembly info — requires a development NODE_ENV AND LOG_PROMPT_ASSEMBLY=true.
 */
export function logDetailedPromptAssembly(opts: PromptAssemblyLogOptions): void {
  // SCOPED EXCEPTION to 00-critical § Logging (No PII), recorded here rather
  // than only in review history. This function logs the persona display name
  // below AND the assembled system prompt itself, which carries the persona
  // bio — both user-authored. The rule states no carve-out for NODE_ENV; this
  // guard is the exception, not the rule permitting it. It is deliberate: the
  // function exists to dump prompt assembly for local debugging, and scrubbing
  // one name while printing the prompt that contains it would be theatre.
  // Anything that could run outside local development belongs in a different
  // function, not behind this guard.
  //
  // The dump needs BOTH a development NODE_ENV and an explicit
  // LOG_PROMPT_ASSEMBLY=true. The flag names the capability; NODE_ENV alone
  // was a general-purpose switch that also happened to be the schema's
  // fail-open default, so an environment that merely lacked the variable got
  // the dump for free. The config layer separately refuses to boot a deployed
  // service with NODE_ENV unset (assertDeployedNodeEnv). Both arms of this
  // guard are pinned by the logDetailedPromptAssembly describe in
  // PromptLogger.test.ts.
  if (config.NODE_ENV !== 'development' || !config.LOG_PROMPT_ASSEMBLY) {
    return;
  }

  const { personality, persona, protocol, context, historyLength, fullSystemPrompt } = opts;

  // Participant/memory details moved with those blocks into the volatile
  // prefix; its own 'Volatile prefix composition' log carries their sizes.
  logger.debug(
    {
      personalityId: personality.id,
      personalityName: personality.name,
      personaLength: persona.length,
      protocolLength: protocol.length,
      activePersonaName: context.activePersonaName,
      historyLength,
      totalSystemPromptLength: fullSystemPrompt.length,
      stmCount: context.conversationHistory?.length ?? 0,
      stmOldestTimestamp:
        context.oldestHistoryTimestamp !== undefined &&
        context.oldestHistoryTimestamp !== null &&
        context.oldestHistoryTimestamp > 0
          ? formatMemoryTimestamp(context.oldestHistoryTimestamp)
          : null,
    },
    '[PromptBuilder] Detailed prompt assembly:'
  );

  // Show full prompt in debug mode (truncated to avoid massive logs)
  const maxPreviewLength = TEXT_LIMITS.LOG_FULL_PROMPT;
  if (fullSystemPrompt.length <= maxPreviewLength) {
    logger.debug('Full system prompt:\n' + fullSystemPrompt);
  } else {
    logger.debug(
      `Full system prompt (showing first ${maxPreviewLength} chars):\n` +
        fullSystemPrompt.substring(0, maxPreviewLength) +
        `\n\n... [truncated ${fullSystemPrompt.length - maxPreviewLength} more chars]`
    );
  }
}

/**
 * Detect name collision between user's persona and personality name.
 *
 * A collision occurs when a user's display name matches the AI character's name,
 * which can cause confusion in conversations. When detected with a valid
 * discordUsername, we return collision info for disambiguation instructions.
 */
export function detectNameCollision(
  activePersonaName: string | undefined,
  discordUsername: string | undefined,
  personalityName: string,
  personalityId: string
): { userName: string; discordUsername: string } | undefined {
  const name = activePersonaName ?? '';
  const username = discordUsername ?? '';

  const namesMatch = name.length > 0 && name.toLowerCase() === personalityName.toLowerCase();

  if (!namesMatch) {
    return undefined;
  }

  // Collision detected but can't disambiguate without discordUsername
  if (username.length === 0) {
    logger.error(
      // The colliding persona name is the user's own display name — the
      // personality name it matched is recoverable from personalityId.
      { personalityId },
      'Name collision detected but cannot add disambiguation instruction (discordUsername missing from context - check bot-client MessageContextBuilder)'
    );
    return undefined;
  }

  return { userName: name, discordUsername: username };
}
