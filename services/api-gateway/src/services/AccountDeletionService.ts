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
import { type Prisma, type PrismaClient } from '@tzurot/common-types/services/prisma';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { z } from 'zod';
import { ensureOrphanSentinel } from './OrphanSentinelBootstrap.js';
import { countCrossUserReach } from './retention/crossUserReach.js';
import { isStillEligibleForPurge } from './retention/eligibility.js';
import { recordPurgeSuccess } from './retention/purgeAudit.js';
import { reHomeCrossUserCharacters } from './retention/reHome.js';

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
  /** Characters re-homed to the orphan sentinel instead of deleted (retention
   *  mode only; always 0 for self-serve, which deletes owned characters). */
  charactersReHomed: number;
  /** Post-transaction cleanup inputs for the route — never serialized out. */
  characterSlugs: string[];
  characterIds: string[];
  /** The `retention_purge_log` row this erasure wrote, so the caller can settle
   *  its off-DB reconciliation status. Null for self-serve, which is not audited
   *  through the retention ledger (the user asked for it; there is no cohort). */
  auditLogId: string | null;
}

/** Thrown when a deletion reaches the service for a superuser account —
 *  the route pre-checks and 403s, this is the defense-in-depth backstop. */
export class SuperuserDeletionError extends Error {
  constructor() {
    super('Superuser accounts cannot be deleted (they own the global characters)');
    this.name = 'SuperuserDeletionError';
  }
}

/**
 * Thrown INSIDE the erasure transaction when a retention target no longer
 * satisfies the eligibility predicate (D4's TOCTOU close) — they became active
 * between the preview that selected them and this purge. Throwing is what rolls
 * the transaction back; the caller translates it into a skip, not an error.
 */
export class RetentionIneligibleError extends Error {
  constructor() {
    super('User is no longer purge-eligible (activity since the cohort was selected)');
    this.name = 'RetentionIneligibleError';
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

/**
 * Delete the rows the FK graph can't reach: the three no-FK tables that would
 * otherwise silently orphan. Runs BEFORE the cascade, inside the same
 * transaction, so a mid-flight failure leaves the account fully intact.
 */
async function sweepLooseRefs(
  tx: Prisma.TransactionClient,
  args: {
    username: string;
    personas: { name: string; preferredName: string | null }[];
    scope: ReturnType<typeof blastRadiusFilter>;
    discordUserId: string;
  }
): Promise<{ factsSweptByTag: number; pendingMemories: number; diagnosticLogs: number }> {
  const { username, personas, scope, discordUserId } = args;

  // Facts ABOUT the user under any scope (other personas, other owners'
  // characters, NULL-persona world facts). Case-insensitive because the
  // tags are model-produced free text. Accepted tradeoff: an unrelated
  // user literally sharing a swept name loses those facts too.
  const tagList = buildTagVocabulary(username, personas);
  const factsSweptByTag = await tx.$executeRaw`
    DELETE FROM memory_facts f
    WHERE EXISTS (
      SELECT 1 FROM unnest(f.entity_tags) AS t(tag)
      WHERE lower(t.tag) = ANY(${tagList}::text[])
    )
  `;

  // NULL-persona memories: nothing writes them today (pools are a future phase
  // that must define its own erasure semantics before shipping); no sweep here.

  // pending_memories has loose refs with no user FK — both arms, so no
  // orphaned rows survive against the user's personas OR dead characters.
  const pendingMemories = await tx.pendingMemory.deleteMany({ where: scope });

  // Diagnostic logs key on the loose Discord-ID string, not the user FK.
  const diagnosticLogs = await tx.llmDiagnosticLog.deleteMany({
    where: { userId: discordUserId },
  });

  return {
    factsSweptByTag,
    pendingMemories: pendingMemories.count,
    diagnosticLogs: diagnosticLogs.count,
  };
}

export class AccountDeletionService {
  constructor(private readonly prisma: PrismaClient) {}

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
      // The retention module's single reach definition — the warning shown
      // here and the purge's re-home decision must agree on what "shared"
      // means (memories ∪ history ∪ facts ∪ explicit grants).
      countCrossUserReach(this.prisma, userId, ownedIds),
    ]);

    return {
      confirmationPhrase: ACCOUNT_DELETE_CONFIRMATION_PHRASE,
      ownedCharacters: ownedCharacters.map(character => ({
        id: character.id,
        name: character.name,
        otherUsersWithData: reach.get(character.id) ?? 0,
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
    mode: AccountDeletionMode,
    runContext: string | null = null
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

        // TOCTOU close (D4): the cohort was selected earlier, so re-evaluate
        // eligibility HERE, inside the transaction — a user who became active
        // in between has cleared their unreachable flag or bumped
        // last_active_at, and erasing them would delete a live account. The
        // throw is what rolls this transaction back.
        if (mode === 'retention' && !(await isStillEligibleForPurge(tx, userId))) {
          throw new RetentionIneligibleError();
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

        // Retention: characters other users actively use are re-homed to the
        // sentinel (surviving the cascade) rather than deleted. Only the rest
        // ('deletedCharacters') die with the account, and only THEIR
        // personality-scoped rows enter the sweep scope — a re-homed survivor's
        // other-user data is never touched (D11).
        const { deletedCharacters, charactersReHomed } =
          mode === 'retention' && sentinelId !== null
            ? await reHomeCrossUserCharacters(tx, {
                userId,
                discordUserId,
                sentinelId,
                ownedCharacters,
              })
            : { deletedCharacters: ownedCharacters, charactersReHomed: 0 };
        const deletedIds = deletedCharacters.map(character => character.id);
        const scope = blastRadiusFilter(personaIds, deletedIds);

        const [conversationMessages, memories, facts] = await Promise.all([
          tx.conversationHistory.count({ where: scope }),
          tx.memory.count({ where: scope }),
          tx.memoryFact.count({ where: scope }),
        ]);

        const swept = await sweepLooseRefs(tx, {
          username: user.username,
          personas,
          scope,
          discordUserId,
        });

        // Everything else is one cascade.
        await tx.user.delete({ where: { id: userId } });

        const characterSlugs = deletedCharacters.map(character => character.slug);
        const counts = {
          personas: personaIds.length,
          characters: deletedIds.length,
          conversationMessages,
          memories,
          facts,
          ...swept,
          charactersReHomed,
        };

        // Audit row inside the transaction (D14): written after the cascade so
        // it records real counts, and INSIDE so a process death between commit
        // and log-write cannot produce a purged account with no ledger entry.
        // `retention_purge_log` has no FK to users, so it survives the cascade.
        const auditLogId =
          mode === 'retention'
            ? await recordPurgeSuccess(tx, {
                targetDiscordId: discordUserId,
                runContext,
                deletionCounts: counts,
                offDbPending: { characterSlugs },
              })
            : null;

        return {
          ...counts,
          characterNames: deletedCharacters.map(character => character.name),
          characterSlugs,
          characterIds: deletedIds,
          auditLogId,
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
