# Memory Commands - Comprehensive Testing Plan

> **Purpose**: Manual QA checklist for Memory Management features before beta.44 release
> **Date Created**: 2026-01-17
> **Covers**: Phase 1 (STM), Phase 2 (LTM), Phase 3 (Incognito Mode)

---

## Prerequisites

- [ ] Bot is running and connected to Discord
- [ ] You have at least one personality with existing memories
- [ ] You have a test personality you can create/delete memories for safely

---

## Phase 1: STM Commands (`/history`)

> **Note**: `/history view` was listed in docs but never implemented. With extended context mode,
> viewing full conversation history in Discord would be impractical (length limits, UX issues).
> Use `/history stats` to see conversation statistics instead.

### `/history clear`

| Test                                            | Expected Result                          | Pass? |
| ----------------------------------------------- | ---------------------------------------- | ----- |
| Clear history for a personality                 | Confirmation message, history is cleared |       |
| Send new message after clear                    | Bot responds without prior context       |       |
| Previous memories still exist in `/memory list` | LTM unaffected by STM clear              |       |

### `/history undo`

| Test                         | Expected Result       | Pass? |
| ---------------------------- | --------------------- | ----- |
| Undo after sending a message | Last exchange removed |       |
| Undo when no history exists  | Error/info message    |       |

### `/history hard-delete`

| Test                                 | Expected Result                   | Pass? |
| ------------------------------------ | --------------------------------- | ----- |
| Hard delete history                  | Confirmation, permanently deleted |       |
| Verify cannot undo after hard-delete | Undo shows no history             |       |

---

## Phase 2: LTM Commands (`/memory`)

### `/memory stats <personality>`

| Test                                   | Expected Result                       | Pass? |
| -------------------------------------- | ------------------------------------- | ----- |
| Stats for personality with memories    | Shows count, date range, locked count |       |
| Stats for personality with no memories | Shows zero counts                     |       |
| Stats for "all" personalities          | Aggregated stats across all           |       |

### `/memory list [personality]`

| Test                                      | Expected Result                         | Pass? |
| ----------------------------------------- | --------------------------------------- | ----- |
| List with no filter                       | Shows memories across all personalities |       |
| List filtered by personality              | Only shows that personality's memories  |       |
| Pagination (if >10 memories)              | Next/Prev buttons work                  |       |
| Select memory from dropdown               | Detail view appears                     |       |
| **Detail view - Edit button**             | Modal opens, can edit content           |       |
| **Detail view - Lock button**             | Memory locks, shows 🔒                  |       |
| **Detail view - Unlock button**           | Memory unlocks                          |       |
| **Detail view - Delete button**           | Confirmation, then deletes              |       |
| **Detail view - View Full** (long memory) | Shows full content in modal             |       |

### `/memory search <query> [personality]`

| Test                              | Expected Result                | Pass? |
| --------------------------------- | ------------------------------ | ----- |
| Search with matching query        | Returns relevant memories      |       |
| Search with no matches            | Shows "no results" message     |       |
| Search filtered by personality    | Only searches that personality |       |
| Search with limit option          | Respects result limit          |       |
| Pagination on search results      | Works correctly                |       |
| Select memory from search results | Detail view appears            |       |

### `/memory delete <personality> [timeframe]`

| Test                             | Expected Result                     | Pass? |
| -------------------------------- | ----------------------------------- | ----- |
| Delete with timeframe (e.g., 7d) | Confirmation, shows count to delete |       |
| Delete all time                  | Confirmation required               |       |
| Locked memories NOT deleted      | Locked memories preserved           |       |
| Confirm deletion                 | Memories deleted, count shown       |       |
| Cancel deletion                  | No memories deleted                 |       |

### `/memory purge <personality>`

| Test                                           | Expected Result           | Pass? |
| ---------------------------------------------- | ------------------------- | ----- |
| Purge requires typed confirmation              | Modal with text input     |       |
| Type correct confirmation                      | All memories deleted      |       |
| Type wrong confirmation                        | Deletion cancelled        |       |
| Locked memories ALSO deleted (purge = nuclear) | All gone including locked |       |

### `/memory focus enable <personality>`

| Test                                | Expected Result                   | Pass? |
| ----------------------------------- | --------------------------------- | ----- |
| Enable focus mode                   | Confirmation message              |       |
| Send message to personality         | Response has 🔒 indicator         |       |
| Memories NOT retrieved during focus | AI doesn't reference old memories |       |
| New memories STILL saved            | Check `/memory list` after chat   |       |

### `/memory focus disable <personality>`

| Test                        | Expected Result               | Pass? |
| --------------------------- | ----------------------------- | ----- |
| Disable focus mode          | Confirmation message          |       |
| Send message to personality | No 🔒 indicator               |       |
| Memories retrieved again    | AI can reference old memories |       |

### `/memory focus status <personality>`

| Test                 | Expected Result           | Pass? |
| -------------------- | ------------------------- | ----- |
| Status when enabled  | Shows "Focus mode is ON"  |       |
| Status when disabled | Shows "Focus mode is OFF" |       |

---

## Phase 3: Incognito Mode (`/memory incognito`)

### `/memory incognito enable <personality> <duration>`

| Test                                 | Expected Result                            | Pass? |
| ------------------------------------ | ------------------------------------------ | ----- |
| Enable for specific personality (1h) | Confirmation with duration                 |       |
| Enable for "all" personalities       | Global incognito enabled                   |       |
| Enable when already active           | Shows "already active" with time remaining |       |
| **30m duration**                     | Correct expiration time                    |       |
| **1h duration**                      | Correct expiration time                    |       |
| **4h duration**                      | Correct expiration time                    |       |
| **forever duration**                 | Shows "until manually disabled"            |       |

### `/memory incognito disable <personality>`

| Test                             | Expected Result           | Pass? |
| -------------------------------- | ------------------------- | ----- |
| Disable active session           | Confirmation message      |       |
| Disable when not active          | Info message "not active" |       |
| Disable "all" when global active | Global session ended      |       |

### `/memory incognito status`

| Test                             | Expected Result                      | Pass? |
| -------------------------------- | ------------------------------------ | ----- |
| Status with no active sessions   | Shows "Incognito mode is OFF"        |       |
| Status with one session          | Shows personality and time remaining |       |
| Status with multiple sessions    | Lists all active sessions            |       |
| Status with global "all" session | Shows global is active               |       |

### `/memory incognito forget <personality> <timeframe>`

| Test                                 | Expected Result            | Pass? |
| ------------------------------------ | -------------------------- | ----- |
| Forget last 5 minutes                | Shows deleted count        |       |
| Forget last 15 minutes               | Shows deleted count        |       |
| Forget last 1 hour                   | Shows deleted count        |       |
| Forget for "all" personalities       | Deletes across all         |       |
| **Locked memories NOT deleted**      | Locked memories preserved  |       |
| Forget when no memories in timeframe | Shows "0 memories deleted" |       |

### Incognito Behavior Tests

| Test                                 | Expected Result                             | Pass? |
| ------------------------------------ | ------------------------------------------- | ----- |
| **Send message while incognito**     | Response has 👻 indicator                   |       |
| **Memory NOT saved while incognito** | Check `/memory list` - no new memory        |       |
| **Disable incognito, send message**  | No 👻, memory IS saved                      |       |
| **Auto-expiration** (if using 30m)   | Session ends after 30m, memories save again |       |

---

## Combined Scenarios

### Focus + Incognito Together

| Test                              | Expected Result                | Pass? |
| --------------------------------- | ------------------------------ | ----- |
| Enable both Focus and Incognito   | Both indicators show (🔒 + 👻) |       |
| Memories not read AND not written | Confirm both behaviors         |       |
| Disable one, other still active   | Correct indicator remains      |       |

### Edge Cases

| Test                         | Expected Result                         | Pass? |
| ---------------------------- | --------------------------------------- | ----- |
| Very long memory content     | Truncation works, "View Full" available |       |
| Special characters in memory | Displayed correctly                     |       |
| Memory with emoji            | Emoji preserved                         |       |
| Rapid commands               | No race conditions                      |       |
| Bot restart during incognito | Session persists (Redis-backed)         |       |

---

## Visual Indicators Checklist

| Indicator         | When Shown             | Location           |
| ----------------- | ---------------------- | ------------------ |
| 🔒 Focus Mode     | LTM retrieval disabled | Response footer    |
| 👻 Incognito Mode | LTM writing disabled   | Response footer    |
| 🔒 (on memory)    | Memory is locked       | Memory detail view |

---

## Post-Testing Cleanup

- [ ] Disable any active Focus Mode sessions
- [ ] Disable any active Incognito sessions
- [ ] Delete any test memories created
- [ ] Verify production personalities unaffected

---

## Notes

_Use this space to record any bugs or issues found during testing:_

```
Date:
Tester:
Issues Found:
-
-
-
```

---

## Sign-off

- [ ] All Phase 1 (STM) tests pass
- [ ] All Phase 2 (LTM) tests pass
- [ ] All Phase 3 (Incognito) tests pass
- [ ] Combined scenarios pass
- [ ] Ready for beta.44 release PR
