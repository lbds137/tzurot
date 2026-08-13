/**
 * Tag-Filtered Chime-In
 *
 * `/chime-in tag:<tag>` — every accessible character carrying the tag weighs in
 * on the recent conversation, capped by the admin-configurable multi-character
 * cap (`getMultiTagCap`). Over the cap, a uniform random sample of cap-many
 * responds and the reply says so.
 *
 * Each sampled character gets an INDEPENDENT turn through the shared engine
 * (`runCharacterTurn`) — the same path `/chime-in character:` takes, so gates,
 * persona resolution, config cascade, and push delivery are identical.
 *
 * ## Two accepted tradeoffs (design decisions, not defects)
 *
 * **Replies arrive in completion order, not pool order.** Delivery is
 * push-based: each turn submits its own job and the ResultsListener delivers
 * whichever finishes first. There is deliberately no ordering coordinator here.
 * `MultiTagCoordinator` — which DOES order the message-path fan-out — anchors on
 * a real user message id and keys its Redis state by that id; a slash invocation
 * has no such message, and its jobs push-deliver independently. Retrofitting it
 * would mean inventing a synthetic message-id key space purely to sequence
 * replies, which buys ordering at the cost of a second, subtly-different
 * coordinator state machine.
 *
 * **The tag vocabulary is bounded by the accessible-list page size** — see the
 * module header of `tagPool.ts`, which owns that tradeoff.
 *
 * Turns are submitted SEQUENTIALLY. Every turn resolves the SAME invoking user's
 * routing context (which provisions the user server-side), so firing N of them
 * concurrently would race identical provisioning for no benefit: submission
 * latency is invisible to the user under push delivery.
 */

import { escapeMarkdown, MessageFlags } from 'discord.js';
import { DISCORD_LIMITS } from '@tzurot/common-types/constants/discord';
import {
  normalizeTag,
  type PersonalitySummary,
} from '@tzurot/common-types/schemas/api/personality';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { getCachedPersonalities } from '../../utils/autocomplete/autocompleteCache.js';
import { clientsFor } from '../../utils/gatewayClients.js';
import { getMultiTagCap } from '../../utils/gatewayServiceCalls.js';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { classifyGatewayFailure } from '../../ux/catalog/classify.js';
import { renderSpec } from '../../ux/render/render.js';
import { runCharacterTurn } from './characterTurn.js';
import {
  filterByTag,
  sampleUpTo,
  emptyTagPoolDetail,
  tagPoolDisplayName,
  boundedTag,
} from './tagPool.js';

const logger = createLogger('chime-in-tag');

/** Shown when the invoker supplied both `character` and `tag`, or neither. */
export const CHIME_IN_SELECTOR_USAGE_DETAIL =
  'Pick either a `character` or a `tag` — one or the other, not both and not neither.';

/**
 * A view of the command context whose replies never touch the deferred message.
 *
 * The fan-out's notice (or its absence) has already claimed the deferred reply
 * before any turn runs, and every turn shares that one interaction. Left alone,
 * the FIRST gate block would `editReply` over the notice and the rest would
 * overwrite each other — so a blocked character would erase the record of who
 * else is answering. Redirecting to an ephemeral `followUp` gives each blocked
 * character its own private line while the notice survives; `deleteReply`
 * becomes a no-op for the same reason (the explicit-pick path deletes the
 * deferred reply, which here would delete the notice).
 *
 * Successful turns are unaffected: they deliver through the push path
 * (JobTracker → MessageHandler), which never touches the interaction.
 */
export function sharedReplyContext(context: DeferredCommandContext): DeferredCommandContext {
  return {
    ...context,
    editReply: async options => {
      // Forwarded field-by-field rather than spread: the edit-reply payload
      // allows `null` (meaning "clear this field") where the follow-up payload
      // does not, and it carries edit-only keys (`message`, `threadId`) that
      // have no meaning on a new message. Every caller on this path sends
      // `content`; embeds/components are carried for future ones.
      const payload = typeof options === 'string' ? { content: options } : options;
      return context.followUp({
        content: payload.content ?? undefined,
        embeds: payload.embeds ?? undefined,
        components: payload.components ?? undefined,
        flags: MessageFlags.Ephemeral,
      });
    },
    deleteReply: async () => {
      /* no-op: the deferred reply belongs to the fan-out notice, not to one turn */
    },
  };
}

/**
 * Build the over-cap sampling notice.
 *
 * Display names are author-controlled, so they are markdown-escaped. The tag
 * is the caller-normalized needle (`runTagChimeIn` normalizes on entry, pinned
 * by the "echoes the normalized form" test): a needle that MATCHED anything is
 * byte-equal to a stored tag, which `PersonalityTagSchema` constrains to
 * `[a-z0-9-]` — so the echo carries no markdown to escape, and no backtick that
 * could close the code span early. `emptyTagPoolDetail` renders the tag the same
 * way but must escape, because its needle matched nothing and so inherits none
 * of that guarantee.
 */
function buildSamplingNotice(tag: string, poolSize: number, sampled: PersonalitySummary[]): string {
  const head = `🎲 ${poolSize} characters carry \`${tag}\` — picked ${sampled.length} at random: `;
  const names = sampled.map(p => escapeMarkdown(tagPoolDisplayName(p)));
  return head + joinNamesWithinBudget(names, DISCORD_LIMITS.MESSAGE_LENGTH - head.length);
}

/**
 * Join `names` into at most `budget` characters, replacing whatever doesn't fit
 * with an `…and N more` tail.
 *
 * Display names are author-authored and stored up to 255 characters each, and
 * markdown-escaping can roughly double that — so cap-many of them overrun
 * Discord's 2000-character message ceiling, which rejects the edit and (before
 * the caller's guard) aborted the fan-out before any character had spoken.
 *
 * Shrinks one name at a time and re-measures rather than budgeting up front,
 * because dropping a name lengthens the tail it is replaced by; the pool here
 * is cap-bounded (≤10), so the repeated join costs nothing.
 *
 * The `kept === 0` floor returns the bare tail with no further truncation. That
 * is safe on the strength of the CALLER's budget, not of anything this function
 * enforces: `buildSamplingNotice`'s head is bounded by the tag (≤32 — a needle
 * that matched is byte-equal to a stored tag) plus two counts, leaving far more
 * than the tail's dozen-odd characters. A caller passing a tight budget would
 * need its own floor.
 */
function joinNamesWithinBudget(names: string[], budget: number): string {
  let kept = names.length;
  let joined = names.join(', ');
  while (kept > 0 && joined.length > budget) {
    kept -= 1;
    const tail = `…and ${names.length - kept} more`;
    joined = kept > 0 ? `${names.slice(0, kept).join(', ')}, ${tail}` : tail;
  }
  return joined;
}

/** Fetch the accessible pool, or a rendered error to surface to the user. */
async function loadAccessiblePool(
  context: DeferredCommandContext
): Promise<{ kind: 'ok'; pool: PersonalitySummary[] } | { kind: 'error'; message: string }> {
  const { userClient } = clientsFor(context.interaction);
  const result = await getCachedPersonalities(userClient);
  if (result.kind === 'error') {
    logger.warn(
      { err: result.error, userId: context.user.id },
      'Personalities lookup failed during tag chime-in'
    );
    return {
      kind: 'error',
      message: renderSpec(
        classifyGatewayFailure(result.error, 'characters', { operation: 'read' })
      ),
    };
  }
  return { kind: 'ok', pool: result.value };
}

/**
 * `/chime-in tag:` — fan the weigh-in out across the characters carrying `tag`.
 *
 * @param incognitoOption The raw `incognito` option (null when unset); each turn
 *   applies the same default a single-character chime-in would.
 */
export async function runTagChimeIn(
  context: DeferredCommandContext,
  params: { tag: string; incognitoOption: boolean | null }
): Promise<void> {
  // Normalize the free-typed option once, here: the filter and the empty-pool
  // detail each normalize defensively anyway (idempotent), but the sampling
  // notice interpolates the needle verbatim — without this, it would echo the
  // user's raw casing/whitespace instead of the tag that was actually matched.
  const tag = normalizeTag(params.tag);
  // Logged instead of `tag` itself. Normalizing does not shorten, and the
  // Discord option declares no `setMaxLength`, so a fan-out would otherwise
  // write up to 6000 user-controlled characters into structured logs on EVERY
  // invocation. The reply paths can interpolate `tag` unbounded-looking only
  // because they either bound it themselves or run after it matched a stored
  // (≤32-char) tag; a log line has neither protection.
  const loggedTag = boundedTag(tag);
  const { incognitoOption } = params;

  const loaded = await loadAccessiblePool(context);
  if (loaded.kind === 'error') {
    await context.editReply({ content: loaded.message });
    return;
  }

  const pool = filterByTag(loaded.pool, tag);
  if (pool.length === 0) {
    await context.editReply({
      content: renderSpec(CATALOG.error.validation(emptyTagPoolDetail(tag))),
    });
    return;
  }

  const cap = await getMultiTagCap();
  const sampled = sampleUpTo(pool, cap);

  // Claim the deferred reply BEFORE any turn runs — from here on every turn
  // uses the shared-reply view, which can no longer reach this message.
  if (sampled.length < pool.length) {
    try {
      await context.editReply({ content: buildSamplingNotice(tag, pool.length, sampled) });
    } catch (error) {
      // Same posture as the delete branch below: the notice is context, not the
      // answer. Losing it must not abort N turns that have not run yet — they
      // deliver through the push path, which never touches this interaction.
      logger.warn(
        { err: error, tag: loggedTag, userId: context.user.id },
        'Could not post the tag fan-out sampling notice'
      );
    }
  } else {
    // Whole pool responds: no sampling happened, so there is nothing to
    // announce. Drop the "thinking..." indicator the way an explicit-pick
    // chime-in does rather than leaving it stale beside the replies.
    try {
      await context.deleteReply();
    } catch (error) {
      // Recovery path: proceed with the fan-out. The delete is cosmetic — a
      // stale indicator ages out on its own — so its failure must not abort
      // N turns that haven't run yet.
      logger.debug(
        { err: error, userId: context.user.id },
        'Could not delete the deferred reply before the tag fan-out'
      );
    }
  }

  logger.info(
    {
      tag: loggedTag,
      poolSize: pool.length,
      cap,
      sampledSize: sampled.length,
      userId: context.user.id,
    },
    'Tag chime-in fan-out starting'
  );

  const turnContext = sharedReplyContext(context);
  for (const personality of sampled) {
    await runCharacterTurn(turnContext, {
      characterArg: personality.slug,
      message: null, // no message → weigh-in mode
      filters: { excludePrivate: false, onlyMine: false },
      incognitoOption,
    });
  }
}
