/**
 * The `stickerVisionEnabled` kill switch, in one place.
 *
 * Sticker vision is admin-switchable because it is unconditional spend: every
 * sticker that reaches the vision chain costs a call. bot-client cannot make
 * that decision — it has no reader for system settings and always sends
 * stickers — so the switch has to bite server-side.
 *
 * ## Where the spend actually happens (the thing that is easy to get wrong)
 *
 * It is NOT in ai-worker's generation pipeline. **api-gateway queues the vision
 * work first**: `createJobChain` -> `categorizeAttachments` buckets anything
 * `image/*` — including sticker-derived synthetic attachments — into
 * `ImageDescription` CHILD jobs, and BullMQ runs those to completion before the
 * parent generation job starts.
 *
 * So a filter placed anywhere in the generation pipeline is not a kill switch:
 * the call has already been billed, and filtering merely discards the paid-for
 * description. That is the exact failure this module exists to prevent — a
 * switch that covers some of the spend is worse than none, because it reads as
 * off while still billing.
 *
 * ## The gates
 *
 * 1. **`jobChainOrchestrator` (api-gateway)** — THE one that stops spend, for
 *    both the trigger message and every referenced/quoted/forwarded one, by
 *    filtering before the dependency jobs are built.
 * 2. `DownloadAttachmentsStep` (ai-worker) — trigger + extended context.
 * 3. `AttachmentProcessor.processAttachmentsParallel` (ai-worker) — references.
 *
 * 2 and 3 are NOT redundant with 1: they keep a sticker out of the rendered
 * prompt on paths that do not go through the job chain at all (a job replayed
 * from a payload built before the switch flipped, a description already cached
 * from an earlier turn). They govern what the model SEES; gate 1 governs what
 * gets BOUGHT.
 *
 * **Gates, not callers.** Several places hand attachments to vision —
 * `ConversationInputProcessor`, `DependencyStep`, `extendedContextVisionProcessor`
 * — but each reads a list an earlier gate already filtered. Before adding a
 * gate, check whether the list is already filtered upstream; before adding a
 * vision CALLER, check whether its list is.
 *
 * **`ragVisionAuth.enrichRagHistory` is not gated, by design.** It re-describes
 * attachments already stored in conversation history (heal-on-read) — it
 * re-derives a description the system already paid for and then lost (cache
 * expiry, an older row, a failed write), rather than authorising new spend on
 * a newly-arrived sticker. One consequence: switching sticker vision off does
 * not retroactively degrade history the system already described. Revisit
 * only if the switch is flipped in prod and spend does not drop.
 *
 * This list is the current state, not a proof of exhaustiveness. Re-derive it
 * when a render path is added, and derive it from where JOBS are created, not
 * from where descriptions are consumed.
 *
 * Dropping a sticker costs the message nothing. The `[Stickers: …]` line
 * bot-client renders into the content names every sticker regardless, so the
 * character still knows one arrived and what it was called — it just does not
 * get told what the image depicts.
 */

import { getSystemSetting } from './SystemSettingsService.js';

/** The slice of an attachment this gate reads. */
interface StickerFlagged {
  isSticker?: boolean;
}

/**
 * Drop sticker attachments when the kill switch is off.
 *
 * Takes `enabled` rather than reading the setting itself so a caller that
 * filters several lists reads the switch ONCE — two reads of a live setting
 * could in principle disagree mid-request, and a message whose trigger stickers
 * were dropped but whose reference stickers were not would be incoherent.
 */
export function keepStickersIf<T extends StickerFlagged>(enabled: boolean, attachments: T[]): T[] {
  return enabled ? attachments : attachments.filter(a => a.isSticker !== true);
}

/**
 * Read the switch and apply it in one step, for callers with a single list.
 */
export function filterStickersBySetting<T extends StickerFlagged>(attachments: T[]): T[] {
  return keepStickersIf(getSystemSetting('stickerVisionEnabled'), attachments);
}
