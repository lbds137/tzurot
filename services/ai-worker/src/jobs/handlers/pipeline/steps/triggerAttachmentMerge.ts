/**
 * Trigger Attachment Merge
 *
 * When a job carries dependencies, DependencyStep produces exactly one
 * processed entry per original trigger attachment, in original order, and both
 * the prompt and the history writer consume that list. The entries come from
 * three sources, in this precedence: a child job's result (matched on the
 * original's CDN URL), a user-visible failure stub (failed download, failed
 * STT job, image/audio with no result), or inline processing (`file`-kind
 * attachments, which no child job ever covers).
 */

import { AttachmentType } from '@tzurot/common-types/constants/media';
import type { SttFailureReason } from '@tzurot/common-types/types/jobs';
import type { AttachmentMetadata } from '@tzurot/common-types/types/schemas/discord';
import {
  classifyForPreprocessing,
  type PreprocessingKind,
} from '@tzurot/common-types/utils/attachmentPreprocessingPlan';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { ProcessedAttachment } from '../../../../services/MultimodalProcessor.js';
import type { TriggerAttachmentDownload } from '../types.js';

// Keeps the log attribution of the moved provenance warning under DependencyStep.
const logger = createLogger('DependencyStep');

/** Failure categories rendered into a stub's description. */
export const FAILURE_CATEGORY = {
  /** The attachment's bytes could not be fetched. */
  DOWNLOAD_FAILED: 'download failed',
  /** The attachment was downloaded but no child job result covered it. */
  NO_RESULT: 'no result returned',
  /** Inline processing of a file attachment threw or returned an unusable list. */
  INLINE_FAILED: 'processing failed',
} as const;

/**
 * A positively-failed STT child job. `url` is the attachment's CDN URL as the
 * job reports it.
 */
export interface AudioFailureInfo {
  url: string;
  failureReason?: SttFailureReason;
  sourceReferenceNumber?: number;
}

/**
 * The last path segment of a URL, without its query string (the query string of
 * a signed CDN URL, `?ex=&is=&hm=`, never survives). Falls back to a plain
 * split on `/` when the string is not a parseable URL, then to `'image'`.
 */
export function urlBasename(url: string): string {
  try {
    const segment = new URL(url).pathname.split('/').pop();
    if (segment !== undefined && segment.length > 0) {
      return segment;
    }
  } catch {
    // Not an absolute URL: fall through to the plain split.
  }
  const fallback = url.split('/').pop();
  return fallback !== undefined && fallback.length > 0 ? fallback : 'image';
}

/**
 * Put the trigger message's original attachment metadata back on the entries
 * rebuilt from job results.
 *
 * A job result carries only the URL, the name and the description, so the
 * rebuild synthesizes a placeholder content type and drops the provenance flags
 * (spoiler, sticker, link preview, voice message, duration) the render headers
 * key on. The original metadata is in the job context. Correlation is on the
 * context attachment's `originalUrl`, falling back to its `url`: by the time
 * this step runs, `DownloadAttachmentsStep` has already replaced each trigger
 * attachment's `url` with a `data:` URL and moved the Discord CDN URL to
 * `originalUrl`, which is the URL the job result reports. On a match only the
 * metadata is replaced — `type`, `description` and `originalUrl` stay the
 * result's own, and `metadata.url` keeps the result's CDN URL so a
 * multi-megabyte data URL never rides into the processed entry. An entry with
 * no match is returned as-is, and the list keeps its order and length.
 *
 * The joined `metadata.size` is the size `DownloadAttachmentsStep` recorded: the
 * downloaded (post-resize) byte count, or for an attachment that arrived as a
 * data URL, its upstream size or a length-based estimate. It is not Discord's
 * reported size.
 *
 * Every entry that finds no match is a miss, including all of them when the
 * context carries no attachments or none survived the download. Misses are
 * logged once per call with counts only (no URL or filename).
 */
export function restoreOriginalMetadata(
  entries: ProcessedAttachment[],
  originals: AttachmentMetadata[] | undefined,
  jobId: string | undefined
): ProcessedAttachment[] {
  if (entries.length === 0) {
    return entries;
  }
  if (originals === undefined || originals.length === 0) {
    logger.warn(
      { jobId, unmatched: entries.length, contextCount: 0 },
      'Provenance join missed context attachments; placeholder metadata kept'
    );
    return entries;
  }
  let unmatched = 0;
  const joined = entries.map(entry => {
    // `originalUrl` is the CDN URL once the download step has run; the plain
    // `url` is the same CDN URL when nothing rewrote the attachment.
    const original = originals.find(
      candidate => (candidate.originalUrl ?? candidate.url) === entry.originalUrl
    );
    if (original === undefined) {
      unmatched += 1;
      return entry;
    }
    return { ...entry, metadata: { ...original, url: entry.metadata.url } };
  });
  if (unmatched > 0) {
    logger.warn(
      { jobId, unmatched, contextCount: originals.length },
      'Provenance join missed context attachments; placeholder metadata kept'
    );
  }
  return joined;
}

/**
 * The user-visible notice for a trigger attachment that could not be processed.
 *
 * Wording mirrors MultimodalProcessor's retry-failure fallback minus the attempt
 * count, which is not in hand here. A failed image or audio job gets no inline
 * retry, by owner decision; this is the one function to swap if that decision
 * changes. Metadata comes from the ORIGINAL, so voice-message and duration
 * flags survive into the rendered header.
 */
export function buildFailureStub(
  original: AttachmentMetadata,
  kind: PreprocessingKind,
  category: string
): ProcessedAttachment {
  const cdn = original.originalUrl ?? original.url;
  const stub = {
    image: {
      type: AttachmentType.Image,
      description: `Image processing failed (${category})`,
    },
    audio: {
      type: AttachmentType.Audio,
      description: `Audio transcription failed (${category})`,
    },
    file: {
      type: AttachmentType.File,
      description: `File could not be processed (${category})`,
    },
  }[kind];
  return {
    type: stub.type,
    description: stub.description,
    originalUrl: cdn,
    metadata: { ...original, url: cdn },
  };
}

interface MergeOptions {
  /** Entries rebuilt from child job results, already metadata-restored. */
  jobEntries: ProcessedAttachment[];
  downloads: TriggerAttachmentDownload[];
  audioFailures: AudioFailureInfo[];
  /** Processes `file`-kind attachments that no child job covers. */
  processInline: (attachments: AttachmentMetadata[]) => Promise<ProcessedAttachment[]>;
  jobId: string | undefined;
}

/**
 * One processed entry per original trigger attachment, in original order.
 *
 * Per original, in precedence: a matching job entry; a matching failed STT
 * job; a failed download; inline processing for a `file`; otherwise a
 * "no result" stub. Stubs come only from originals, so an audio failure that
 * matches no original produces nothing. Job entries that match no original are
 * appended after the originals.
 */
export async function mergeTriggerAttachments(opts: MergeOptions): Promise<ProcessedAttachment[]> {
  const { jobEntries, downloads, audioFailures, processInline, jobId } = opts;
  const used = new Set<ProcessedAttachment>();
  const slots: (ProcessedAttachment | null)[] = [];
  const queue: { slot: number; original: AttachmentMetadata; downloaded: AttachmentMetadata }[] =
    [];

  downloads.forEach((download, slot) => {
    const { original, downloaded } = download;
    const key = original.originalUrl ?? original.url;
    const kind = classifyForPreprocessing(original);

    const entry = jobEntries.find(e => !used.has(e) && e.originalUrl === key);
    if (entry !== undefined) {
      used.add(entry);
      slots.push(entry);
      return;
    }
    const failure = audioFailures.find(f => f.url === key);
    if (failure !== undefined) {
      slots.push(buildFailureStub(original, kind, failure.failureReason ?? 'other'));
      return;
    }
    if (downloaded === null) {
      slots.push(buildFailureStub(original, kind, FAILURE_CATEGORY.DOWNLOAD_FAILED));
      return;
    }
    if (kind === 'file') {
      slots.push(null);
      queue.push({ slot, original, downloaded });
      return;
    }
    slots.push(buildFailureStub(original, kind, FAILURE_CATEGORY.NO_RESULT));
  });

  if (queue.length > 0) {
    await fillInlineSlots(slots, queue, processInline, jobId);
  }

  const orphans = jobEntries.filter(e => !used.has(e));
  if (orphans.length > 0) {
    logger.warn(
      { jobId, orphaned: orphans.length },
      'Trigger job results matched no original attachment; appended after the originals'
    );
  }

  return [...slots.filter((s): s is ProcessedAttachment => s !== null), ...orphans];
}

async function fillInlineSlots(
  slots: (ProcessedAttachment | null)[],
  queue: { slot: number; original: AttachmentMetadata; downloaded: AttachmentMetadata }[],
  processInline: MergeOptions['processInline'],
  jobId: string | undefined
): Promise<void> {
  let results: ProcessedAttachment[] | null = null;
  let threw = false;
  try {
    const processed = await processInline(queue.map(q => q.downloaded));
    if (Array.isArray(processed) && processed.length === queue.length) {
      results = processed;
    }
  } catch (error) {
    threw = true;
    logger.warn(
      { err: error, jobId, count: queue.length },
      'Inline processing of trigger files threw'
    );
  }
  if (results === null && !threw) {
    logger.warn({ jobId, count: queue.length }, 'Inline processing of trigger files failed');
  }
  queue.forEach(({ slot, original }, i) => {
    const cdn = original.originalUrl ?? original.url;
    const entry = results?.[i];
    // The CDN URL replaces the data URL so a multi-megabyte payload never rides
    // into the processed entry or the persisted history.
    slots[slot] =
      entry === undefined
        ? buildFailureStub(original, 'file', FAILURE_CATEGORY.INLINE_FAILED)
        : { ...entry, originalUrl: cdn, metadata: { ...entry.metadata, url: cdn } };
  });
}
