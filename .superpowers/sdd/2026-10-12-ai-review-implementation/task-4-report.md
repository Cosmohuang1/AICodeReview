# Task 4 Report: 六个审查 Agent

## What Was Done

1. **Test-Driven Development (TDD) for All 6 Agents**:
   - Created comprehensive unit tests in `tests/agents/`:
     - `tests/agents/bug.agent.test.ts` (6 tests)
     - `tests/agents/security.agent.test.ts` (5 tests)
     - `tests/agents/performance.agent.test.ts` (5 tests)
     - `tests/agents/style.agent.test.ts` (5 tests)
     - `tests/agents/test.agent.test.ts` (5 tests)
     - `tests/agents/custom.agent.test.ts` (5 tests)
   - Mocked `callDeepSeek` from `../../src/agents/base.js` so zero real network/API calls are performed during tests.
   - Tested:
     - Normal JSON responses parsed into valid `ReviewComment[]`.
     - Markdown codeblock JSON parsing (` ```json [...] ``` `).
     - Empty findings (`[]`).
     - Error handling / resilience: DeepSeek network failures gracefully catch and return `[]` without unhandled rejections.
     - Fallbacks for omitted `file` / `line` defaults to `chunk.file` and `chunk.startLine`.
     - Language preference propagation (`config.language`).
     - Custom rules dynamic prompt interpolation and immediate return on empty rules for `customAgent`.
   - Executed `npx vitest run tests/agents` prior to agent creation to verify all 6 test suites failed as expected.

2. **Implemented 6 Specialized Review Agents**:
   - `src/agents/bug.agent.ts`:
     - Exported `export const bugAgent: AgentFn` and default export.
     - Category: `'bug'`.
     - Prompt focused on null pointer / undefined dereferencing, boundary conditions (empty arrays/strings, off-by-one), uncaught exceptions, race conditions, logic inversion, variable shadowing.
   - `src/agents/security.agent.ts`:
     - Exported `export const securityAgent: AgentFn` and default export.
     - Category: `'security'`.
     - Prompt focused on SQL/NoSQL injection, XSS, CSRF, hardcoded secrets/tokens/credentials, missing authentication/authorization checks (BOLA/IDOR), command injection, path traversal, unsafe deserialization/SSRF.
   - `src/agents/performance.agent.ts`:
     - Exported `export const performanceAgent: AgentFn` and default export.
     - Category: `'performance'`.
     - Prompt focused on N+1 queries, synchronous I/O or sequential unparallelized awaits in loops, memory leaks, missing caching/memoization, unnecessary deep copies, and algorithmic inefficiencies.
   - `src/agents/style.agent.ts`:
     - Exported `export const styleAgent: AgentFn` and default export.
     - Category: `'style'`.
     - Prompt focused on naming conventions, missing documentation/comments for complex logic, overly long functions/high cyclomatic complexity, code duplication (DRY), magic numbers/strings, unsafe type usage (e.g. `any`).
   - `src/agents/test.agent.ts`:
     - Exported `export const testAgent: AgentFn` and default export.
     - Category: `'test'`.
     - Prompt focused on missing unit/integration tests for critical business logic, untested conditional/error branches, invalid/vacuous test assertions, and fragile test environment coupling.
   - `src/agents/custom.agent.ts`:
     - Exported `export const customAgent: AgentFn` and default export.
     - Category: `'custom'`.
     - Gracefully handles empty rules (`!config.rules || config.rules.length === 0`) by immediately returning `[]` without unnecessary API calls.
     - Formats custom rules dynamically into prompt when present (`config.rules.map((rule, idx) => ...)`).

3. **Verification & Clean Compile**:
   - `npx tsc --noEmit`: 0 errors.
   - `npx vitest run`: 67/67 tests passed across all 10 test suites.
   - Vitest test coverage on `src/agents/`: 100% Statements, 100% Functions, 100% Lines.

4. **Git Commit**:
   - Staged `src/agents/` and `tests/agents/`.
   - Committed with message: `feat: 6 review agents (bug, security, performance, style, test, custom)` (`2896b0b`).

## Test Results

- **Vitest**: 67 passed across 10 test files (31 new tests for 6 agents)
  - `tests/agents/bug.agent.test.ts`: 6/6 passed
    - `bugAgent > returns ReviewComment array from DeepSeek response`
    - `bugAgent > handles markdown codeblock JSON response from DeepSeek`
    - `bugAgent > returns empty array when DeepSeek returns empty array or no issues`
    - `bugAgent > returns empty array on API error`
    - `bugAgent > falls back to chunk.file and chunk.startLine when omitted in response`
    - `bugAgent > includes language preference and diff content in prompt`
  - `tests/agents/security.agent.test.ts`: 5/5 passed
    - `securityAgent > returns ReviewComment array from DeepSeek response`
    - `securityAgent > handles markdown codeblock JSON response`
    - `securityAgent > returns empty array when DeepSeek returns empty list`
    - `securityAgent > returns empty array on API error`
    - `securityAgent > includes security checks in prompt`
  - `tests/agents/performance.agent.test.ts`: 5/5 passed
    - `performanceAgent > returns ReviewComment array from DeepSeek response`
    - `performanceAgent > handles markdown codeblock JSON response`
    - `performanceAgent > returns empty array when DeepSeek returns empty list`
    - `performanceAgent > returns empty array on API error`
    - `performanceAgent > includes performance focus points in prompt`
  - `tests/agents/style.agent.test.ts`: 5/5 passed
    - `styleAgent > returns ReviewComment array from DeepSeek response`
    - `styleAgent > handles markdown codeblock JSON response`
    - `styleAgent > returns empty array when DeepSeek returns empty list`
    - `styleAgent > returns empty array on API error`
    - `styleAgent > includes code style focus points in prompt`
  - `tests/agents/test.agent.test.ts`: 5/5 passed
    - `testAgent > returns ReviewComment array from DeepSeek response`
    - `testAgent > handles markdown codeblock JSON response`
    - `testAgent > returns empty array when DeepSeek returns empty list`
    - `testAgent > returns empty array on API error`
    - `testAgent > includes testing focus points in prompt`
  - `tests/agents/custom.agent.test.ts`: 5/5 passed
    - `customAgent > returns empty array immediately without calling DeepSeek when rules is empty`
    - `customAgent > returns ReviewComment array when rules are violated`
    - `customAgent > interpolates rules into DeepSeek prompt`
    - `customAgent > handles markdown codeblock JSON response`
    - `customAgent > returns empty array on API error`
  - Existing test suites:
    - `tests/agents/base.test.ts`: 10/10 passed
    - `tests/config/loader.test.ts`: 7/7 passed
    - `tests/parser/diff.parser.test.ts`: 9/9 passed
    - `tests/parser/chunker.test.ts`: 10/10 passed
- **TypeScript**: `tsc --noEmit` exited cleanly with 0 errors.

## Concerns / Decisions

1. **Named and Default Exports**:
   - Task 4 brief mentioned default export while Task 5 orchestrator and caller instructions require named imports (`import { bugAgent } from '../agents/bug.agent.js'`). We provided both `export const <name>Agent: AgentFn` and `export default <name>Agent` for 100% interoperability.
2. **`customAgent` Fast-Path**:
   - If `config.rules` is empty, calling DeepSeek would waste latency and API tokens to review against zero rules. We added a fast return `if (!config.rules || config.rules.length === 0) return [];` that avoids any LLM call while guaranteeing correct behavior.
3. **Response Normalization**:
   - In each agent, we ensure `category` is enforced to the agent's designated category (`'bug'`, `'security'`, `'performance'`, `'style'`, `'test'`, `'custom'`), `side` is `'RIGHT'`, and `file`/`line` fall back to `chunk.file`/`chunk.startLine` if missing from LLM JSON.
