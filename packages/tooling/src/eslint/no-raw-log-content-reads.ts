/**
 * Receiver classification for `no-raw-log-content` Patterns C and D, split into
 * its own module to keep the rule file under the repo's max-lines limit. These
 * helpers answer one question — "is this node a filename / attachment-URL read
 * off an attachment-like object?" — and know nothing about sinks or walks; the
 * rule's docblock (`no-raw-log-content.ts`) documents what each pattern
 * reports and why.
 */

/** Minimal ESTree node shape the rule and these helpers share. */
export interface AstNode {
  type: string;
  parent?: AstNode;
  [key: string]: unknown;
}

/** Non-computed property names that read a filename off a file-ish object. */
const FILENAME_PROPS: ReadonlySet<string> = new Set([
  'name',
  'filename',
  'fileName',
  'originalName',
]);

/** True for a property name that reads a filename (`name` / `filename` / `fileName` / `originalName`). */
export function isFilenameProp(name: string): boolean {
  return FILENAME_PROPS.has(name);
}

/**
 * Non-computed property names that read a URL off an attachment-ish object.
 * `originalUrl` is only matched off an attachment-ish object too, so an
 * Express `req.originalUrl` is not a finding.
 */
const ATTACHMENT_URL_PROPS: ReadonlySet<string> = new Set([
  'url',
  'proxyURL',
  'proxy_url',
  'originalUrl',
]);

/** True for a property name that reads an attachment URL (`url` / `proxyURL` / `proxy_url` / `originalUrl`). */
export function isAttachmentUrlProp(name: string): boolean {
  return ATTACHMENT_URL_PROPS.has(name);
}

/**
 * The name that decides whether an object is "file-ish": an Identifier's own
 * name, or — for a non-computed member chain (`msg.attachment`) — its last
 * property name. A computed object (`attachments[0]`) has no such name.
 */
export function fileIshObjectName(node: AstNode): string | undefined {
  if (node.type === 'Identifier') {
    return node.name as string;
  }
  if (node.type === 'MemberExpression' && node.computed !== true) {
    const property = node.property as AstNode;
    return property.type === 'Identifier' ? (property.name as string) : undefined;
  }
  return undefined;
}

/** `attachment`, `att`, `file`, `upload`, or a name ending in `Attachment`/`File` (case-sensitive). */
export function isFileIshName(name: string): boolean {
  return (
    name === 'attachment' ||
    name === 'att' ||
    name === 'file' ||
    name === 'upload' ||
    name.endsWith('Attachment') ||
    name.endsWith('File')
  );
}

/**
 * Pattern D's wider receiver set: the file-ish names plus the media names a
 * URL is read off in this codebase (`img.url`, `audio.url`, `heroImage.url`).
 * Wider than Pattern C because `.url` on a name like `img` is an attachment
 * URL here, while `img.name` would not be a filename; case-sensitive.
 */
export function isAttachmentIshName(name: string): boolean {
  return (
    isFileIshName(name) ||
    name === 'img' ||
    name === 'image' ||
    name === 'audio' ||
    name.endsWith('Image') ||
    name.endsWith('Audio')
  );
}

/** A non-computed member read of one of `props` off an object whose name passes `isReceiver`. */
function isPropReadOff(
  node: AstNode,
  isProp: (name: string) => boolean,
  isReceiver: (name: string) => boolean
): boolean {
  if (node.type !== 'MemberExpression' || node.computed === true) {
    return false;
  }
  const property = node.property as AstNode;
  if (property.type !== 'Identifier' || !isProp(property.name as string)) {
    return false;
  }
  const objectName = fileIshObjectName(node.object as AstNode);
  return objectName !== undefined && isReceiver(objectName);
}

/** `attachment.name`, `att.filename`, `msg.attachment.name` — a filename read off a file-ish object. */
export function isFilenameRead(node: AstNode): boolean {
  return isPropReadOff(node, isFilenameProp, isFileIshName);
}

/** `attachment.url`, `audio.url`, `outcome.attachment.proxyURL` — a URL read off an attachment-ish object. */
export function isAttachmentUrlRead(node: AstNode): boolean {
  return isPropReadOff(node, isAttachmentUrlProp, isAttachmentIshName);
}
