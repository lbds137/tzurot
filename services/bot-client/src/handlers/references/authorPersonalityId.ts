/**
 * Resolution of `authorPersonalityId` for referenced messages.
 *
 * A quote authored by one of our own personas renders as `role="character"`
 * with a `from_id` the model matches against the `<participants>` roster. That
 * id has to come from somewhere, and bot-client is where it is reachable: the
 * webhook-message cache it writes itself every time it posts as a persona.
 *
 * WHY HERE AND NOT IN `buildRawReference`: that builder is documented pure and
 * synchronous because its output is the shape the raw assembly envelope ships
 * for the worker-side assembler to re-derive from. Resolution is a network
 * lookup. Rather than make the builder async for one field, the whole
 * reference set is resolved in one pass afterwards, on a path
 * (`MessageReferenceExtractor.extractReferencesWithReplacement`) that is
 * already async and already spends 2.5s waiting for Discord to populate
 * embeds.
 *
 * WHY NO ACCESS GATE: `forwardedOriginSchema.authorPersonalityId` gates on the
 * forwarder's access to keep the "Reply Loophole" closed, and this looks like
 * the same situation — but it is not. A forward's text arrives inside
 * `message_snapshots` with no fetch and therefore no access check of any kind,
 * so that path has to supply its own. A reference exists only because the
 * message was FETCHED, and both fetch paths already verify the INVOKER's
 * access rather than the bot's: a reply is same-channel by construction
 * (`ReplyReferenceStrategy` skips forward-typed references outright), and a
 * link goes through `LinkExtractor.verifyInvokerCanAccessSource`, which
 * fails closed and handles cross-guild and private-thread targets. A message
 * the invoker cannot see never becomes a reference, so there is nothing left
 * here to gate.
 *
 * That is also why no reference KIND is threaded down to this module: the
 * per-kind resolver split only mattered if the two kinds needed different
 * gates, and they do not.
 *
 * A FORWARDED SNAPSHOT is the third input shape, and it is excluded outright
 * rather than gated — see `needsLookup`. It is the one reference whose content
 * genuinely arrives without a fetch, so the paragraph above would not cover it;
 * it is also the one whose `discordMessageId` does not identify the message
 * being quoted, which disqualifies it before access is even the question.
 */

import { isUuidFormat } from '@tzurot/common-types/utils/deterministicUuid';
import { type ReferencedMessage } from '@tzurot/common-types/types/schemas/message';
import { createLogger } from '@tzurot/common-types/utils/logger';

const logger = createLogger('authorPersonalityId');

/**
 * The lookup, injected so this module stays free of Redis imports (and so tests
 * can drive it without standing Redis up).
 *
 * MUST be AUTHORSHIP-PROVING: a hit has to mean "our bot sent this exact
 * message as this persona", never "this message is associated with this
 * personality". The webhook-message cache qualifies — `storeWebhookMessage` is
 * its only writer, called from `DiscordResponseSender` immediately after a
 * persona's webhook post, with that persona's id.
 *
 * The obvious second tier does NOT qualify, and is named here because its
 * absence otherwise reads as an oversight: the gateway's
 * `lookupPersonalityFromMessage` ends in `getMessageByDiscordId`, a
 * `discordMessageId has ?` match over `conversation_history` returning
 * whichever row holds the id — including a USER row, whose `personalityId` is
 * the personality being ADDRESSED. Stamping that would render a human's quoted
 * message as `role="character"` under a character's id, and it would fire on
 * every forwarded snapshot (which carries the FORWARDING message's id and no
 * role stamp). `ReplyResolutionService` may use it because its question is
 * "which personality is this reply about" — a different question from this
 * one. The cost of leaving it out is that a quote older than the cache TTL
 * falls back to the name match, which is the pre-existing behaviour.
 */
export interface AuthorPersonalityLookups {
  /** The webhook-message cache: personality UUID, or null on a miss. */
  fromWebhookCache(discordMessageId: string): Promise<string | null>;
}

/**
 * Whether a reference is worth a lookup at all.
 *
 * `assistant` is the obvious case. `undefined` is included because
 * `classifyReferenceAuthorRole` omits the stamp precisely when the message is
 * machine-authored but our own identity is not yet known (before ClientReady,
 * and during every gateway reconnect) — a mapping hit there is positive proof
 * our bot sent it, which is strictly more than the missing stamp said. A
 * `user` or `bot` stamp is authoritative and gets no lookup.
 *
 * A legacy reference predating the classifier also carries no stamp and may
 * well be human-authored; that costs a lookup that misses, which is the same
 * outcome as not trying.
 */
function needsLookup(ref: ReferencedMessage): boolean {
  // A forwarded snapshot carries the FORWARDING message's id — Discord's
  // `message_snapshots` omit the original's id entirely, so `SnapshotFormatter`
  // substitutes the wrapper's. The key therefore does not identify the quoted
  // content, and a hit on it would bind the WRONG personality rather than a
  // merely stale one. Excluded by identity, not by access: no cache entry could
  // be the right answer here, so this holds whatever the bot starts posting.
  // (It also carries no `authorRole` — snapshots strip author identity — so
  // without this guard every forward would spend a lookup that cannot help.)
  if (ref.isForwarded === true) {
    return false;
  }
  return ref.authorRole === 'assistant' || ref.authorRole === undefined;
}

/**
 * Resolve personality ids for every reference our bot may have authored.
 *
 * Keyed by `discordMessageId` and deduped before dispatch: two quotes of the
 * same message must not become two lookups.
 *
 * Non-UUID values are rejected rather than carried. The current writer only
 * ever stores a UUID, but `ReplyResolutionService` guards the same read with
 * `isUuidFormat` — so a non-UUID is treated as reachable here too, and a NAME
 * in `from_id` is the exact defect this resolution exists to remove: it would
 * resolve against nothing in the roster and re-introduce name-keyed identity
 * one layer down.
 *
 * @returns Discord message id → personality UUID, holding only what resolved.
 */
export async function resolveAuthorPersonalityIds(
  references: readonly ReferencedMessage[],
  lookups: AuthorPersonalityLookups
): Promise<Map<string, string>> {
  const candidates = [
    ...new Set(references.filter(needsLookup).map(ref => ref.discordMessageId)),
  ].filter(id => id.length > 0);

  if (candidates.length === 0) {
    return new Map();
  }

  const resolved = new Map<string, string>();
  await Promise.all(
    candidates.map(async discordMessageId => {
      const id = await resolveOne(discordMessageId, lookups);
      if (id !== null) {
        resolved.set(discordMessageId, id);
      }
    })
  );

  logger.debug(
    { candidates: candidates.length, resolved: resolved.size },
    'Resolved reference author personality ids'
  );
  return resolved;
}

/**
 * One message's personality id, or null.
 *
 * Fails soft by construction rather than by trusting the injected lookup to do
 * it: this runs on the AI-job submission path, so a rejected promise here would
 * cost the user their whole turn to save a `from_id`. Losing the id costs a
 * role decision by name, which is the pre-existing behaviour.
 */
async function resolveOne(
  discordMessageId: string,
  lookups: AuthorPersonalityLookups
): Promise<string | null> {
  try {
    const cached = await lookups.fromWebhookCache(discordMessageId);
    return cached !== null && isUuidFormat(cached) ? cached : null;
  } catch (err) {
    logger.warn(
      { err, discordMessageId },
      'Author personality id lookup failed; rendering by name'
    );
    return null;
  }
}

/**
 * Stamp resolved ids onto the references in place.
 *
 * Separate from resolution so the lookup half stays a pure function of its
 * injected lookups, and so a caller can inspect what resolved before applying
 * it.
 */
export function applyAuthorPersonalityIds(
  references: ReferencedMessage[],
  resolved: ReadonlyMap<string, string>
): void {
  for (const ref of references) {
    const id = resolved.get(ref.discordMessageId);
    if (id !== undefined) {
      ref.authorPersonalityId = id;
    }
  }
}
