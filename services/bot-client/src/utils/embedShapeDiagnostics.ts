/**
 * Embed Shape Diagnostics
 *
 * Temporary instrumentation for an embed that carried no renderable legacy
 * `APIEmbed` content — the shape observed when an unfurl moves its content to
 * Components V2, outside the fields EmbedParser reads. Logs only structural
 * information (key names, numeric component types) so a production capture
 * can inform a future Components V2 renderer without ever carrying message
 * content into the logs.
 */

import type { APIEmbed, Message } from 'discord.js';
import { createLogger } from '@tzurot/common-types/utils/logger';

const logger = createLogger('EmbedShapeDiagnostics');

/**
 * Structural summary of one top-level message component: its numeric type,
 * how many children it carries, and their numeric types. Carries no content
 * drawn from the message.
 */
interface ComponentShapeSummary {
  type: number;
  childCount: number;
  childTypes: number[];
}

/**
 * Narrow an unknown value to "has a numeric `type` property".
 */
function hasNumericType(value: unknown): value is { type: number } {
  return (
    typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'number'
  );
}

/**
 * Read a top-level component's children array. `ContainerComponent`,
 * `ActionRow`, and `SectionComponent` carry theirs under `components`;
 * `MediaGalleryComponent` carries its items under `items`. Anything else has
 * no children this diagnostic can see.
 */
function readComponentChildren(component: unknown): unknown[] {
  if (typeof component !== 'object' || component === null) {
    return [];
  }
  const withComponents = component as { components?: unknown };
  if (Array.isArray(withComponents.components)) {
    return withComponents.components;
  }
  const withItems = component as { items?: unknown };
  if (Array.isArray(withItems.items)) {
    return withItems.items;
  }
  return [];
}

/**
 * Summarize one top-level component's shape: its numeric type, its child
 * count, and its children's numeric types (children with no numeric `type` —
 * MediaGallery items — are skipped rather than logged as `undefined`).
 */
function summarizeComponent(component: unknown): ComponentShapeSummary | null {
  if (!hasNumericType(component)) {
    return null;
  }
  const children = readComponentChildren(component);
  const childTypes = children.filter(hasNumericType).map(child => child.type);
  return { type: component.type, childCount: children.length, childTypes };
}

/**
 * Key names only, sorted for a stable, order-independent read — never values.
 *
 * Shared by the `<embed keys="...">` marker attribute (EmbedParser) and this
 * module's `embedKeys` log field: both are meant to name the SAME key set, so
 * diagnosing a production occurrence means correlating the marker's attribute
 * against the log line's field. Computing the two sets independently would
 * let them silently diverge with nothing to detect it.
 */
export function sortedEmbedKeys(embed: APIEmbed): string[] {
  return Object.keys(embed).sort();
}

/**
 * Log the structural shape of an embed with no renderable legacy content —
 * whether it rendered nothing at all, or only wrapper metadata (`url`,
 * `type`, `provider`, `color`, `timestamp`) that names where an unfurl came
 * from without showing what it displayed.
 *
 * Always logs the embed's key names and declared type. When a live `message`
 * is available, additionally logs a structural summary of its top-level
 * component tree — numeric component types and child counts only, never any
 * value drawn from the message (no text, no URLs, no names).
 *
 * @param embed - The embed with no renderable content
 * @param message - The live Discord message carrying this embed, when
 *   available; absent for a stored/snapshot embed with no live message object
 */
export function logEmptyEmbedShape(embed: APIEmbed, message?: Message): void {
  const embedKeys = sortedEmbedKeys(embed);
  const embedType = embed.type ?? null;

  if (message === undefined) {
    logger.warn(
      { embedKeys, embedType },
      'Embed rendered no content; no message object was available for a component tree'
    );
    return;
  }

  const components = message.components ?? [];
  const componentCount = components.length;
  const componentShapes = components
    .map(summarizeComponent)
    .filter((shape): shape is ComponentShapeSummary => shape !== null);

  logger.warn(
    { embedKeys, embedType, messageId: message.id, componentCount, components: componentShapes },
    'Embed rendered no content; message component shape recorded'
  );
}
