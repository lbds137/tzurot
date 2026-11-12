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
import { isDataUrl } from '../../../../utils/attachmentFetch.js';

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

/** An STT child job that succeeded but produced an empty transcript. */
export interface AudioEmptyInfo {
  url: string;
  sourceReferenceNumber?: number;
}

/** Description of a voice attachment whose transcript came back empty. */
const EMPTY_TRANSCRIPT_DESCRIPTION = 'No speech detected';

/**
 * The last path segment of a URL, without its query string (the query string of
 * a signed CDN URL, `?ex=&is=&hm=`, never survives). Falls back to a plain
 * split on `/` when the string is not a parseable URL, then to `'image'`.
 */
export function urlBasename(url: string): string {
  // A data URL has no filename; its "path" is the payload.
  if (isDataUrl(url)) {
    return 'image';
  }
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
 * key on.
 *
 * `originals` is the PRE-download list (`GenerationContext.triggerAttachmentDownloads`
 * originals): each one's `url` is the Discord CDN URL and it usually has no
 * `originalUrl`. When that recorded list is absent, DependencyStep passes the
 * job's own attachments instead, which are the downloaded copies: `url` is a
 * `data:` URL and `originalUrl` holds the CDN URL.
 *
 * Correlation is on the original's `originalUrl`, falling back to its `url`,
 * compared with the result entry's `originalUrl` (the CDN URL the job
 * reports). On a match only the metadata is replaced — `type`, `description`
 * and `originalUrl` stay the result's own, and `metadata.url` keeps the
 * result's CDN URL so a multi-megabyte data URL never rides into the processed
 * entry. An entry with no match is returned as-is, and the list keeps its order
 * and length.
 *
 * The joined `metadata.size` depends on the list: on the normal path it is the
 * size Discord reported; on the fallback it is the size `DownloadAttachmentsStep`
 * recorded (the downloaded, post-resize byte count, or for an attachment that
 * arrived as a data URL its upstream size or a length-based estimate).
 *
 * Originals whose download failed are in the list, so a result for one of them
 * still matches. A miss is therefore an entry whose URL no listed original
 * carries, or any entry when the list is empty (no trigger attachments, or the
 * recorded list absent and the job carrying none). Misses are logged once per
 * call with counts only (no URL or filename).
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
 * The Discord CDN URL an original attachment is recorded under in a stub or an
 * inline entry. An original that already arrived as a `data:` URL (passed
 * through by `DownloadAttachmentsStep`) has no CDN URL, so this returns `''`
 * rather than letting a multi-megabyte payload reach the persisted history.
 */
export function cdnUrlOf(original: AttachmentMetadata): string {
  const url = original.originalUrl ?? original.url;
  return isDataUrl(url) ? '' : url;
}

/**
 * The user-visible notice for a trigger attachment that could not be processed.
 *
 * Wording mirrors MultimodalProcessor's retry-failure fallback minus the attempt
 * count, which is not in hand here. A failed image or audio job gets no inline
 * retry, by owner decision; this is the one function to swap if that decision
 * changes. Metadata comes from the ORIGINAL, so voice-message and duration
 * flags survive into the rendered header. The notice renders outside the
 * voice-transcript wrapper (the render rule lives in RAGUtils's
 * formatProcessedAttachmentEntry, pinned by its failure-render tests), so the
 * wording must stay recognizably non-speech.
 */
export function buildFailureStub(
  original: AttachmentMetadata,
  kind: PreprocessingKind,
  category: SttFailureReason | (typeof FAILURE_CATEGORY)[keyof typeof FAILURE_CATEGORY] | 'other'
): ProcessedAttachment {
  const cdn = cdnUrlOf(original);
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
    processingFailed: true,
  };
}

/**
 * The user-visible entry for a voice attachment whose STT job succeeded but
 * returned an empty transcript (silence). Metadata comes from the ORIGINAL, so
 * the voice-message label and duration survive into the rendered header.
 */
export function buildEmptyTranscriptStub(original: AttachmentMetadata): ProcessedAttachment {
  const cdn = cdnUrlOf(original);
  return {
    type: AttachmentType.Audio,
    description: EMPTY_TRANSCRIPT_DESCRIPTION,
    originalUrl: cdn,
    metadata: { ...original, url: cdn },
  };
}

interface MergeOptions {
  /** Entries rebuilt from child job results, already metadata-restored. */
  jobEntries: ProcessedAttachment[];
  downloads: TriggerAttachmentDownload[];
  audioFailures: AudioFailureInfo[];
  /** STT jobs that succeeded with an empty transcript. Defaults to none. */
  audioEmpties?: AudioEmptyInfo[];
  /** Processes `file`-kind attachments that no child job covers. */
  processInline: (attachments: AttachmentMetadata[]) => Promise<ProcessedAttachment[]>;
  jobId: string | undefined;
}

/**
 * One processed entry per original trigger attachment, in original order.
 *
 * Per original, in precedence: a matching job entry; a matching failed STT
 * job; a matching empty-transcript STT job; a failed download; inline
 * processing for a `file`; otherwise a "no result" stub. Stubs come only from
 * originals, so an audio failure or empty transcript that matches no original
 * produces nothing. Job entries that match no original are appended after the
 * originals (the caller's metadata join already logged them as unmatched).
 */
export async function mergeTriggerAttachments(opts: MergeOptions): Promise<ProcessedAttachment[]> {
  const { jobEntries, downloads, audioFailures, audioEmpties = [], processInline, jobId } = opts;
  const used = new Set<ProcessedAttachment>();
  const usedFailures = new Set<AudioFailureInfo>();
  const usedEmpties = new Set<AudioEmptyInfo>();
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
    const failure = audioFailures.find(f => !usedFailures.has(f) && f.url === key);
    if (failure !== undefined) {
      usedFailures.add(failure);
      slots.push(buildFailureStub(original, kind, failure.failureReason ?? 'other'));
      return;
    }
    const empty = audioEmpties.find(e => !usedEmpties.has(e) && e.url === key);
    if (empty !== undefined) {
      usedEmpties.add(empty);
      slots.push(buildEmptyTranscriptStub(original));
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
    if (processed.length === queue.length) {
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
    const cdn = cdnUrlOf(original);
    const entry = results?.[i];
    // The CDN URL (or '' when the original itself was a data URL) replaces the
    // downloaded data URL so a multi-megabyte payload never rides into the
    // processed entry or the persisted history.
    // Metadata comes from the original (not the downloaded copy the inline
    // result carries), so the render flags match the other merge sources.
    slots[slot] =
      entry === undefined
        ? buildFailureStub(original, 'file', FAILURE_CATEGORY.INLINE_FAILED)
        : { ...entry, originalUrl: cdn, metadata: { ...original, url: cdn } };
  });
}
