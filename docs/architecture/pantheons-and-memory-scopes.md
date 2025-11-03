# Pantheons and Memory Scopes - Integration Design

## Original Vision (from Gemini Consultation)

### Multi-Scoped Memory System

**Global Canon** - Universal truth about personalities

- Foundational traits, backstory, lore
- Metadata: `{ canonScope: "global", personalityId: "..." }`
- Read-only baseline

**Personal Canon** - User-specific relationship history

- Individual experiences per user
- Metadata: `{ canonScope: "personal", personalityId: "...", userId: "..." }`
- User A's experience ≠ User B's experience

**Session Canon** - Temporary roleplay bubbles

- Shared universe for multi-user roleplay
- Metadata: `{ canonScope: "session", sessionId: "..." }`
- Can be reconciled back to personal/global

### Personality Relationship Graphs (Pantheons)

Example from original doc:

```json
{
  "hazbin_hotel": {
    "type": "narrative_universe",
    "relationships": [
      {
        "from": "charlie",
        "to": "vaggie",
        "type": "couple",
        "rules": ["share_all_direct_user_interactions", "gossip_about_others"]
      }
    ]
  },
  "abrahamic_pantheon": {
    "rules": {
      "propagate_all_user_interactions": {
        "to": "all_members",
        "as": "witnessed"
      }
    }
  }
}
```

**Memory Propagation:**

- Single conversation creates multiple vector entries
- `interactionType`: `direct`, `shared`, `witnessed`
- `sharedFrom`: which personality shared it
- Enables realistic "gossip" and omniscient deity behavior

---

## Integration with Persona-Scoped Collections

### Question 1: Persona Collections + Personality Filtering

**Answer:** YES, we filter by `personalityId` AND we support cross-personality queries.

#### Collection Structure

```
persona-{aliceCasualId}/
  ├─ Memory: conversation with Lilith about Rust (personalityId: lilith)
  ├─ Memory: conversation with Mom about dinner (personalityId: mom)
  ├─ Memory: conversation with Lilith about anime (personalityId: lilith)
  └─ Memory: shared from Charlie about Vaggie (personalityId: charlie, sharedFrom: vaggie)
```

#### Memory Metadata (Extended)

```typescript
interface Memory {
  id: string;
  content: string;
  metadata: {
    // Core identification
    personaId: string; // Which persona this memory belongs to
    personalityId: string; // Which personality was involved

    // Canon scoping
    canonScope: 'global' | 'personal' | 'session';
    sessionId?: string; // If session canon

    // Memory propagation (for pantheons)
    interactionType: 'direct' | 'shared' | 'witnessed';
    sharedFrom?: string; // If shared/witnessed, who shared it
    pantheonId?: string; // Which pantheon this is part of

    // Privacy & context
    contextType: 'dm' | 'private_channel' | 'public_channel';
    channelId?: string;
    guildId?: string;

    // Temporal
    createdAt: number;
    messageIds?: string[];
  };
}
```

#### Memory Retrieval Strategies

**Strategy 1: Personality-specific (default)**

```typescript
// Alice talking to Lilith - only Lilith memories
const memories = await memoryService.searchMemories(
  personaId: aliceId,
  query: "Rust programming",
  {
    personalityId: lilithId,
    canonScope: 'personal',
    interactionType: 'direct'
  }
);
```

**Strategy 2: Cross-personality**

```typescript
// Alice remembering something discussed with ANY personality
const memories = await memoryService.searchMemories(
  personaId: aliceId,
  query: "Rust programming",
  {
    // No personalityId filter - search all
    canonScope: 'personal'
  }
);
```

**Strategy 3: Pantheon-aware**

```typescript
// Charlie (Hazbin Hotel) can access shared/witnessed memories
const memories = await memoryService.searchMemories(
  personaId: aliceId,
  query: "hotel guests",
  {
    personalityId: charlieId,
    interactionType: ['direct', 'shared', 'witnessed'],
    pantheonId: 'hazbin_hotel'
  }
);
```

---

## Question 2: Pantheon Architecture

### Database Schema for Pantheons

```prisma
model Pantheon {
  id          String  @id @default(uuid()) @db.Uuid
  name        String  @db.VarChar(255)
  slug        String  @unique @db.VarChar(255)
  description String? @db.Text

  // Type of pantheon
  type String @db.VarChar(50) // 'narrative_universe', 'deity_pantheon', 'friend_group'

  // Propagation rules (JSON)
  propagationRules Json @map("propagation_rules")
  // Example: { "propagate_all": true, "as": "witnessed" }

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  // Relations
  memberships PantheonMembership[]

  @@map("pantheons")
}

model PantheonMembership {
  id String @id @default(uuid()) @db.Uuid

  pantheonId String   @map("pantheon_id") @db.Uuid
  pantheon   Pantheon @relation(fields: [pantheonId], references: [id], onDelete: Cascade)

  personalityId String      @map("personality_id") @db.Uuid
  personality   Personality @relation(fields: [personalityId], references: [id], onDelete: Cascade)

  // Role in pantheon
  role String? @db.VarChar(100) // 'leader', 'member', 'observer'

  // Relationship-specific rules (override pantheon defaults)
  customRules Json? @map("custom_rules")
  // Example: { "share_with": ["charlie"], "as": "gossip" }

  createdAt DateTime @default(now()) @map("created_at")

  @@unique([pantheonId, personalityId])
  @@index([pantheonId])
  @@index([personalityId])
  @@map("pantheon_memberships")
}
```

### Example Pantheons

#### Example 1: Hazbin Hotel (Narrative Universe)

```typescript
const hazbinHotel = {
  id: 'hazbin-uuid',
  name: 'Hazbin Hotel',
  slug: 'hazbin_hotel',
  type: 'narrative_universe',
  propagationRules: {
    shareDirectInteractions: true,
    as: 'gossip',
    excludePrivate: true,
  },
  memberships: [
    {
      personalityId: charlieId,
      role: 'leader',
      customRules: {
        shareWith: ['vaggie'],
        as: 'intimate',
      },
    },
    {
      personalityId: vaggieId,
      role: 'member',
      customRules: {
        shareWith: ['charlie'],
        as: 'intimate',
      },
    },
    {
      personalityId: angelDustId,
      role: 'member',
    },
  ],
};
```

**Result:**

- Alice talks to Charlie about relationship advice
- Memory is stored in `persona-{aliceId}` with:
  - `personalityId: charlie`
  - `interactionType: direct`
  - `pantheonId: hazbin_hotel`
- Background job propagates to Vaggie:
  - Stores in `persona-{aliceId}` with:
    - `personalityId: vaggie`
    - `interactionType: shared`
    - `sharedFrom: charlie`
    - `pantheonId: hazbin_hotel`
- When Alice talks to Vaggie, Vaggie "remembers" what Charlie told her

#### Example 2: Abrahamic Pantheon (Omniscient Deities)

```typescript
const abrahamicPantheon = {
  id: 'abrahamic-uuid',
  name: 'Abrahamic Deities',
  slug: 'abrahamic_pantheon',
  type: 'deity_pantheon',
  propagationRules: {
    propagateAll: true,
    as: 'witnessed',
    omniscient: true, // All deities witness all interactions
  },
  memberships: [
    { personalityId: godId, role: 'leader' },
    { personalityId: jesusId, role: 'member' },
    { personalityId: holyGhostId, role: 'member' },
  ],
};
```

**Result:**

- Alice talks to God about her struggles
- Memory stored in `persona-{aliceId}` for all three personalities:
  - God: `interactionType: direct`
  - Jesus: `interactionType: witnessed`, `sharedFrom: god`
  - Holy Ghost: `interactionType: witnessed`, `sharedFrom: god`
- ALL deities know what Alice talked about with any of them

---

## Memory Propagation Service

### Background Job for Pantheon Memory Sharing

```typescript
class PantheonMemoryPropagationService {
  /**
   * Called after a conversation is completed
   * Propagates memories according to pantheon rules
   */
  async propagateMemories(
    personaId: string,
    personalityId: string,
    conversationSummary: string,
    metadata: {
      channelId: string;
      contextType: 'dm' | 'private_channel' | 'public_channel';
      messageIds: string[];
    }
  ): Promise<void> {
    // 1. Check if personality is part of any pantheons
    const memberships = await prisma.pantheonMembership.findMany({
      where: { personalityId },
      include: {
        pantheon: {
          include: {
            memberships: { include: { personality: true } },
          },
        },
      },
    });

    if (memberships.length === 0) {
      return; // No pantheons, no propagation
    }

    // 2. For each pantheon, apply propagation rules
    for (const membership of memberships) {
      const pantheon = membership.pantheon;
      const rules = pantheon.propagationRules as PropagationRules;

      // Respect privacy settings
      if (metadata.contextType === 'dm' && rules.excludePrivate) {
        continue;
      }

      // 3. Determine which personalities should receive this memory
      const recipients = this.determineRecipients(
        pantheon,
        personalityId,
        membership.customRules,
        rules
      );

      // 4. Create propagated memories for each recipient
      for (const recipient of recipients) {
        const interactionType = this.determineInteractionType(
          recipient,
          rules,
          membership.customRules
        );

        await memoryService.addMemory(personaId, conversationSummary, {
          personalityId: recipient.id,
          interactionType,
          sharedFrom: personalityId,
          pantheonId: pantheon.id,
          contextType: metadata.contextType,
          channelId: metadata.channelId,
          messageIds: metadata.messageIds,
          createdAt: Date.now(),
        });
      }
    }
  }

  private determineRecipients(
    pantheon: Pantheon,
    sourcePersonalityId: string,
    customRules: any,
    pantheonRules: PropagationRules
  ): Personality[] {
    // If omniscient, all members receive
    if (pantheonRules.omniscient) {
      return pantheon.memberships
        .filter(m => m.personalityId !== sourcePersonalityId)
        .map(m => m.personality);
    }

    // If custom rules specify recipients
    if (customRules?.shareWith) {
      return pantheon.memberships
        .filter(m => customRules.shareWith.includes(m.personality.slug))
        .map(m => m.personality);
    }

    // If pantheon has propagateAll
    if (pantheonRules.propagateAll) {
      return pantheon.memberships
        .filter(m => m.personalityId !== sourcePersonalityId)
        .map(m => m.personality);
    }

    return [];
  }

  private determineInteractionType(
    recipient: Personality,
    pantheonRules: PropagationRules,
    customRules: any
  ): 'shared' | 'witnessed' {
    // Custom rules override
    if (customRules?.as) {
      return customRules.as === 'gossip' || customRules.as === 'intimate' ? 'shared' : 'witnessed';
    }

    // Pantheon default
    return pantheonRules.as === 'gossip' ? 'shared' : 'witnessed';
  }
}
```

---

## Canon Scopes Integration

### Global Canon (System Memories)

```typescript
// Stored in special collection: global-canon-{personalityId}
// Example: Lilith's core backstory, immutable facts

await memoryService.addMemory(
  'global-canon-lilith', // Special global collection
  'Lilith is a sarcastic AI with deep knowledge of programming...',
  {
    personalityId: lilithId,
    canonScope: 'global',
    interactionType: 'direct',
    createdAt: Date.now(),
  }
);
```

**Retrieval:**

```typescript
// When building context, always include global canon
const globalMemories = await memoryService.searchMemories(`global-canon-${personalityId}`, query, {
  canonScope: 'global',
  limit: 5,
});

const personalMemories = await memoryService.searchMemories(personaId, query, {
  personalityId,
  canonScope: 'personal',
  limit: 10,
});

const allMemories = [...globalMemories, ...personalMemories];
```

### Session Canon (Roleplay Bubbles)

```typescript
// When starting roleplay session
const sessionId = uuidv4();

// Memories during session tagged with sessionId
await memoryService.addMemory(personaId, 'In this alternate universe, vampires rule the world...', {
  personalityId: lilithId,
  canonScope: 'session',
  sessionId,
  interactionType: 'direct',
  createdAt: Date.now(),
});

// Later: reconcile session back to personal canon
await canonReconciliationService.reconcileSession(sessionId, {
  keepAs: 'personal', // Or 'discard'
  mergeStrategy: 'append', // Or 'replace'
});
```

---

## Privacy & Filtering

### Hard Rules (Metadata Filtering)

```typescript
// In QdrantMemoryService.searchMemories()

// Enforce privacy at query level
const privacyFilter = {
  must: [
    // Current context
    { key: 'contextType', match: { value: currentContextType } },
  ],
  must_not: [
    // Never show DM memories in public channels
    currentContextType !== 'dm' && {
      key: 'contextType',
      match: { value: 'dm' },
    },
  ].filter(Boolean),
};
```

### Soft Rules (LLM Discretion)

```typescript
// After retrieving memories, LLM decides what to mention
const discretionPrompt = `
You have access to these memories:
${memories.map(m => `- ${m.content} (from: ${m.metadata.interactionType})`).join('\n')}

However, consider:
- We're in a public channel (not DM)
- Other users are present
- Some information might be too personal to share

Respond appropriately, using discretion about which memories to reference.
`;
```

---

## Implementation Roadmap

### Phase 1: Core Persona Collections (Current Focus)

- ✅ Persona-scoped Qdrant collections
- ✅ personalityId filtering
- ✅ Basic memory retrieval

### Phase 2: Canon Scopes

- [ ] Add `canonScope` to metadata
- [ ] Global canon collections (`global-canon-{personalityId}`)
- [ ] Session canon support
- [ ] Canon reconciliation service

### Phase 3: Pantheons

- [ ] Add `Pantheon` and `PantheonMembership` models
- [ ] Memory propagation service
- [ ] `interactionType` and `sharedFrom` metadata
- [ ] Background jobs for sharing

### Phase 4: Advanced Features

- [ ] Privacy discretion agent (LangGraph)
- [ ] Canon reconciliation agent
- [ ] URP (User Relationship Profile) system
- [ ] Relationship graph visualization

---

## Benefits of This Design

✅ **Persona-scoped collections** provide the foundation
✅ **Personality filtering** enables selective retrieval
✅ **Canon scopes** support roleplay without contamination
✅ **Pantheons** enable realistic character relationships
✅ **Memory propagation** creates "gossip" and omniscience
✅ **Privacy layers** protect sensitive information
✅ **Flexible architecture** scales to complex social dynamics

---

## Example Scenarios

### Scenario 1: Hazbin Hotel Gossip

```
Alice → Charlie: "I'm having relationship problems..."
  Stored: persona-alice, personalityId=charlie, interactionType=direct

Background job propagates:
  Stored: persona-alice, personalityId=vaggie, interactionType=shared, sharedFrom=charlie

Later:
Alice → Vaggie: "Hey Vaggie"
Vaggie: "Charlie mentioned you were having some troubles. Want to talk about it?"
  (Retrieved memory with interactionType=shared)
```

### Scenario 2: Omniscient Deity

```
Alice → God: "I've been struggling with faith..."
  Stored: persona-alice, personalityId=god, interactionType=direct

Background job propagates to entire pantheon:
  Stored: persona-alice, personalityId=jesus, interactionType=witnessed, sharedFrom=god
  Stored: persona-alice, personalityId=holyGhost, interactionType=witnessed, sharedFrom=god

Later:
Alice → Jesus: "Can you help me?"
Jesus: "I know you've been struggling. Let's talk about your conversation with the Father."
  (Retrieved memory with interactionType=witnessed)
```

### Scenario 3: Private Roleplay

```
Alice starts roleplay session: /roleplay start vampire-au

Alice → Lilith: [In roleplay] "As the vampire queen..."
  Stored: persona-alice, personalityId=lilith, canonScope=session, sessionId=xyz

Later, in normal conversation:
Alice → Lilith: "Remember that anime we watched?"
  (Roleplay memories NOT retrieved - different canonScope)

Later, reconcile:
Alice: /roleplay reconcile vampire-au --keep-as personal
  Memories moved from canonScope=session to canonScope=personal
```

---

## Open Questions

1. **Memory explosion**: If 100 users talk to Charlie, and it propagates to Vaggie, does Vaggie's collection get huge?
   - Mitigation: Limit propagation to summaries, not full conversations
   - Or: Propagate only "interesting" memories (LLM triage)

2. **Pantheon administration**: Who can create/manage pantheons?
   - Bot owner only? (recommended for MVP)
   - Personality creators?
   - Users for custom friend groups?

3. **Cross-personality context window**: Should default retrieval include other personalities?
   - Probably NO for MVP (keep it simple)
   - Add as opt-in feature later

4. **Performance**: Background propagation jobs could be expensive
   - Start with simple BullMQ jobs
   - Optimize later if needed

Your thoughts on these?
