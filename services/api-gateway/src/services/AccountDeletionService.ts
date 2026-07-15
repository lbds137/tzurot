/**
 * AccountDeletionService
 *
 * Full-account erasure (the privacy policy's delete-everything right) and
 * its preview. The FK graph does almost all the work: a single
 * `user.delete()` cascades personas → conversation history/memories/facts,
 * owned personalities → their history/memories/facts/aliases/settings, and
 * every user-FK table (keys, credentials, jobs, feedback, deliveries,
 * mappings). The service adds the sweeps the graph can't express:
 *
 *   - facts ABOUT the user living under other personas' scopes, matched
 *     case-insensitively by entity tag (model-produced free text)
 *   - pending_memories (loose refs, no FK) in both arms: the user's
 *     personas AND their owned personalities
 *   - llm_diagnostic_logs keyed by the loose Discord-ID string
 *
 * Owned characters are deleted for EVERYONE (owner-decided; the preview
 * carries the per-character cross-user blast radius so the client can warn).
 * Everything runs in ONE transaction with constraints deferred, so a
 * mid-flight failure leaves the account fully intact.
 */

import {
  ACCOUNT_DELETE_CONFIRMATION_PHRASE,
  type OwnedCharacterImpactSchema,
} from '@tzurot/common-types/schemas/api/account';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { z } from 'zod';

const logger = createLogger('AccountDeletionService');

/** The cascade is a single statement, but the pre-sweeps and counts make the
 *  transaction non-trivial; Prisma's 5s default has no headroom. */
const DELETION_TX_TIMEOUT_MS = 60_000;

type OwnedCharacterImpact = z.infer<typeof OwnedCharacterImpactSchema>;

export interface AccountDeletePreview {
  confirmationPhrase: typeof ACCOUNT_DELETE_CONFIRMATION_PHRASE;
  ownedCharacters: OwnedCharacterImpact[];
  counts: {
    personas: number;
    characters: number;
    conversationMessages: number;
    memories: number;
    facts: number;
  };
  hasActiveExport: boolean;
}

export interface AccountDeletionSummary {
  personas: number;
  characters: number;
  conversationMessages: number;
  memories: number;
  facts: number;
  /** Tag-sweep removals across ALL scopes (overlaps `facts` where a fact is
   *  both persona-scoped and tagged; the sweep runs first). */
  factsSweptByTag: number;
  pendingMemories: number;
  diagnosticLogs: number;
  characterNames: string[];
  /** Post-transaction cleanup inputs for the route — never serialized out. */
  characterSlugs: string[];
  characterIds: string[];
}

/** Thrown when a deletion reaches the service for a superuser account —
 *  the route pre-checks and 403s, this is the defense-in-depth backstop. */
export class SuperuserDeletionError extends Error {
  constructor() {
    super('Superuser accounts cannot be deleted (they own the global characters)');
    this.name = 'SuperuserDeletionError';
  }
}

/** Rows that die with the account: the user's own persona-scoped rows PLUS
 *  every row scoped to a personality the user owns (deleted for everyone). */
function blastRadiusFilter(
  personaIds: string[],
  ownedPersonalityIds: string[]
): { OR: [{ personaId: { in: string[] } }, { personalityId: { in: string[] } }] } {
  return {
    OR: [{ personaId: { in: personaIds } }, { personalityId: { in: ownedPersonalityIds } }],
  };
}

/**
 * Case-insensitive `user:` tag vocabulary: username + persona names +
 * preferred names. entityTags are model-produced free text with no
 * normalization, so the sweep lowercases both sides.
 */
function buildTagVocabulary(
  username: string,
  personas: { name: string; preferredName: string | null }[]
): string[] {
  const names = new Set<string>();
  names.add(username.toLowerCase());
  for (const persona of personas) {
    names.add(persona.name.toLowerCase());
    if (persona.preferredName !== null && persona.preferredName !== '') {
      names.add(persona.preferredName.toLowerCase());
    }
  }
  return [...names].map(name => `user:${name}`);
}

export class AccountDeletionService {
  constructor(private readonly prisma: PrismaClient) {}

  /** Distinct OTHER users holding memories with each owned character. */
  private async fetchOtherUserReach(
    userId: string,
    ownedIds: string[]
  ): Promise<Map<string, number>> {
    if (ownedIds.length === 0) {
      return new Map();
    }
    const rows = await this.prisma.$queryRaw<{ personalityId: string; otherUsers: number }[]>`
      SELECT m.personality_id AS "personalityId",
             COUNT(DISTINCT p.owner_id)::int AS "otherUsers"
      FROM memories m
      JOIN personas p ON m.persona_id = p.id
      WHERE m.personality_id = ANY(${ownedIds}::uuid[])
        AND p.owner_id != ${userId}::uuid
      GROUP BY m.personality_id
    `;
    return new Map(rows.map(row => [row.personalityId, row.otherUsers]));
  }

  async preview(userId: string): Promise<AccountDeletePreview> {
    // Intentionally unbounded (exception to the bounded-findMany rule): the
    // deletion scope must cover the COMPLETE owned set — a paginated page
    // here would silently leave orphans outside the sweep filters.
    const personas = await this.prisma.persona.findMany({
      where: { ownerId: userId },
      select: { id: true },
    });
    const ownedCharacters = await this.prisma.personality.findMany({
      where: { ownerId: userId },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    const personaIds = personas.map(persona => persona.id);
    const ownedIds = ownedCharacters.map(character => character.id);
    const scope = blastRadiusFilter(personaIds, ownedIds);

    const [conversationMessages, memories, facts, activeExport, reach] = await Promise.all([
      this.prisma.conversationHistory.count({ where: scope }),
      this.prisma.memory.count({ where: scope }),
      this.prisma.memoryFact.count({ where: scope }),
      this.prisma.exportJob.findFirst({
        where: { userId, status: { in: ['pending', 'in_progress'] } },
        select: { id: true },
      }),
      this.fetchOtherUserReach(userId, ownedIds),
    ]);

    return {
      confirmationPhrase: ACCOUNT_DELETE_CONFIRMATION_PHRASE,
      ownedCharacters: ownedCharacters.map(character => ({
        id: character.id,
        name: character.name,
        otherUsersWithMemories: reach.get(character.id) ?? 0,
      })),
      counts: {
        personas: personaIds.length,
        characters: ownedIds.length,
        conversationMessages,
        memories,
        facts,
      },
      hasActiveExport: activeExport !== null,
    };
  }

  async deleteAccount(userId: string, discordUserId: string): Promise<AccountDeletionSummary> {
    const summary = await this.prisma.$transaction(
      async tx => {
        await tx.$executeRaw`SET CONSTRAINTS ALL DEFERRED`;

        const user = await tx.user.findUniqueOrThrow({
          where: { id: userId },
          select: { username: true, isSuperuser: true },
        });
        if (user.isSuperuser) {
          throw new SuperuserDeletionError();
        }

        // Intentionally unbounded (exception to the bounded-findMany rule):
        // the cascade scope, tag vocabulary, and pending-memories arms all
        // require the COMPLETE owned set — a partial page would orphan rows.
        const personas = await tx.persona.findMany({
          where: { ownerId: userId },
          select: { id: true, name: true, preferredName: true },
        });
        const ownedCharacters = await tx.personality.findMany({
          where: { ownerId: userId },
          select: { id: true, name: true, slug: true },
        });
        const personaIds = personas.map(persona => persona.id);
        const ownedIds = ownedCharacters.map(character => character.id);
        const scope = blastRadiusFilter(personaIds, ownedIds);

        const [conversationMessages, memories, facts] = await Promise.all([
          tx.conversationHistory.count({ where: scope }),
          tx.memory.count({ where: scope }),
          tx.memoryFact.count({ where: scope }),
        ]);

        // Facts ABOUT the user under any scope (other personas, other owners'
        // characters, NULL-persona world facts). Case-insensitive because the
        // tags are model-produced free text. Accepted tradeoff: an unrelated
        // user literally sharing a swept name loses those facts too.
        const tagList = buildTagVocabulary(user.username, personas);
        const factsSweptByTag = await tx.$executeRaw`
          DELETE FROM memory_facts f
          WHERE EXISTS (
            SELECT 1 FROM unnest(f.entity_tags) AS t(tag)
            WHERE lower(t.tag) = ANY(${tagList}::text[])
          )
        `;

        // NULL-persona memories: nothing writes them today (pools are a
        // future phase that must define its own erasure semantics before
        // shipping); no sweep needed here.

        // pending_memories has loose refs with no user FK — both arms, so no
        // orphaned rows survive against the user's personas OR dead characters.
        const pendingMemories = await tx.pendingMemory.deleteMany({ where: scope });

        // Diagnostic logs key on the loose Discord-ID string, not the user FK.
        const diagnosticLogs = await tx.llmDiagnosticLog.deleteMany({
          where: { userId: discordUserId },
        });

        // Everything else is one cascade.
        await tx.user.delete({ where: { id: userId } });

        return {
          personas: personaIds.length,
          characters: ownedIds.length,
          conversationMessages,
          memories,
          facts,
          factsSweptByTag,
          pendingMemories: pendingMemories.count,
          diagnosticLogs: diagnosticLogs.count,
          characterNames: ownedCharacters.map(character => character.name),
          characterSlugs: ownedCharacters.map(character => character.slug),
          characterIds: ownedIds,
        };
      },
      { timeout: DELETION_TX_TIMEOUT_MS }
    );

    logger.warn(
      {
        discordUserId,
        personas: summary.personas,
        characters: summary.characters,
        conversationMessages: summary.conversationMessages,
        memories: summary.memories,
        facts: summary.facts,
        factsSweptByTag: summary.factsSweptByTag,
        pendingMemories: summary.pendingMemories,
        diagnosticLogs: summary.diagnosticLogs,
      },
      'ACCOUNT DELETED'
    );

    return summary;
  }
}
