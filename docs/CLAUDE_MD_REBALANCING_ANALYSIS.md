# CLAUDE.md Rebalancing Analysis - 2025-11-17

## Current State

- **User-level** (`~/.claude/CLAUDE.md`): 497 lines - Universal rules for all projects
- **Project-level** (`CLAUDE.md`): 682 lines - Tzurot-specific context

## Issues Found

### 1. Project-Specific Content in User-Level CLAUDE.md ❌

**Standardized Test Commands** (lines ~280-310 in user file)

```markdown
### Standardized Test Commands

**IMPORTANT**: To avoid constantly asking for approval...

1. **Run all tests**: `npm test`
2. **Run specific test file**: `npm test tests/unit/path/to/test.js`
3. **Check test summary**: `npm test 2>&1 | grep -A 2 "Test Suites:"`
4. **Find failing tests**: `npm test 2>&1 | grep "FAIL tests/"`
```

**Problem**:

- Uses `npm` (Tzurot uses `pnpm`)
- Test paths and patterns are project-specific
- Should be in project CLAUDE.md

**Action**: Move to project CLAUDE.md and update for pnpm

---

**Lessons Learned - Git Restore Catastrophe** (in user file)

```markdown
#### 2025-07-21 - The Git Restore Catastrophe
```

**Problem**:

- Has date in the UNIVERSAL file
- Some lessons are universal ("don't run git restore"), some are Tzurot-specific
- Should split: universal rules stay, specific incident moves to project

**Action**:

- Keep universal rule ("NEVER run destructive git commands without asking")
- Move dated incident details to project CLAUDE.md lessons learned section

---

**Lessons Learned - Database URL Committed** (in user file)

```markdown
### 2025-10-31 - Database URL Committed to Git History
```

**Problem**: This is a Tzurot-specific incident

- Date is project-specific
- PostgreSQL/Railway details are Tzurot-specific

**Action**: Move to project CLAUDE.md, keep universal "never commit secrets" rule

---

**Testing Promise Rejections with Fake Timers** (very detailed Vitest guide)

**Problem**:

- Extremely detailed, Vitest-specific
- 60+ lines of implementation details
- Universal philosophy: yes
- This level of detail: project-specific

**Action**:

- Keep universal principle in user file ("test behavior not implementation")
- Move Vitest-specific details to project testing guide

### 2. Missing Content ⚠️

**Project CLAUDE.md Missing**:

- CURRENT_WORK.md update guidance (requested by user)
- When/how to update documentation
- Session handoff procedures

**User CLAUDE.md Missing**:

- MCP usage patterns (currently scattered)
- Tool preference guidelines (when to use Glob vs Grep, etc.)

### 3. Redundant Content 🔄

**Security - "NEVER COMMIT THESE"** appears in both files:

- User file: General principles
- Project file: Tzurot-specific examples (DATABASE_URL format)

**Recommendation**: Keep detailed examples in project file only

### 4. Content in Right Place ✅

**User-level (CORRECT)**:

- Lila persona
- Nyx personality
- Universal development rules (FORBIDDEN ACTIONS)
- Code style foundation (general principles)
- Universal testing philosophy (core principles)
- Refactoring rules
- Thinking requirements
- MCP usage basics

**Project-level (CORRECT)**:

- Project overview, tech stack
- Architecture, microservices flow
- Railway deployment specifics
- Git workflow (rebase-only is Tzurot-specific)
- v2 → v3 lessons learned
- Folder structure standards (Tzurot-specific)
- Documentation organization

## Recommended Changes

### Move FROM User-level TO Project-level

1. **Standardized Test Commands** → Update for pnpm, add to project CLAUDE.md
2. **Dated Incident Details** → Move specific incidents to project lessons learned
3. **Vitest Promise Rejection Details** → Move to project testing guide (keep principles)

### Add TO Project-level

1. **CURRENT_WORK.md Guidance**:

   ```markdown
   ## Documentation Maintenance

   **CURRENT_WORK.md**: Update at start of each session

   - What you're actively working on
   - Recent completions (last 1-2 sessions)
   - Next planned work
   - Last updated date

   **When to Update**:

   - Start of session: Read to understand context
   - End of major milestone: Update status
   - Switching focus: Document new direction
   ```

2. **Session Handoff Procedures**:

   ```markdown
   ## Session Handoff

   At end of session:

   1. Update CURRENT_WORK.md with progress
   2. Delete obsolete docs (git history preserves them)
   3. Update relevant doc timestamps
   4. Commit work-in-progress if needed
   ```

### Keep Universal but Consolidate

**Security Rules**:

- User file: Universal principles only
- Project file: Tzurot-specific examples and patterns

**Testing**:

- User file: Core philosophy, universal anti-patterns
- Project file: Vitest specifics, pnpm commands, project patterns

## Implementation Plan

1. Create backup of both files
2. Remove project-specific content from user file
3. Add removed content to project file (updated for pnpm)
4. Add new CURRENT_WORK guidance to project file
5. Add session handoff procedures to project file
6. Test with a sample prompt to verify organization

## Files to Update

- `~/.claude/CLAUDE.md` - Remove project-specific content
- `CLAUDE.md` - Add removed content + new guidance
- `docs/guides/TESTING.md` - Move detailed Vitest patterns here (optional)

---

**Decision Point**: Approve this plan before proceeding with changes?
