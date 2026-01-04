# Group Conversation Design

## The Actual Requirement

The AI should:

- ✅ See the full channel conversation (multiple users)
- ✅ Know which user said each message
- ✅ Have context about ALL participating users' personas
- ✅ Respond appropriately to each user based on their persona

**Example:**

```
System: You're talking to:
- Alice (she/her, friendly artist who loves cats)
- Bob (he/him, sarcastic programmer who hates mornings)

Alice: Hey everyone! Look at this cat picture!
Bob: It's 6am, why are you so cheerful?
Assistant: [responds to Alice enthusiastically, teases Bob about being grumpy]
Alice: @Bob Coffee helps!
Bob: Coffee is a lie.
Assistant: [continues the group dynamic]
```

## Current Problem

**Conversation history is stored correctly** (has userId), but when we retrieve it:

1. ❌ Messages don't include user information
2. ❌ No persona context for any of the users
3. ❌ AI sees just text without knowing who said what

**Result**: AI treats it as one confused person having a conversation with themselves.

## Solution Architecture

### 1. Enhanced ConversationHistoryService

```typescript
interface ConversationMessageWithUser {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: Date;
  user?: {
    id: string;
    username: string;
    discordId: string;
    persona?: {
      name: string;
      preferredName?: string;
      pronouns?: string;
      content: string; // Backstory/description
    };
  };
}

async getRecentHistoryWithUsers(
  channelId: string,
  personalityId: string,
  limit: number = 20
): Promise<ConversationMessageWithUser[]> {
  const messages = await this.prisma.conversationHistory.findMany({
    where: {
      channelId,
      personalityId,
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      user: {
        include: {
          defaultPersona: true, // From new schema design
        },
      },
    },
  });

  return messages.reverse(); // Chronological order
}
```

### 2. Context Builder Service

```typescript
class ConversationContextBuilder {
  /**
   * Build context for group conversation
   * Includes:
   * - System message introducing all participating users
   * - Recent conversation history with user labels
   */
  async buildGroupContext(
    channelId: string,
    personalityId: string,
    systemPrompt: string,
    limit: number = 20
  ): Promise<ChatMessage[]> {
    // 1. Get recent history with user info
    const history = await conversationHistoryService.getRecentHistoryWithUsers(
      channelId,
      personalityId,
      limit
    );

    // 2. Extract unique participating users
    const participants = this.extractParticipants(history);

    // 3. Build system message with participants' personas
    const participantsContext = this.buildParticipantsContext(participants);

    // 4. Format conversation with user labels
    const formattedMessages = this.formatMessagesWithUsers(history);

    // 5. Combine into final context
    return [
      {
        role: 'system',
        content: `${systemPrompt}\n\n${participantsContext}`,
      },
      ...formattedMessages,
    ];
  }

  private extractParticipants(history: ConversationMessageWithUser[]): UserWithPersona[] {
    const userMap = new Map<string, UserWithPersona>();

    for (const msg of history) {
      if (msg.role === 'user' && msg.user) {
        userMap.set(msg.user.id, {
          id: msg.user.id,
          username: msg.user.username,
          discordId: msg.user.discordId,
          persona: msg.user.persona,
        });
      }
    }

    return Array.from(userMap.values());
  }

  private buildParticipantsContext(participants: UserWithPersona[]): string {
    if (participants.length === 0) {
      return '';
    }

    const lines = ['Current participants in this conversation:'];

    for (const user of participants) {
      const name = user.persona?.preferredName || user.username;
      const pronouns = user.persona?.pronouns ? ` (${user.persona.pronouns})` : '';
      const description = user.persona?.content || 'No additional context provided';

      lines.push(`- ${name}${pronouns}: ${description}`);
    }

    return lines.join('\n');
  }

  private formatMessagesWithUsers(history: ConversationMessageWithUser[]): ChatMessage[] {
    return history.map(msg => {
      if (msg.role === 'user' && msg.user) {
        const name = msg.user.persona?.preferredName || msg.user.username;

        return {
          role: 'user',
          content: `${name}: ${msg.content}`,
        };
      } else if (msg.role === 'assistant') {
        return {
          role: 'assistant',
          content: msg.content,
        };
      } else {
        return {
          role: msg.role,
          content: msg.content,
        };
      }
    });
  }
}
```

### 3. Example Context Output

```
System: You are Lilith, a sarcastic AI personality...

Current participants in this conversation:
- Alice (she/her): A friendly artist who loves cats and drawing. Very enthusiastic and upbeat.
- Bob (he/him): A programmer who works night shifts. Sarcastic and grumpy in the mornings but friendly once caffeinated.

Alice: Hey everyone! Look at this cat picture!
Bob: It's 6am, why are you so cheerful?
Assistant: Alice, that cat is adorable! And Bob, I see you've mastered the art of morning grumpiness. Should I start calling you Grumpy Cat?
Alice: @Bob Coffee helps!
Bob: Coffee is a lie.
Assistant: Bob, I think we need to have an intervention about your relationship with coffee...
```

## Schema Requirements

This design **requires the schema redesign** because:

1. **User → Persona resolution** must be clear and fast
   - Need efficient way to get user's default persona
   - Can't have circular dependencies slowing down joins
   - Need `UserDefaultPersona` table for O(1) lookup

2. **Per-personality persona overrides** (future)
   - User might have different personas for different personalities
   - Need `UserPersonalityConfig` to override default persona
   - Example: Formal persona for work bot, casual persona for friend bot

3. **Multiple persona support** (future)
   - Users need multiple personas they can switch between
   - Current schema's circular dependency makes this confusing
   - Clean ownership model essential

## Implementation Plan

### Phase 1: Schema Redesign (Required Foundation)

Changes from `schema-redesign-proposal.md`:

1. ✅ Create `UserDefaultPersona` table
2. ✅ Create `PersonalityDefaultConfig` table
3. ✅ Rename `UserPersonalitySettings` → `UserPersonalityConfig`
4. ✅ Add `ownerId` to `LlmConfig`
5. ✅ Make `Persona.ownerId` NOT NULL
6. ✅ Remove `User.globalPersonaId`
7. ✅ Remove circular dependencies

**Why this comes first**: We need clean User → Persona resolution to build group context efficiently.

### Phase 2: Enhanced Conversation Service

1. Add `getRecentHistoryWithUsers()` to ConversationHistoryService
   - Include user + persona data
   - Keep mixed channel history (not per-user)

2. Create `ConversationContextBuilder` service
   - Extract participants from history
   - Build participants introduction
   - Format messages with user labels

3. Add database index:
   ```sql
   CREATE INDEX idx_conversation_history_channel_personality_created
   ON conversation_history(channel_id, personality_id, created_at DESC);
   ```

### Phase 3: AI Worker Integration

Update `ConversationService` in ai-worker:

1. Replace simple history retrieval with context builder
2. Pass formatted group context to AI model
3. Test with multiple users

### Phase 4: Auto-Create Default Personas

When new user first interacts:

1. Check if user exists in database
2. If not, create user + default persona
3. Default persona content: "A Discord user with no additional context provided"
4. User can customize later via slash commands

## Benefits

✅ **Group conversations work naturally**: AI understands multi-user dynamics
✅ **Persona-aware responses**: AI knows who it's talking to
✅ **Scalable**: Adding more users just adds them to participants list
✅ **Future-proof**: Supports per-personality persona overrides
✅ **Clean architecture**: No circular dependencies, clear data flow

## Open Questions

1. **Participants limit**: How many users in context before it's too long?
   - Could limit to "users in last N messages"
   - Or "users who spoke in last X minutes"

2. **Persona updates**: If user updates persona mid-conversation, when does AI see it?
   - Next message (always fresh)
   - Or cache for conversation session?

3. **Anonymous users**: If user has no persona, what's the default?
   - "A Discord user with no additional context"
   - Or omit from participants list?

4. **Performance**: Joining user + persona on every history fetch
   - Add index on conversation_history(channel_id, personality_id, created_at)
   - Add index on user_default_personas(user_id)
   - Should be fast with proper indexes

---

**This design requires doing both schema redesign AND conversation service enhancement together.** They're intertwined - the conversation service needs the clean schema to efficiently resolve personas.

Ready to implement?
