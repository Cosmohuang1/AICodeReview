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
