/**
 * XML Builder Utilities
 *
 * Safe XML construction for LLM prompts using template literals.
 * Handles all escaping automatically to prevent prompt injection.
 *
 * Design decisions:
 * - Zero dependencies (vs xmlbuilder2 or @xmpp/xml)
 * - Template literal tag for clean, readable syntax
 * - Automatic escaping of all interpolated values
 * - Control over whitespace (important for token costs)
 */

/**
 * XML tag constants used in prompt structure.
 * Single source of truth for all XML tag names.
 */
export const XML_TAGS = {
  // Chat log structure
  CHAT_LOG: 'chat_log',
  MESSAGE: 'message',

  // Reference structure
  CONTEXTUAL_REFERENCES: 'contextual_references',
  QUOTED_MESSAGES: 'quoted_messages',
  QUOTE: 'quote',

  // Reference details
  AUTHOR: 'author',
  LOCATION: 'location',
  TIME: 'time',
  CONTENT: 'content',
  EMBEDS: 'embeds',
  ATTACHMENTS: 'attachments',

  // Prompt structure
  PERSONA: 'persona',
  PROTOCOL: 'protocol',
  MEMORY_ARCHIVE: 'memory_archive',
  PARTICIPANTS: 'participants',
  ENVIRONMENT: 'environment',
} as const;

/**
 * Escapes reserved XML characters in a string.
 *
 * Handles the 5 standard XML entities:
 * - & → &amp; (must be first to avoid double-escaping)
 * - < → &lt;
 * - > → &gt;
 * - " → &quot;
 * - ' → &apos;
 *
 * @param unsafe - String that may contain XML special characters
 * @returns Escaped string safe for use in XML content or attributes
 *
 * @example
 * ```typescript
 * escapeXml('User "Name" <Admin>') // → 'User &quot;Name&quot; &lt;Admin&gt;'
 * escapeXml('x > 5 && y < 3')      // → 'x &gt; 5 &amp;&amp; y &lt; 3'
 * ```
 */
export function escapeXml(unsafe: string | number | null | undefined): string {
  if (unsafe === null || unsafe === undefined) {
    return '';
  }

  if (typeof unsafe === 'number') {
    return String(unsafe);
  }

  // Order matters: & must be escaped first to avoid double-escaping
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Tagged template literal for safe XML construction.
 *
 * All interpolated values are automatically escaped, preventing
 * XML injection attacks. This is the recommended way to build
 * XML strings for LLM prompts.
 *
 * Features:
 * - Automatic escaping of all interpolated values
 * - Arrays are joined without separators
 * - null/undefined become empty strings
 * - Numbers are converted to strings
 *
 * @example
 * ```typescript
 * const userName = 'User "Name" <Admin>';
 * const content = 'Tell me about <tags> & stuff';
 *
 * const prompt = xml`
 *   <message from="${userName}" role="user">
 *     ${content}
 *   </message>
 * `;
 * // Result: <message from="User &quot;Name&quot; &lt;Admin&gt;" role="user">
 * //           Tell me about &lt;tags&gt; &amp; stuff
 * //         </message>
 * ```
 *
 * @example
 * ```typescript
 * // Arrays are joined (useful for lists of elements)
 * const messages = ['<msg>1</msg>', '<msg>2</msg>'];
 * const result = xml`<list>${messages}</list>`;
 * // Result: <list><msg>1</msg><msg>2</msg></list>
 * ```
 */
export function xml(strings: TemplateStringsArray, ...values: unknown[]): string {
  let result = '';

  for (let i = 0; i < strings.length; i++) {
    result += strings[i];

    if (i < values.length) {
      const val = values[i];

      if (Array.isArray(val)) {
        // Arrays are joined without separator (for lists of XML elements)
        result += val.join('');
      } else if (val === null || val === undefined) {
        // null/undefined become empty string
        result += '';
      } else if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
        // Primitive types are escaped
        result += escapeXml(String(val));
      } else if (typeof val === 'bigint') {
        // BigInt has a meaningful string representation
        result += escapeXml(val.toString());
      } else if (typeof val === 'symbol' || typeof val === 'function') {
        // Symbols and functions can't be meaningfully stringified in XML
        throw new TypeError(
          `xml template tag received a ${typeof val} that cannot be stringified for XML.`
        );
      } else {
        // Objects and any other types can't be stringified meaningfully
        // typeof val === 'object' is true here (we've exhausted all other types)
        throw new TypeError(
          `xml template tag received an object that cannot be stringified. ` +
            `Use JSON.stringify() or a custom serializer before interpolating.`
        );
      }
    }
  }

  return result;
}

/**
 * Build an XML attribute string from an object.
 *
 * Useful when you have a dynamic set of attributes.
 * All values are automatically escaped.
 *
 * @param attrs - Object of attribute name-value pairs
 * @returns Attribute string like ' name="value" other="val"'
 *
 * @example
 * ```typescript
 * xmlAttrs({ from: 'Alice', role: 'user' })
 * // Returns: ' from="Alice" role="user"'
 *
 * xmlAttrs({ name: 'Test "Value"' })
 * // Returns: ' name="Test &quot;Value&quot;"'
 * ```
 */
export function xmlAttrs(
  attrs: Record<string, string | number | boolean | null | undefined>
): string {
  const parts: string[] = [];

  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) {
      continue;
    }

    if (value === true) {
      // Boolean true becomes just the attribute name (like HTML)
      parts.push(key);
    } else {
      parts.push(`${key}="${escapeXml(value)}"`);
    }
  }

  return parts.length > 0 ? ' ' + parts.join(' ') : '';
}

/**
 * Create an XML element with content and optional attributes.
 *
 * This is a helper for programmatic element creation when
 * template literals are less convenient.
 *
 * @param tag - Element tag name
 * @param content - Element content (will be escaped)
 * @param attrs - Optional attributes
 * @returns Complete XML element string
 *
 * @example
 * ```typescript
 * xmlElement('message', 'Hello world', { from: 'Alice', role: 'user' })
 * // Returns: '<message from="Alice" role="user">Hello world</message>'
 *
 * xmlElement('br', '', {})
 * // Returns: '<br></br>'
 * ```
 */
export function xmlElement(
  tag: string,
  content: string | number | null | undefined,
  attrs: Record<string, string | number | boolean | null | undefined> = {}
): string {
  const attrString = xmlAttrs(attrs);
  const safeContent = escapeXml(content);
  return `<${tag}${attrString}>${safeContent}</${tag}>`;
}

/**
 * Create a self-closing XML element.
 *
 * @param tag - Element tag name
 * @param attrs - Element attributes
 * @returns Self-closing XML element string
 *
 * @example
 * ```typescript
 * xmlSelfClosing('author', { name: 'Alice', role: 'user' })
 * // Returns: '<author name="Alice" role="user"/>'
 * ```
 */
export function xmlSelfClosing(
  tag: string,
  attrs: Record<string, string | number | boolean | null | undefined> = {}
): string {
  const attrString = xmlAttrs(attrs);
  return `<${tag}${attrString}/>`;
}
