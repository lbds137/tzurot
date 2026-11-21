import { describe, it, expect } from 'vitest';
import tseslint from 'typescript-eslint';
import {
  type AstNode,
  fileIshObjectName,
  isAttachmentIshName,
  isAttachmentUrlRead,
  isFileIshName,
  isFilenameRead,
} from './no-raw-log-content-reads.js';

/** The first ExpressionStatement's expression of `source`, as an AstNode. */
function expression(source: string): AstNode {
  const { ast } = tseslint.parser.parseForESLint(source) as unknown as {
    ast: { body: unknown[] };
  };
  const statement = ast.body[0] as { expression: AstNode };
  return statement.expression;
}

describe('isFileIshName / isAttachmentIshName', () => {
  it('accepts the file-ish names and suffixes, case-sensitively', () => {
    for (const name of ['attachment', 'att', 'file', 'upload', 'imageAttachment', 'firstFile']) {
      expect(isFileIshName(name)).toBe(true);
    }
    for (const name of ['profile', 'Attachments', 'files', 'link']) {
      expect(isFileIshName(name)).toBe(false);
    }
  });

  it('widens to the media names for URLs only', () => {
    for (const name of ['img', 'image', 'audio', 'heroImage', 'voiceAudio', 'attachment']) {
      expect(isAttachmentIshName(name)).toBe(true);
    }
    expect(isFileIshName('img')).toBe(false);
    expect(isAttachmentIshName('link')).toBe(false);
    expect(isAttachmentIshName('req')).toBe(false);
  });
});

describe('fileIshObjectName', () => {
  it('names an identifier and the last property of a member chain', () => {
    expect(fileIshObjectName(expression('attachment'))).toBe('attachment');
    expect(fileIshObjectName(expression('msg.attachment'))).toBe('attachment');
  });

  it('has no name for a computed member or a call', () => {
    expect(fileIshObjectName(expression('attachments[0]'))).toBeUndefined();
    expect(fileIshObjectName(expression('getAttachment()'))).toBeUndefined();
  });
});

describe('isFilenameRead / isAttachmentUrlRead', () => {
  it('reads a filename prop off a file-ish object, and not a url prop', () => {
    expect(isFilenameRead(expression('attachment.name'))).toBe(true);
    expect(isFilenameRead(expression('att.filename'))).toBe(true);
    expect(isFilenameRead(expression('attachment.url'))).toBe(false);
    expect(isFilenameRead(expression('profile.name'))).toBe(false);
  });

  it('reads a url prop off an attachment-ish object, and not a filename prop', () => {
    expect(isAttachmentUrlRead(expression('attachment.url'))).toBe(true);
    expect(isAttachmentUrlRead(expression('img.proxyURL'))).toBe(true);
    expect(isAttachmentUrlRead(expression('msg.audio.proxy_url'))).toBe(true);
    expect(isAttachmentUrlRead(expression('attachment.originalUrl'))).toBe(true);
    expect(isAttachmentUrlRead(expression('attachment.name'))).toBe(false);
  });

  it('rejects a url read off a non-attachment object and a computed property', () => {
    expect(isAttachmentUrlRead(expression('req.originalUrl'))).toBe(false);
    expect(isAttachmentUrlRead(expression('link.url'))).toBe(false);
    expect(isAttachmentUrlRead(expression("attachment['url']"))).toBe(false);
    expect(isAttachmentUrlRead(expression('attachments[0].url'))).toBe(false);
  });

  it('rejects a node that is not a member expression', () => {
    expect(isAttachmentUrlRead(expression('attachment'))).toBe(false);
    expect(isFilenameRead(expression('name()'))).toBe(false);
  });
});
