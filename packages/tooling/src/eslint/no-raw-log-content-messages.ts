/**
 * Message ids and text for `no-raw-log-content`, split into its own module
 * to keep the main rule file under the repo's max-lines limit. The rule's
 * mechanics, sink semantics, and per-message remedy rationale are documented
 * in `no-raw-log-content.ts`'s top docblock — this file only holds the text
 * ESLint reports.
 */

export type MessageId =
  | 'rawTruncation'
  | 'rawTruncationInError'
  | 'rawResponseBody'
  | 'previewInError'
  | 'rawFilename'
  | 'rawFilenameInError'
  | 'rawAttachmentUrl'
  | 'rawAttachmentUrlInError';

export const MESSAGES: Record<MessageId, string> = {
  rawTruncation:
    'Raw string truncation reaching a log field. User content goes through ' +
    'contentPreview(text, n) (dev-gated) or contentDigest(text) ' +
    '(@tzurot/common-types/utils/logContentPreview); an identifier prefix ' +
    'goes through idPrefix(id) so the intent is named, and a URL through ' +
    'attachmentUrlShape(url), which reduces a non-Discord URL to its host.',
  rawTruncationInError:
    'Raw string truncation reaching an Error message, which rides `err` into log ' +
    'lines. Put the length and contentDigest(text) ' +
    '(@tzurot/common-types/utils/logContentPreview) in the message, never a preview; ' +
    'an identifier prefix goes through idPrefix(id) so the intent is named, and a ' +
    'URL through attachmentUrlShape(url), which reduces a non-Discord URL to its host.',
  previewInError:
    'contentPreview reaching an Error message. A preview belongs in a log field ' +
    'only; an Error message rides `err` into every log line that handles it. Put ' +
    'the length and contentDigest(text) in the message instead.',
  rawResponseBody:
    'Raw response body (bound from `.text()`) reaching a log field or an Error ' +
    'message. Log its length and contentDigest(body); a preview goes through ' +
    'contentPreview(body, n) in a log field, never into an Error message.',
  rawFilename:
    'User-supplied filename reaching a log field. A filename is user content: log ' +
    'filenameShape(name) (@tzurot/common-types/utils/logContentPreview) — extension ' +
    'and length only — beside the attachment id / content type.',
  rawFilenameInError:
    'User-supplied filename reaching an Error message, which rides `err` into log ' +
    "lines. Don't put the filename in the message; use " +
    'filenameShape(name)?.extension (@tzurot/common-types/utils/logContentPreview) or ' +
    'omit it.',
  rawAttachmentUrl:
    'Raw attachment URL reaching a log field. A Discord CDN attachment URL ends in ' +
    'the user-supplied filename, and a truncated URL can still include it: log ' +
    'attachmentUrlShape(url) (@tzurot/common-types/utils/logContentPreview) — host and ' +
    'channel/attachment ids for a Discord attachment, else the host alone — or drop the field where requestId / jobId ' +
    'already identifies the request.',
  rawAttachmentUrlInError:
    'Raw attachment URL reaching an Error message, which rides `err` into log lines. ' +
    'The URL ends in the user-supplied filename: use attachmentUrlShape(url) ' +
    '(@tzurot/common-types/utils/logContentPreview) or omit it.',
};
