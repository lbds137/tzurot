/**
 * XML Text Extractor
 *
 * Extracts plain text content from XML strings using fast-xml-parser.
 * Used for converting formatted XML references into search-friendly plain text.
 */

import { XMLParser } from 'fast-xml-parser';
import { contentPreview } from '@tzurot/common-types/utils/logContentPreview';
import { createLogger } from '@tzurot/common-types/utils/logger';

const logger = createLogger('xmlTextExtractor');

const parser = new XMLParser({
  ignoreAttributes: true, // We only need text content for search, not attribute values
  trimValues: true,
  // Verbatim text for search: numeric-looking ids/codes (007, hex, zip) must not be rewritten
  parseTagValue: false,
});

/**
 * Recursively extract all text values from a parsed XML object
 */
function collectTextValues(node: unknown): string[] {
  if (typeof node === 'string') {
    return node.trim().length > 0 ? [node.trim()] : [];
  }
  if (Array.isArray(node)) {
    return node.flatMap(item => collectTextValues(item));
  }
  if (typeof node === 'object' && node !== null) {
    return Object.values(node).flatMap(value => collectTextValues(value));
  }
  return [];
}

/**
 * Extract plain text content from an XML string.
 *
 * Uses fast-xml-parser to properly parse XML and extract only text node values,
 * ignoring tag names and attributes. This avoids regex-based tag stripping which
 * CodeQL flags as incomplete multi-character sanitization.
 *
 * @param xml - XML string to extract text from
 * @returns Plain text content: each element's text on its own line; a mixed-content
 *   element's text fragments concatenate trimmed with no separator and are emitted
 *   after its child elements' text
 */
export function extractXmlTextContent(xml: string): string {
  if (xml.trim().length === 0) {
    return '';
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- fast-xml-parser returns untyped parsed XML
    const parsed = parser.parse(xml);
    const values = collectTextValues(parsed);

    return values.join('\n');
  } catch (error) {
    logger.warn(
      { err: error, xmlLength: xml.length, xmlPreview: contentPreview(xml, 200) },
      'Failed to parse XML for text extraction'
    );
    return '';
  }
}
