/**
 * Delivery flow for MultiTagCoordinator. Extracted into a sibling file so
 * the coordinator itself stays under the 400-line `max-lines` cap.
 *
 * **What lives here**: the slot-burst delivery (`deliverGroup`) and its
 * per-slot helper (`deliverSlot`). Both run AFTER `flushEntry` has
 * registered the group with the ordering service and the ordering buffer
 * has decided this group's turn has arrived. Errors here are
 * delivery-side concerns; the coordinator's in-memory state has already
 * been cleaned up unconditionally by `flushEntry`'s `finally` block.
 *
 * **What stays in the coordinator**: orchestration (startFanOut,
 * handleJobResult, beginShutdown, adoptRehydratedEntry, safety timeout),
 * stale-set state, and the in-memory `entries` / `jobToGroup` maps.
 *
 * Both exported functions take a `DeliveryFlowDeps` shape (a subset of
 * `MultiTagCoordinatorDeps`) so the coordinator can pass `this.deps` in
 * without forcing a circular import.
 */

import { createLogger, MULTI_TAG, type LLMGenerationResult } from '@tzurot/common-types';
import { buildErrorContent } from '../utils/buildErrorContent.js';
import { pickNewDMActivePersonality } from './SlotResolver.js';
import { buildSlotContext, toSnapshot } from './multiTagCoordinatorHelpers.js';
import type { RuntimeEntry, RuntimeSlot } from './multiTagCoordinatorHelpers.js';
import type { SlotDeliveryService } from './SlotDeliveryService.js';
import type { GatewayClient } from '../utils/GatewayClient.js';
import type { MultiTagPersistence } from './MultiTagPersistence.js';

/**
 * Subset of `MultiTagCoordinatorDeps` that the delivery flow actually
 * touches. Defined locally (rather than imported from MultiTagCoordinator)
 * to avoid a circular module dependency. The flow doesn't need
 * chatManager / jobTracker / orderingService.
 */
export interface DeliveryFlowDeps {
  slotDelivery: SlotDeliveryService;
  gatewayClient: GatewayClient;
  persistence: MultiTagPersistence;
}

const logger = createLogger('MultiTagDeliveryFlow');

/**
 * A slot is deliverable via the success path only when its job completed,
 * the result claims success, and the content is a non-empty string. Mirrors
 * the boundary validation in `MessageHandler.handleSinglePersonalityResult`
 * so multi-tag and single-personality paths handle empty content identically.
 */
function hasUsableContent(slot: { status: string; result?: LLMGenerationResult }): boolean {
  return (
    slot.status === 'completed' &&
    slot.result !== undefined &&
    slot.result.success !== false &&
    typeof slot.result.content === 'string' &&
    slot.result.content.length > 0
  );
}

/**
 * Deliver a single slot's response (success or error), error-contained
 * so a failing slot can't block its siblings in the burst.
 */
async function deliverSlot(
  entry: RuntimeEntry,
  slot: RuntimeSlot,
  deps: DeliveryFlowDeps
): Promise<void> {
  const slotContext = buildSlotContext(entry, slot);
  try {
    // Parity with MessageHandler.handleSinglePersonalityResult: a slot
    // marked `completed` with `success !== false` can still carry empty
    // or non-string content (rare upstream edge cases like rate-limit
    // soft-fail). Without this guard, deliverSuccess would throw, the
    // per-slot catch below would swallow it, and the user would get NO
    // response AND no error for that slot. Route through the error path
    // so the user at least sees a fallback message.
    if (hasUsableContent(slot)) {
      await deps.slotDelivery.deliverSuccess(
        slot.result as LLMGenerationResult & { success: true },
        slotContext
      );
      return;
    }
    if (slot.status === 'completed' && slot.result !== undefined) {
      logger.warn(
        {
          groupId: entry.groupId,
          slotIndex: slot.slotIndex,
          personalityId: slot.personality.id,
          hasContent: slot.result.content !== undefined && slot.result.content !== null,
          contentType: typeof slot.result.content,
        },
        'Slot result completed but content missing/empty — routing to error path'
      );
    }
    const synthetic: LLMGenerationResult = slot.result ?? {
      requestId: entry.groupId,
      success: false,
      error: slot.status === 'timedout' ? 'Response timed out' : 'No response received',
    };
    await deps.slotDelivery.deliverError(buildErrorContent(synthetic), synthetic, slotContext);
  } catch (err) {
    logger.error(
      {
        err,
        groupId: entry.groupId,
        slotIndex: slot.slotIndex,
        personalityId: slot.personality.id,
      },
      'Slot delivery threw — continuing to next slot'
    );
  }
}

/**
 * Sequentially send each slot's response to Discord in slot order. Called
 * by the ordering service when the group's turn arrives (i.e., no earlier
 * channel message is waiting).
 */
export async function deliverGroup(entry: RuntimeEntry, deps: DeliveryFlowDeps): Promise<void> {
  for (const slot of entry.slots) {
    await deliverSlot(entry, slot, deps);
  }

  // If the resolver's cap dropped tagged personalities, append a one-line
  // notice so the user knows fewer characters responded than tagged.
  // Sent AFTER the slot burst so it appears in correct order in the
  // channel. Best-effort — log on failure but don't impact cleanup.
  if (entry.truncated) {
    try {
      await entry.message.reply(
        `_(Only the first ${MULTI_TAG.MAX_TAGS} tagged personalities respond.)_`
      );
    } catch (err) {
      logger.warn({ err, groupId: entry.groupId }, 'Failed to send multi-tag truncation notice');
    }
  }

  // Best-effort delivery confirmation (clears Redis stream entries).
  await Promise.all(
    entry.slots.map(slot =>
      deps.gatewayClient.confirmDelivery(slot.jobId).catch(err => {
        logger.warn(
          { err, jobId: slot.jobId, groupId: entry.groupId },
          'confirmDelivery failed after multi-tag flush'
        );
      })
    )
  );

  // For DM channels, record the new active personality so the next bare
  // DM message routes to the textually-last-tagged character. Best-effort
  // — failures logged inside setDmSessionPersonality, not thrown.
  //
  // Also clear the backfill-tried sentinel: a session just materialized,
  // so any prior "we already scanned and found nothing" cache is now
  // stale. Without this, a previously-empty DM that got a fan-out today
  // would wait up to 1h (sentinel TTL) before bare DMs could route via
  // the fast path. Fire-and-forget — failure is logged inside the method.
  if (entry.guildId === null) {
    const newActive = pickNewDMActivePersonality(
      entry.slots.map(s => ({
        personality: s.personality,
        source: s.source,
        isAutoResponse: s.isAutoResponse,
      }))
    );
    if (newActive !== null) {
      // Both fire-and-forget: setDmSessionPersonality catches internally
      // and clearDMBackfillTried fails open. Mixing await+void here would
      // mean a setDmSessionPersonality throw would prevent the sentinel
      // clear from firing (next line is unreachable on throw), which is
      // surprising behavior.
      void deps.gatewayClient.setDmSessionPersonality(entry.channel.id, newActive.slug);
      void deps.persistence.clearDMBackfillTried(entry.channel.id);
    }
  }

  // In-memory teardown (clearTimeout, entries.delete, jobToGroup.delete,
  // flushingGroups.delete) is handled unconditionally by flushEntry's
  // finally — so a throw from orderingService.handleResult before this
  // callback runs doesn't leak entries. Only delivery-contingent cleanup
  // (Redis persistence delete) belongs here.
  //
  // Cleanup failure must not propagate up through the ordering-service
  // callback: the user-visible delivery already succeeded above, and the
  // stale Redis entry will self-clean via the 30-min TTL. A noisy log
  // here would misrepresent "delivery failed" to operators watching
  // logs; log-and-swallow is the correct posture.
  await deps.persistence.deleteEntry(toSnapshot(entry)).catch(err => {
    logger.warn(
      { err, groupId: entry.groupId },
      'Failed to delete coordinator entry from Redis — TTL will reclaim'
    );
  });

  logger.info(
    { groupId: entry.groupId, deliveredCount: entry.slots.length },
    'Multi-tag group delivered and cleaned up'
  );
}
