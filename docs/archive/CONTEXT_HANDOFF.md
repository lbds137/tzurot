# Context Handoff Document - CRITICAL FOR CONTINUITY

## Current Status (2025-09-12)
Branch: `feat/v3-architecture-rewrite`

## What We're Building
Complete v3 rewrite of Tzurot Discord bot, moving from vendor-locked shapes.inc to vendor-agnostic architecture.

## Architecture Decision - IMPORTANT
- **We ARE using microservices architecture** (bot-client, api-gateway, ai-worker)
- **This was Gemini's original recommendation** (see gemini_chat_2025-09-11.md)
- **Do NOT simplify to monolith** - User explicitly wants clean separation to avoid v2's mess

## Critical Work In Progress

### 1. Fix Retry Logic (OpenRouterProvider)
**Problem**: Current retry logic swallows final error and retries on non-recoverable errors (401, 400)
**Solution**: Only retry on 5xx and network errors, throw final error after max retries

### 2. Add Zod Validation 
**Problem**: Using `process.env.OPENROUTER_API_KEY!` will crash at runtime if missing
**Solution**: Create config.ts with Zod schema to validate all env vars at startup

### 3. Improve Message Splitting
**Problem**: Current `.match(/.{1,2000}/g)` breaks words/sentences
**Solution**: Split on newlines/sentences first, respect Discord's 2000 char limit

### 4. Add Streaming Support
**Problem**: Bot waits for full response before replying
**Solution**: Implement streamComplete() method, edit message as content streams in

### 5. Migrate aiService.js
**Status**: Gemini is helping adapt existing aiService.js to new AIService class
**Location**: Should go in services/ai-worker/src/AIService.ts

## Project Structure
```
tzurot-v3/
├── services/
│   ├── bot-client/      # Discord.js bot
│   ├── api-gateway/     # Express API 
│   └── ai-worker/       # AI processing
├── packages/
│   ├── common-types/    # Shared TypeScript types
│   └── api-clients/     # AI provider implementations
```

## Key Files Modified Today
- Created entire v3 structure from scratch
- Fixed all ESLint/TypeScript issues
- Added pnpm hoisting config (.npmrc) for debug/eslint packages
- Updated to latest deps (ESLint 9, TypeScript 5.9, Vitest 3)

## Environment Setup
- Using pnpm (NOT npm)
- ESLint 9 with flat config (eslint.config.js)
- TypeScript with project references
- Railway deployment configured

## User Context
- Solo developer (not a team)
- Has existing v2 codebase (~2000 lines)
- Actively chatting with Gemini in browser (updating gemini_chat_2025-09-11.md)
- Wants clean architecture to avoid tech debt
- Very concerned about smooth context handoffs

## Next Assistant MUST:
1. Continue implementing the 5 fixes listed above
2. Keep the microservices architecture 
3. NOT suggest simplifying to monolith
4. Check gemini_chat_2025-09-11.md for any updates
5. Maintain clean separation of concerns

## Commands That Work
```bash
cd /home/deck/WebstormProjects/tzurot/tzurot-v3
pnpm install
pnpm run build
pnpm run lint
pnpm --filter @tzurot/bot-client dev
```

## DO NOT:
- Suggest architectural changes
- Use npm (use pnpm)
- Simplify to monolith
- Delete any existing v3 code
- Make breaking changes without user approval