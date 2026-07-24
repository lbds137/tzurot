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
import { type PrismaClient, type Prisma } from '@tzurot/common-types/services/prisma';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { z } from 'zod';
import { ensureOrphanSentinel } from './OrphanSentinelBootstrap.js';

const logger = createLogger('AccountDeletionService');

/** The cascade is a single statement, but the pre-sweeps and counts make the
 *  transaction non-trivial; Prisma's 5s default has no headroom. */
const DELETION_TX_TIMEOUT_MS = 60_000;

type OwnedCharacterImpact = z.infer<typeof OwnedCharacterImpactSchema>;

/**
 * Erasure mode. `self-serve` (the delete-my-account right) deletes owned
 * characters for EVERYONE. `retention` (the automated purge, Phase 2 D11)
 * re-homes cross-user characters to the Orphaned-Characters sentinel instead,
 * so a departed user's characters aren't deleted out from under active users.
 */
export type AccountDeletionMode = 'self-serve' | 'retention';

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

  /**
   * Owned characters with CROSS-USER reach (Retention Phase 2, D11): another
   * user — a persona owner other than the departed one — has a memory,
   * conversation-history row, OR fact scoped to the character. These are the
   * characters a retention purge re-homes to the sentinel instead of deleting,
   * so the other users keep using them. Broadens `fetchOtherUserReach`'s
   * memories-only signal to all three personality-scoped tables (council). The
   * INNER JOINs drop world/orphan rows with a null `persona_id` — reach is
   * about another USER, not un-owned content. Returns the ids to re-home.
   */
  private async partitionOwnedByReach(
    tx: Prisma.TransactionClient,
    userId: string,
    ownedIds: string[]
  ): Promise<string[]> {
    const rows = await tx.$queryRaw<{ personalityId: string }[]>`
      SELECT DISTINCT reach.personality_id AS "personalityId"
      FROM (
        SELECT m.personality_id FROM memories m
          JOIN personas p ON m.persona_id = p.id
          WHERE m.personality_id = ANY(${ownedIds}::uuid[]) AND p.owner_id != ${userId}::uuid
        UNION ALL
        SELECT ch.personality_id FROM conversation_history ch
          JOIN personas p ON ch.persona_id = p.id
          WHERE ch.personality_id = ANY(${ownedIds}::uuid[]) AND p.owner_id != ${userId}::uuid
        UNION ALL
        SELECT f.personality_id FROM memory_facts f
          JOIN personas p ON f.persona_id = p.id
          WHERE f.personality_id = ANY(${ownedIds}::uuid[]) AND p.owner_id != ${userId}::uuid
      ) reach
    `;
    return rows.map(row => row.personalityId);
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

  async deleteAccount(
    userId: string,
    discordUserId: string,
    mode: AccountDeletionMode
  ): Promise<AccountDeletionSummary> {
    // Retention re-homes cross-user characters to the sentinel instead of
    // cascading them; ensure that holder row exists BEFORE the deletion tx (its
    // own circular-FK CTE must not nest inside the constraints-deferred tx).
    const sentinelId = mode === 'retention' ? await ensureOrphanSentinel(this.prisma) : null;

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

        // Retention: characters other users actively use are re-homed to the
        // sentinel (surviving the cascade) rather than deleted. Only the rest
        // ('deletedCharacters') die with the account, and only THEIR
        // personality-scoped rows enter the sweep scope — a re-homed survivor's
        // other-user data is never touched (D11).
        let deletedCharacters = ownedCharacters;
        if (mode === 'retention' && sentinelId !== null && ownedIds.length > 0) {
          const reHomeIds = await this.partitionOwnedByReach(tx, userId, ownedIds);
          if (reHomeIds.length > 0) {
            // Prisma client write (NOT raw SQL) so `@updatedAt` bumps: personalities
            // is a sync-tracked table and re-home is a SEMANTIC ownership change that
            // MUST win the dev<->prod last-write-wins sync (03-database § Sync-Tracked
            // Tables). Raw SQL skips the bump → a later sync could revert the re-home.
            // (The stamp columns use raw SQL for the OPPOSITE reason — to avoid
            // falsely winning LWW on a non-semantic write.)
            await tx.personality.updateMany({
              where: { id: { in: reHomeIds } },
              data: { ownerId: sentinelId, originalOwnerDiscordId: discordUserId },
            });
            // KNOWN LIMITATION (tracked in design D11): re-home repoints ownership
            // but grants the reach-holders no access. A PRIVATE re-homed character
            // becomes unreachable to them — canUserViewPersonality gates on
            // isPublic || owner || PersonalityOwner, all false for them post-purge.
            // The scoped-view fix needs a new permission primitive and must land
            // before the purge is activated. Inert today (nothing calls retention).
            const reHomeSet = new Set(reHomeIds);
            deletedCharacters = ownedCharacters.filter(character => !reHomeSet.has(character.id));
          }
        }
        const deletedIds = deletedCharacters.map(character => character.id);
        const scope = blastRadiusFilter(personaIds, deletedIds);

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
          characters: deletedIds.length,
          conversationMessages,
          memories,
          facts,
          factsSweptByTag,
          pendingMemories: pendingMemories.count,
          diagnosticLogs: diagnosticLogs.count,
          characterNames: deletedCharacters.map(character => character.name),
          characterSlugs: deletedCharacters.map(character => character.slug),
          characterIds: deletedIds,
        };
      },
      { timeout: DELETION_TX_TIMEOUT_MS }
    );

    logger.warn(
      {
        discordUserId,
        mode,
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
