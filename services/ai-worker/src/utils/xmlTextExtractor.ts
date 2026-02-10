/**
 * XML Text Extractor
 *
 * Extracts plain text content from XML strings using fast-xml-parser.
 * Used for converting formatted XML references into search-friendly plain text.
 */

import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: true,
  trimValues: true,
});

/**
 * Recursively extract all text values from a parsed XML object
 */
function collectTextValues(node: unknown): string[] {
  if (typeof node === 'string') {
    return node.trim().length > 0 ? [node.trim()] : [];
  }
  if (typeof node === 'number' || typeof node === 'boolean') {
    return [String(node)];
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
 * @returns Plain text content with each text node on its own line
 */
export function extractXmlTextContent(xml: string): string {
  if (xml.trim().length === 0) {
    return '';
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- fast-xml-parser returns untyped parsed XML
  const parsed = parser.parse(xml);
  const values = collectTextValues(parsed);

  return values
    .filter(
      line =>
        line.length > 0 &&
        !line.startsWith('Author unavailable') &&
        line !== 'The user is referencing the following messages:'
    )
    .join('\n');
}
