/**
 * Character Browse Helpers
 *
 * Internal helper functions for character browse functionality.
 * Extracted to keep browse.ts under 500 lines.
 */

import { escapeMarkdown } from 'discord.js';
import { createListComparator } from '../../utils/listSorting.js';
import type { CharacterData } from './config.js';
import type { CharacterBrowseFilter, CharacterBrowseSortType } from './browse.js';

/**
 * List item with group markers for rendering.
 * The isGroupStart flag indicates where to render section headers.
 */
export interface ListItem {
  char: CharacterData;
  isOwn: boolean;
  isGroupStart: boolean;
  groupHeader?: string;
}

/**
 * Create a character comparator for sorting.
 * Uses shared listSorting utility for consistent sort behavior.
 */
export const characterComparator = createListComparator<CharacterData>(
  c => c.displayName ?? c.name,
  c => c.updatedAt
);

/**
 * Format a character line for the list
 */
export function formatCharacterLine(c: CharacterData): string {
  const visibility = c.isPublic ? '🌐' : '🔒';
  const displayName = escapeMarkdown(c.displayName ?? c.name);
  return `${visibility} **${displayName}** (\`${c.slug}\`)`;
}

/** Filter labels for display */
export const FILTER_LABELS: Record<CharacterBrowseFilter, string> = {
  all: 'All',
  mine: 'My Characters',
  public: 'Public Only',
};

/**
 * Filter characters by filter type and query
 */
export function filterCharacters(
  ownCharacters: CharacterData[],
  publicCharacters: CharacterData[],
  userId: string,
  filter: CharacterBrowseFilter,
  query: string | null
): { own: CharacterData[]; others: CharacterData[] } {
  let own = ownCharacters;
  let others = publicCharacters.filter(c => c.ownerId !== userId);

  // Apply filter
  switch (filter) {
    case 'mine':
      others = []; // Only show owned characters
      break;
    case 'public':
      // Only show public characters (both own public and others' public)
      own = own.filter(c => c.isPublic);
      break;
    case 'all':
    default:
      // Show all accessible
      break;
  }

  // Apply search query
  if (query !== null && query.length > 0) {
    const lowerQuery = query.toLowerCase();
    const matchesQuery = (c: CharacterData): boolean =>
      (c.displayName ?? c.name).toLowerCase().includes(lowerQuery) ||
      c.slug.toLowerCase().includes(lowerQuery) ||
      (c.characterInfo?.toLowerCase().includes(lowerQuery) ?? false);

    own = own.filter(matchesQuery);
    others = others.filter(matchesQuery);
  }

  return { own, others };
}

/**
 * Create sorted, grouped list items ready for pagination.
 * Groups are sorted by owner name, characters within groups by sort type.
 * This ensures owner groups stay together across page boundaries.
 */
export function createListItems(
  ownCharacters: CharacterData[],
  othersPublic: CharacterData[],
  creatorNames: Map<string, string>,
  sortType: CharacterBrowseSortType
): ListItem[] {
  const items: ListItem[] = [];

  // Sort own characters
  const sortedOwn = [...ownCharacters].sort(characterComparator(sortType));

  // Add own characters (first group)
  for (let i = 0; i < sortedOwn.length; i++) {
    items.push({
      char: sortedOwn[i],
      isOwn: true,
      isGroupStart: i === 0,
      groupHeader: i === 0 ? `**📝 Your Characters (${ownCharacters.length})**` : undefined,
    });
  }

  if (othersPublic.length === 0) {
    return items;
  }

  // Group by owner
  const byOwner = new Map<string, CharacterData[]>();
  for (const char of othersPublic) {
    const ownerId = char.ownerId ?? 'system';
    const existing = byOwner.get(ownerId) ?? [];
    existing.push(char);
    byOwner.set(ownerId, existing);
  }

  // Sort characters within each owner group
  for (const chars of byOwner.values()) {
    chars.sort(characterComparator(sortType));
  }

  // Sort owner groups by owner name
  const sortedOwnerGroups = [...byOwner.entries()]
    .map(([ownerId, chars]) => ({
      ownerId,
      ownerName: ownerId === 'system' ? 'System' : (creatorNames.get(ownerId) ?? 'Unknown'),
      chars,
    }))
    .sort((a, b) => a.ownerName.localeCompare(b.ownerName));

  // Add section header for "Other Users' Characters"
  let isFirstOthersGroup = true;
  for (const group of sortedOwnerGroups) {
    for (let i = 0; i < group.chars.length; i++) {
      const isGroupStart = i === 0;
      let groupHeader: string | undefined;

      if (isGroupStart) {
        if (isFirstOthersGroup) {
          // First group of others gets the section header
          groupHeader = `**🌐 Other Users' Characters (${othersPublic.length})**\n\n__${escapeMarkdown(group.ownerName)}__`;
          isFirstOthersGroup = false;
        } else {
          // Subsequent groups just get owner subheader
          groupHeader = `\n__${escapeMarkdown(group.ownerName)}__`;
        }
      }

      items.push({
        char: group.chars[i],
        isOwn: false,
        isGroupStart,
        groupHeader,
      });
    }
  }

  return items;
}

/**
 * Build the search/filter info line for the embed description
 */
export function buildFilterLine(
  query: string | null,
  filter: CharacterBrowseFilter
): string | null {
  if (query !== null) {
    return `🔍 Searching: "${query}" • Filter: ${FILTER_LABELS[filter]}\n`;
  }
  if (filter !== 'all') {
    return `Filter: ${FILTER_LABELS[filter]}\n`;
  }
  return null;
}

/**
 * Build empty state lines when user has no own characters
 */
export function buildEmptyStateLines(
  safePage: number,
  ownCount: number,
  filter: CharacterBrowseFilter,
  hasOthersOnPage: boolean
): string[] {
  const lines: string[] = [];
  if (safePage === 0 && ownCount === 0 && filter !== 'public') {
    lines.push(`**📝 Your Characters (0)**`);
    lines.push("_You don't have any characters yet._");
    lines.push('Use `/character create` to create your first one!');
    if (hasOthersOnPage) {
      lines.push('');
    }
  }
  return lines;
}

/**
 * Render page items with their group headers
 */
export function renderPageItems(pageItems: ListItem[], existingLinesLength: number): string[] {
  const lines: string[] = [];
  for (const item of pageItems) {
    if (item.groupHeader !== undefined) {
      // Add separator before "Other Users" section if coming from own chars
      const totalLines = existingLinesLength + lines.length;
      const lastLine = lines.length > 0 ? lines[lines.length - 1] : '';
      if (!item.isOwn && totalLines > 0 && !lastLine.startsWith('**🌐')) {
        lines.push('');
      }
      lines.push(item.groupHeader);
    }
    lines.push(formatCharacterLine(item.char));
  }
  return lines;
}
