/**
 * How a generation turn is incognito, resolved once per turn.
 *
 * Two independent causes skip the long-term-memory write:
 * - an anonymous summon (`summonAnonymity.kind === 'incognito'`): the persona is
 *   stripped as well;
 * - the requester's `/memory incognito` Redis session: a personal turn that keeps
 *   its persona. A reroll of such a turn carries the skip explicitly
 *   (`reroll.skipMemoryWrite`), because the session may have ended since.
 *
 * The kind is reported with the result so the history row can record it and a
 * later reroll reproduces it; anonymity outranks a session when both hold.
 */

import type { IncognitoKind } from '@tzurot/common-types/types/schemas/message';
import type { ConversationContext } from './ConversationalRAGTypes.js';

export interface IncognitoResolution {
  /** Whether the memory write is skipped (either cause). */
  active: boolean;
  /** Whether the cause was an anonymous summon (also gates other authors' deferred memories). */
  summon: boolean;
  /** Absent when the turn is not incognito. */
  kind: IncognitoKind | undefined;
}

export async function resolveIncognito(
  context: Pick<ConversationContext, 'summonAnonymity' | 'reroll' | 'userId'>,
  isSessionActive: () => Promise<boolean>
): Promise<IncognitoResolution> {
  const summon = context.summonAnonymity?.kind === 'incognito';
  const session =
    !summon && (context.reroll?.skipMemoryWrite === true || (await isSessionActive()));
  const kindOf = summon ? 'summon' : session ? 'session' : undefined;
  return { active: summon || session, summon, kind: kindOf };
}
