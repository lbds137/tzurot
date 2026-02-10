/**
 * Shared Forwarded Message Formatter
 *
 * Unified XML formatter for forwarded messages. Both code paths use this:
 * - ReferencedMessageFormatter (message link path)
 * - conversationUtils (chat history path)
 *
 * This eliminates the DRY violation where two separate paths produced
 * different XML for the same kind of content.
 */

import { escapeXml, escapeXmlContent } from '@tzurot/common-types';

/**
 * Normalized content for a forwarded message.
 * Both code paths build this DTO, then call formatForwardedQuote().
 */
export interface ForwardedMessageContent {
  /** Plain text content of the forwarded message */
  textContent?: string;
  /** Image descriptions from vision processing */
  imageDescriptions?: { filename: string; description: string }[];
  /** Pre-formatted embed XML strings */
  embedsXml?: string[];
  /** Voice message transcripts */
  voiceTranscripts?: string[];
  /** Pre-formatted attachment lines (non-image, non-voice) */
  attachmentLines?: string[];
  /** Timestamp with both absolute date and relative time */
  timestamp?: { absolute: string; relative: string };
}

/**
 * Format a forwarded message as structured XML with child elements.
 *
 * Canonical format:
 * ```xml
 * <quote type="forward" author="Unknown">
 *   <time absolute="..." relative="..."/>
 *   <content>message text</content>
 *   <image_descriptions>
 *     <image filename="foo.png">description</image>
 *   </image_descriptions>
 *   <embeds>...</embeds>
 *   <voice_transcripts>...</voice_transcripts>
 *   <attachments>...</attachments>
 * </quote>
 * ```
 */
export function formatForwardedQuote(content: ForwardedMessageContent): string {
  const parts: string[] = [];
  parts.push('<quote type="forward" author="Unknown">');

  if (content.timestamp) {
    parts.push(
      `<time absolute="${escapeXml(content.timestamp.absolute)}" relative="${escapeXml(content.timestamp.relative)}"/>`
    );
  }

  if (content.textContent !== undefined && content.textContent.length > 0) {
    parts.push(`<content>${escapeXmlContent(content.textContent)}</content>`);
  }

  if (content.imageDescriptions !== undefined && content.imageDescriptions.length > 0) {
    const images = content.imageDescriptions
      .map(
        img =>
          `<image filename="${escapeXml(img.filename)}">${escapeXmlContent(img.description)}</image>`
      )
      .join('\n');
    parts.push(`<image_descriptions>\n${images}\n</image_descriptions>`);
  }

  if (content.embedsXml !== undefined && content.embedsXml.length > 0) {
    parts.push(`<embeds>\n${content.embedsXml.join('\n')}\n</embeds>`);
  }

  if (content.voiceTranscripts !== undefined && content.voiceTranscripts.length > 0) {
    const transcripts = content.voiceTranscripts
      .map(t => `<transcript>${escapeXmlContent(t)}</transcript>`)
      .join('\n');
    parts.push(`<voice_transcripts>\n${transcripts}\n</voice_transcripts>`);
  }

  if (content.attachmentLines !== undefined && content.attachmentLines.length > 0) {
    parts.push(`<attachments>\n${content.attachmentLines.join('\n')}\n</attachments>`);
  }

  parts.push('</quote>');
  return parts.join('\n');
}
