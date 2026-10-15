# Local Review + Browser Verification (MVP)

This feature extends the existing ReviewService instead of replacing the six-agent code reviewer.

## Prerequisites

- Node.js 22+ and Git.
- npm ci
- npx playwright install chromium
- A local HTTP(S) application serving on 127.0.0.1 or localhost.
- DEEPSEEK_API_KEY for AI review; browser-only mode does not require it.

## Quick start

1. Start the application normally in another terminal.
2. In the repository being reviewed, create .ai-review.yml (see example).
3. Change a file that matches browser.mappings.
4. Run one of:

    npm run review -- review --browser --url http://127.0.0.1:3000
    npm run review -- review --browser-only --url http://127.0.0.1:3000
    npm run review -- review --scope staged --browser
    npm run review -- review --base main --browser

Generated reports are written to .ai-review/runs/<run-id>/report.md and report.json, with screenshots and Playwright traces for failures. The .ai-review directory is ignored by Git because traces may contain sensitive data.

## Example .ai-review.yml

    language: zh
    browser:
      enabled: false
      baseURL: http://127.0.0.1:3000
      healthPath: /
      maxScenarios: 5
      scenarioTimeoutMs: 30000
      server:
        mode: existing
      connection:
        mode: isolated
        headless: true
      mappings:
        - files:
            - src/app/login/**
            - src/components/LoginForm.tsx
          route: /login
          scenarios:
            - id: login-button
              actions:
                - type: goto
                  path: /login
                - type: assertVisible
                  target: { by: role, value: button, name: Login }

Available actions: goto (absolute local path), click (locator), fill (locator and literal value), assertVisible (locator), assertURL (absolute local path). Locators: role, label, text, testId. No arbitrary JavaScript, arbitrary shell, or LLM-supplied commands are executed by the action runner.

Mappings are explicit in this version; automatic AST dependency propagation, route discovery, existing Playwright test reuse, and LLM-generated scenarios are not implemented yet. Without a configured scenario, an affected route only receives a smoke test (navigation + URL), not a functional correctness assertion.

## Local change scopes

- working (default): committed HEAD versus tracked worktree, including staged and unstaged changes.
- staged: index against HEAD.
- last: most recent commit.
- branch: base...HEAD, using Git merge-base semantics; supply --base.
- --include-untracked: optionally adds small regular text files for the working scope.

All Git commands use argv rather than concatenated shell strings. Untracked files are limited to 256 KB each, and the total diff budget is 10 MB.

## Opt-in experimental modes

Managed local server (runs configured command and args after explicit approval):

    browser:
      server:
        mode: managed
        command: npm
        args: ["run", "dev"]
        startupTimeoutMs: 60000

    npm run review -- review --browser --approve-server-start

Chrome CDP (accesses a separate explicitly debug-enabled Chrome profile):

    browser:
      connection:
        mode: cdp
        endpoint: http://127.0.0.1:9222

    npm run review -- review --browser --approve-cdp

Chrome versions may reject remote debugging on their normal user-data directory. Use a dedicated testing profile and never point this tool at your everyday browser session or production accounts. CDP and managed-server modes need manual environment-specific acceptance testing; existing-server + isolated Chromium is the supported default.

## Safety / reporting semantics

Browser access is limited to explicitly allowed loopback origins. Requests for other origins are blocked, so applications depending on external CDNs or APIs may need local test doubles. Localhost alone does not guarantee harmless behavior: use test accounts, test databases, and mocked side-effecting APIs.

Browser assertion failure is not proof that the current Git change caused a regression. It indicates a failure of an explicitly configured expectation. Errors from browsers, execution, and unavailable services are reported as partial/incomplete rather than source-code bugs. The legacy AI Agent API does not yet expose per-agent completion status, so AI review completeness is reported as unknown, never falsely asserted as fully checked.

JSON review status values: passed, findings, partial. Exit codes: 0 (no blocking result), 1 (blocking finding/failed assertion), 2 (execution/config failure), 3 (incomplete/partial review). No GitHub PR code is modified by this CLI command.


## New: automatic route impact (bounded AST import graph)

The analyzer reads local TypeScript/JavaScript import/export declarations using the
TypeScript compiler module resolver (including tsconfig path aliases), builds an
in-memory reverse dependency map, then traces changed files to known Next.js
App Router and Pages Router page entries. Unknown dynamic parameters such as
/users/[id] are never converted into guessed test URLs. Explicit mappings still
take precedence. Scanning is bounded to 3000 source files and 512 KB per file,
with warnings when coverage is incomplete.

### Optional AI-proposed tests

    npm run review -- review --browser --ai-tests

Or configure:

    browser:
      aiPlanning:
        enabled: true
        maxScenarios: 2

AI proposals use the existing DeepSeek API key and send a capped diff excerpt
to the provider. The model may propose only goto/assertVisible/assertURL;
responses are parsed with a strict Zod schema, checked against known routes,
and marked ai-proposed. Assertions suggested by AI are exploratory, not confirmed
bugs, even if they fail. Without a key, the planner is skipped with a warning.

### Optional local Baseline comparison

Start *both* revisions in separately configured local environments with equivalent
test data. Example: baseline on port 3001, worktree HEAD on port 3000:

    npm run review -- review --browser \
      --url http://127.0.0.1:3000 \
      --baseline-url http://127.0.0.1:3001

Only explicit configured assertions are compared. A baseline pass plus a HEAD
failure is a *candidate regression*, not proven causation. The tool does not
checkout branches, mutate project files, run Git worktree build commands, or
assume that the two environments are identical.

### Offline HTML + evidence correlation

Each run writes report.md, report.json, report.html and a redacted test-plan.json.
Findings are linked to browser scenario evidence when their changed file matches
the scenario's sourceFiles. This is labeled corroborated correlation, not a
confirmed code-level root cause. Images/traces are written under the run folder.

## Web console (explicitly opt-in, restricted browser-only mode)

The included standalone page is served at /local-review.html when running the
existing Web server. For security the API is disabled unless explicitly enabled.
Set strong, randomly generated LOCAL_REVIEW_API_TOKEN (at least 24 characters)
and ENABLE_LOCAL_BROWSER_API=1, and optionally LOCAL_REVIEW_ROOT to the
absolute path of the repository you want to review. Start the Web server, open
http://127.0.0.1:3000/local-review.html on the same machine, and enter the token.

The API endpoint /api/local-review/verify only accepts loopback connections,
same-origin browser requests and a constant-time verified token. It refuses
arbitrary repository paths, shell commands, managed app startup, Chrome CDP and
configured click/fill actions. It only performs non-interactive, isolated
Chromium checks; AI requests must be invoked explicitly with the CLI. This is a
separate safer Web entry point, not a replacement for a full authenticated IDE
or remote multi-user browser automation service.

Beware that the app under test may still call production APIs. Always use a
separate test environment. Outputs can contain private page data and must not be
published or committed to a repository.
