/**
 * Classification of discord.js surface hits into inventory categories.
 *
 * Route families: builder classes construct into `message-builders` /
 * `command-options` / `components`; enum members whose container no table
 * names default to `discord-enums`; message-payload option keys resolve by
 * receiver first (Webhook → `webhook-options`, builder receivers → their
 * builder family) and only then by the MESSAGE_OPTION_KEYS vocabulary
 * (`message-options`). `unclassified` stays the visibility bucket for
 * unmapped constructions and object-literal keys; methods and property
 * accesses land in `client-methods`.
 *
 * Pure decision tables — no ts-morph, no filesystem — so the taxonomy is
 * unit-testable in isolation from the AST walk that produces the hits.
 */

import type { SurfaceCategory, SurfaceEntry } from './types.js';

/** A single resolved discord.js-surface site awaiting classification. */
export interface ClassifiableHit {
  kind: 'call' | 'property-access' | 'new' | 'enum-member' | 'option-key';
  symbolName: string;
  /** Nearest named container of the declaration (enum name like 'Events'/'MessageFlags'/'TextInputStyle', or undefined). */
  containerName?: string;
  /** Symbol name of the receiver type for member accesses/calls (e.g. 'Webhook'), when resolvable. */
  receiverTypeName?: string;
  /** For option-key hits: name of the discord.js call the key was passed to (e.g. 'createWebhook'). */
  callName?: string;
}

/** Interaction ack / response methods — sites where bot-client answers an interaction. */
export const INTERACTION_ACK_METHODS = [
  'reply',
  'deferReply',
  'editReply',
  'followUp',
  'deferUpdate',
  'update',
  'showModal',
  'respond',
  'deleteReply',
] as const;

/** Message-composition builders — embeds and attachments are not interactive components; `components` stays interactive-only. */
export const MESSAGE_BUILDER_CLASSES = ['EmbedBuilder', 'AttachmentBuilder'] as const;

/** discord.js builder/container classes instantiated in bot-client source. */
export const COMPONENT_CLASSES = [
  'ButtonBuilder',
  'ActionRowBuilder',
  'StringSelectMenuBuilder',
  'StringSelectMenuOptionBuilder',
  'UserSelectMenuBuilder',
  'RoleSelectMenuBuilder',
  'MentionableSelectMenuBuilder',
  'ChannelSelectMenuBuilder',
  'ModalBuilder',
  'TextInputBuilder',
  'ContainerBuilder',
  'TextDisplayBuilder',
  'SectionBuilder',
  'SeparatorBuilder',
  'MediaGalleryBuilder',
  'MediaGalleryItemBuilder',
  'ThumbnailBuilder',
  'FileBuilder',
  'LabelBuilder',
] as const;

/** Enum containers whose members are component-value primitives. */
export const COMPONENT_ENUM_CONTAINERS = ['TextInputStyle'] as const;

/** discord.js command builder classes (exact names). */
export const COMMAND_OPTION_CLASSES = [
  'SlashCommandBuilder',
  'SlashCommandSubcommandBuilder',
  'SlashCommandSubcommandGroupBuilder',
  'ContextMenuCommandBuilder',
] as const;

/** Per-type command option builders (SlashCommandStringOption, …). */
export const COMMAND_OPTION_TYPE_CLASSES =
  /^SlashCommand(String|Integer|Number|Boolean|User|Channel|Role|Mentionable|Attachment)Option$/;

/** Command-builder chain methods (addStringOption, addSubcommand, …). */
export const COMMAND_OPTION_METHODS =
  /^add(String|Integer|Number|Boolean|User|Channel|Role|Mentionable|Attachment)Option$/;

/** Exact command-builder chain methods outside the per-type option family. */
export const COMMAND_CHAIN_METHODS = [
  'addSubcommand',
  'addSubcommandGroup',
  'setAutocomplete',
] as const;

/**
 * Authoritative message-payload option-key vocabulary for the
 * `message-options` category. Generic keys (name, value, label, inline,
 * text, emoji) deliberately stay OUT of it so `unclassified` keeps
 * flagging unknown shapes.
 */
export const MESSAGE_OPTION_KEYS = [
  'content',
  'embeds',
  'flags',
  'components',
  'allowedMentions',
  'files',
  'username',
  'avatarURL',
  'threadId',
  'tts',
  'nonce',
  'stickers',
  'poll',
  'reference',
  'enforceNonce',
  'suppressEmbeds',
] as const;

const ACK_METHOD_SET = new Set<string>(INTERACTION_ACK_METHODS);
const COMPONENT_CLASS_SET = new Set<string>(COMPONENT_CLASSES);
const COMPONENT_ENUM_SET = new Set<string>(COMPONENT_ENUM_CONTAINERS);
const COMMAND_OPTION_CLASS_SET = new Set<string>(COMMAND_OPTION_CLASSES);
const COMMAND_CHAIN_METHOD_SET = new Set<string>(COMMAND_CHAIN_METHODS);
const MESSAGE_BUILDER_CLASS_SET = new Set<string>(MESSAGE_BUILDER_CLASSES);
const MESSAGE_OPTION_KEY_SET = new Set<string>(MESSAGE_OPTION_KEYS);

function isCommandOptionClassName(name: string): boolean {
  return COMMAND_OPTION_CLASS_SET.has(name) || COMMAND_OPTION_TYPE_CLASSES.test(name);
}

function isCommandOptionMethodName(name: string): boolean {
  return COMMAND_OPTION_METHODS.test(name) || COMMAND_CHAIN_METHOD_SET.has(name);
}

/**
 * Route a class name to its builder-family category: message-composition
 * builders first, then command option builders, then component builders.
 * Returns undefined when the name belongs to no builder table.
 */
function builderClassCategory(name: string): SurfaceCategory | undefined {
  if (MESSAGE_BUILDER_CLASS_SET.has(name)) return 'message-builders';
  if (isCommandOptionClassName(name)) return 'command-options';
  if (COMPONENT_CLASS_SET.has(name)) return 'components';
  return undefined;
}

function classifyEnumMember(containerName: string | undefined): SurfaceCategory {
  if (containerName === 'Events') return 'gateway-events';
  if (containerName === 'MessageFlags') return 'flags';
  if (containerName !== undefined && COMPONENT_ENUM_SET.has(containerName)) return 'components';
  return 'discord-enums';
}

/**
 * Construction route: message-composition builders, then the component and
 * command-option builder families. The three class tables are disjoint, so
 * the shared builder chain routes identically to a per-kind chain.
 */
function classifyConstruction(symbolName: string): SurfaceCategory {
  return builderClassCategory(symbolName) ?? 'unclassified';
}

/**
 * Option-key route by precedence: a Webhook receiver (or a createWebhook
 * call) stays `webhook-options`; any other builder receiver follows its builder class
 * (`message-builders` / `command-options` / `components`); then the
 * MESSAGE_OPTION_KEYS vocabulary routes to `message-options`; only the
 * remainder falls to `unclassified`.
 */
function classifyOptionKey(hit: ClassifiableHit): SurfaceCategory {
  // createWebhook's receiver is a channel/guild, not a Webhook, but its
  // options (name, avatar, reason) define the webhook itself.
  if (hit.receiverTypeName === 'Webhook' || hit.callName === 'createWebhook') {
    return 'webhook-options';
  }
  if (hit.receiverTypeName !== undefined) {
    const builderCategory = builderClassCategory(hit.receiverTypeName);
    if (builderCategory !== undefined) return builderCategory;
  }
  if (MESSAGE_OPTION_KEY_SET.has(hit.symbolName)) return 'message-options';
  return 'unclassified';
}

/**
 * Call / property-access route: interaction acks first, then the
 * command-option method and class names, then the builder-class tables
 * (message-composition builders included), falling through to
 * `client-methods`, the open-ended remainder of the discord.js API.
 */
function classifyMemberAccess(symbolName: string): SurfaceCategory {
  if (ACK_METHOD_SET.has(symbolName)) return 'interaction-acks';
  if (isCommandOptionMethodName(symbolName)) return 'command-options';
  const builderCategory = builderClassCategory(symbolName);
  if (builderCategory !== undefined) return builderCategory;
  return 'client-methods';
}

/**
 * Classify one resolved hit. The branch order encodes precedence: enum
 * membership wins over everything (an enum member named like a method is
 * still an enum member; anything its container has no table for lands in
 * `discord-enums`, the default route that keeps a new enum visible), then
 * construction, then object-literal keys, then calls and plain property
 * accesses.
 */
export function classify(hit: ClassifiableHit): SurfaceCategory {
  if (hit.kind === 'enum-member') return classifyEnumMember(hit.containerName);
  if (hit.kind === 'new') return classifyConstruction(hit.symbolName);
  if (hit.kind === 'option-key') return classifyOptionKey(hit);
  return classifyMemberAccess(hit.symbolName);
}

/**
 * Deterministic inventory sort order: category, then file, then symbol
 * (plain string comparison). Shared by the analyzer's aggregation and the
 * snapshot pair so both produce byte-identical ordering.
 */
export function compareSurfaceEntries(a: SurfaceEntry, b: SurfaceEntry): number {
  if (a.category !== b.category) return a.category < b.category ? -1 : 1;
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  if (a.symbol !== b.symbol) return a.symbol < b.symbol ? -1 : 1;
  return 0;
}
