# Task 5 Report: Orchestrator（并发调度）+ Self-Critique Filter

## What Was Done

1. **Test-Driven Development (TDD)**:
   - Created failing unit tests in `tests/orchestrator/index.test.ts` (6 tests).
   - Confirmed failure before implementing `src/orchestrator/index.ts`.
   - Created failing unit tests in `tests/filter/self-critique.test.ts` (9 tests).
   - Confirmed failure before implementing `src/filter/self-critique.ts`.

2. **Implemented Orchestrator (`src/orchestrator/index.ts`)**:
   - Dispatches each `CodeChunk` concurrently across all 6 specialized review agents (`bugAgent`, `securityAgent`, `performanceAgent`, `styleAgent`, `testAgent`, `customAgent`) using `Promise.allSettled`.
   - Resilience: Catches agent errors gracefully with `console.warn` without breaking or aborting the overall review pipeline.
   - Handles empty chunks list by returning an empty array without agent invocations.
   - Applies repository `severityOverride` configuration from `RepoConfig` if specified.
   - Exports both named `runOrchestrator` and default export.

3. **Implemented Self-Critique Two-Stage Filter (`src/filter/self-critique.ts`)**:
   - Fast-path for empty comments: immediately returns `[]` without calling LLM.
   - Synthesizes up to 3 chunks of code context into prompt alongside the candidate review comments.
   - Prompts DeepSeek to filter false positives, stylistic nitpicks, non-actionable remarks, and duplicates, recalibrating the `confidence` score (0.0 to 1.0).
   - Filters comments below `config.selfCritiqueThreshold`.
   - Preserves original comment metadata (suggestion, side, line, file, category, severity) while updating the confidence score.
   - Fallback resilience: Returns original comments if DeepSeek API fails or times out.
   - Exports both named `selfCritique` and default export.

4. **Verification & Type Checking**:
   - `npx tsc --noEmit`: 0 errors.
   - `npx vitest run`: 82/82 tests passed across 12 test suites.
   - Coverage: 100% Statements / Lines / Functions for `src/orchestrator/` and `src/filter/`.

5. **Git Commit**:
   - Staged `src/orchestrator/`, `src/filter/`, `tests/orchestrator/`, `tests/filter/`.
   - Committed with message: `feat: orchestrator and self-critique filter` (commit `eee31be`).

## Test Results

- **Vitest**: 82 passed across 12 test files
  - `tests/orchestrator/index.test.ts`: 6/6 passed
    - `runOrchestrator > collects results from all agents`
    - `runOrchestrator > handles empty chunks array without calling agents`
    - `runOrchestrator > dispatches to all 6 agents for each chunk`
    - `runOrchestrator > is resilient when an agent throws an error or rejects`
    - `runOrchestrator > processes multiple chunks and aggregates all comments`
    - `runOrchestrator > applies severityOverride from RepoConfig`
  - `tests/filter/self-critique.test.ts`: 9/9 passed
    - `selfCritique > returns comments with confidence above threshold`
    - `selfCritique > filters out comments below threshold`
    - `selfCritique > returns original comments on filter error (callDeepSeek rejection)`
    - `selfCritique > returns empty array immediately without calling DeepSeek when comments array is empty`
    - `selfCritique > handles empty chunks array gracefully`
    - `selfCritique > handles markdown codeblock JSON response from DeepSeek`
    - `selfCritique > filters multi-item responses according to threshold`
    - `selfCritique > preserves original comment details (suggestion, side, line) even if DeepSeek omits some`
    - `selfCritique > handles new valid comments returned by DeepSeek not matched by file/line`
  - Existing test suites: 67/67 passed
- **TypeScript**: `tsc --noEmit` exited cleanly with 0 errors.

## Concerns / Decisions

1. **`Promise.allSettled` vs `Promise.all`**:
   - Used `Promise.allSettled` to ensure that any transient agent failure (e.g. rate limit, JSON format error, timeout) does not cause the entire orchestrator or review process to fail. Failed agents are logged to `console.warn` and other agents' comments are preserved.
2. **Comment Preservation in Self-Critique**:
   - LLMs can occasionally omit optional fields (like `suggestion` or `side`) in their JSON output during critique. When matching by file and line to candidate comments, we merge the original comment properties with the model's updated `confidence` to avoid losing valuable suggestion code blocks.
3. **Severity Override**:
   - Applied `config.severityOverride` mapping within `runOrchestrator` if configured, satisfying the configuration schema requirements seamlessly.
