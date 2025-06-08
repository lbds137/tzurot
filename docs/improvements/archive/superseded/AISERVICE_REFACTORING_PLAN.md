# AIService.js Refactoring Plan

## Current State
- **File Size**: 1,491 lines (needs reduction)
- **Responsibilities**: Mixed concerns including auth, media processing, API communication, sanitization

## Proposed Module Extraction

### 1. Authentication Module (`src/utils/aiAuth.js`)
**Lines to extract**: ~60 lines
- `initAiClient()` - Initialize default client
- `getAiClientForUser()` - Get user-specific client
- Client creation logic with auth headers
- Auth bypass logic for webhook users

### 2. Media Processing Module (`src/utils/aiMediaProcessor.js`)
**Lines to extract**: ~250 lines
- Media content detection and extraction
- Multimodal array processing
- Media reference handling
- Image/audio URL processing
- Media context formatting

### 3. Request Management Module (`src/utils/aiRequestManager.js`)
**Lines to extract**: ~150 lines
- Pending request tracking (Map)
- Request ID generation
- Duplicate request prevention
- Error blackout period management
- Request deduplication logic

### 4. Content Sanitization Module (`src/utils/aiContentSanitizer.js`)
**Lines to extract**: ~100 lines
- `sanitizeContent()` - Clean AI responses
- `sanitizeApiText()` - Clean user input
- Pattern removal and text cleanup
- Marker detection and removal

### 5. Message Formatting Module (`src/utils/aiMessageFormatter.js`)
**Lines to extract**: ~400 lines
- `formatApiMessages()` - Main formatting function
- Reference message processing
- Proxy message handling
- Message role assignment
- Context combination logic

## Benefits

1. **Improved Maintainability**
   - Each module has a single, clear responsibility
   - Easier to test individual components
   - Reduced cognitive load when working on specific features

2. **Better Testability**
   - Isolated modules can be unit tested independently
   - Mocking becomes simpler
   - Higher test coverage achievable

3. **Code Reusability**
   - Media processing can be used elsewhere
   - Auth logic can be shared
   - Sanitization utilities available globally

4. **File Size Reduction**
   - aiService.js reduced from 1,491 to ~500 lines
   - Each extracted module is focused and manageable

## Implementation Order

1. **Phase 1**: Extract Authentication Module
   - Lowest risk, clear boundaries
   - Improves security isolation

2. **Phase 2**: Extract Content Sanitization Module
   - Simple utility functions
   - No complex dependencies

3. **Phase 3**: Extract Request Management Module
   - Self-contained logic
   - Clear interface

4. **Phase 4**: Extract Media Processing Module
   - More complex but well-defined
   - High value for reusability

5. **Phase 5**: Extract Message Formatting Module
   - Most complex extraction
   - Depends on other modules

## Testing Strategy

For each extraction:
1. Create comprehensive unit tests for the new module
2. Ensure aiService.js tests still pass
3. Add integration tests for module interactions
4. Verify no functionality regression

## Expected Outcome

After refactoring:
- aiService.js: ~500 lines (core API communication only)
- 5 new focused modules: ~60-400 lines each
- Total test coverage increase from current to 80%+
- Improved code organization and maintainability