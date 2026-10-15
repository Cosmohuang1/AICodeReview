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


## Opt-in export of reusable Playwright tests

    npm run review -- review --browser --ai-tests --export-tests

This writes reviewed test source into .ai-review/generated-tests/*.spec.ts,
never directly into the business repository's tests/ folder. Only actually
executed configured assertions (even if failed) and passing proposed assertions
are eligible. A generated test is NOT automatically promoted to a product
requirement or automatically committed. Smoke-only scenarios and click/fill
actions are skipped to prevent accidental side effects or credential leakage.
Install @playwright/test in the destination project before running/promoting
these files, and verify generated selectors/expectations with a developer.


## Interactive actions and safety

Configured click/fill actions are NOT executed by default. To allow them with
explicit local CLI consent, pass --approve-interactions. Treat this permission
as potentially destructive even when the target is localhost: a local app can
still contact a production database or remote API.

    npm run review -- review --browser --approve-interactions

Web mode always rejects click/fill regardless of this flag. AI-proposed actions
remain read-only and cannot request this permission.


## Company-owned C# / JavaScript / HTML frameworks

This project **does not assume ASP.NET MVC, Razor, React Router, or other routing conventions** for a company-owned framework. Use explicit route mappings for business pages and optional dependencyRules for relationships that cannot be observed from JS/HTML imports.

Example:

    browser:
      baseURL: http://127.0.0.1:3000
      dependencyRules:
        - dependencies: ["Server/Services/OrderService.cs"]
          consumers: ["wwwroot/js/orders.js"]
      mappings:
        - files: ["wwwroot/orders.html"]
          route: /orders
          scenarios:
            - id: order-page
              actions:
                - { type: goto, path: /orders }
                - { type: assertVisible, target: { by: role, value: heading, name: Orders } }

The dependency graph can follow HTML \`<script src="/js/orders.js">\` to \`wwwroot/js/orders.js\`, and explicit C# → JavaScript edges. It will not guess proprietary controller names, internal route registration logic, private API conventions or C# call sites. Configure those via \`dependencyRules\` and \`mappings\`. Network/external script URLs are excluded from local dependency inference.

These are test-planning hints, not proof of a code-level root cause. All proposed browser assertions still require observable evidence.


## Polyglot project test detection and execution

The review CLI and Web code-review endpoint now scan project manifests **without executing any code**. Supported ecosystems:

| Stack | Detection | Opt-in verification |
|---|---|---|
| C# / .NET | \`.sln\`, \`.slnx\`, \`.csproj\` test SDK | \`dotnet test <solution-or-project> --no-restore --nologo\` |
| Java | \`pom.xml\`, \`build.gradle[.kts]\` | \`mvn --offline --batch-mode test\` / \`gradle --offline --no-daemon test\` |
| Node.js | \`package.json\` test script and package manager lockfiles | \`npm test\`, \`pnpm test\`, \`yarn test\` |
| Python | \`pyproject.toml\`, \`pytest.ini\`, \`tox.ini\`, tests/ | \`python3 -m pytest -q\` (Windows: \`python -m pytest -q\`) |

For a mixed-language repository, multiple test targets can be selected based on the changed subprojects. Commands use fixed executable+argv, never model-written shell commands. External build tools and project test scripts can execute user/project code, so test execution is opt-in for **review-only** workflows.

Use:

    npm run review -- review --tests-only
    npm run review -- review --scope working --run-tests
    npm run review -- review --browser --run-tests

\`--tests-only\` works without a DeepSeek API key and does not start a browser. The standard \`review\` command discovers possible test commands but reports \`not-run\` until \`--run-tests\` is supplied.

In the Web code-review workspace, use the **执行项目测试** checkbox when initiating a review to explicitly authorize execution. API consumers pass \`runTests: true\` to \`POST /api/review\`. Without this flag, the result explicitly shows *tests not run* alongside discovered projects and test commands. The coding Agent workflow automatically verifies tests after successful code edits unless explicitly disabled; it will not auto-commit changes lacking passing tests.

Test outcomes: \`passed\` requires exit code 0 **and observed test passes in output**; \`failed\` means a test process exited unsuccessfully; \`partial\` includes absent executables, skipped targets, or success output that does not establish any tests were run; \`no-tests\` means no eligible configured test target; \`not-run\` means permission was not given. The report includes invoked argv, duration, exit code and bounded stderr/stdout snippets.

No dependency install/restore, remote fetch, machine-wide environment changes or automatic source edits are performed by the test detector. Maven/Gradle run offline and .NET uses \`--no-restore\` to avoid implicit downloads; in a fresh environment, prepare dependencies first. User-supplied test scripts are still arbitrary project code: only run them in an approved, disposable testing environment with test credentials and test databases.

This is manifest-level and test-runner-level discovery. It does not claim full test coverage or successful verification of any specific code change merely because some tests passed.

## Precise review finding locations

In the main AICodeReview workspace, each anchored finding shows a CodeRabbit-style
`FileName.ext:line` badge, with the full repository-relative path in its tooltip
and issue details. The finding index is derived from actual anchored file and
new-side line values, not from free-form AI summary text.

- For `last` and explicit `branch` (`base...target`) comparisons, a resolvable GitHub
  `origin` and target commit yield a permanent GitHub blob URL with `#L25`.
- For working-tree or partially staged changes, no link to potentially stale GitHub
  HEAD lines is emitted. Click the badge to open the local diff, where the
  reviewed line is highlighted when it appears in the diff hunk.
- Deleted files, invalid file paths/line numbers, unsupported remotes, and
  unresolved commits never produce fabricated GitHub line links.
- Downloaded Markdown reports include per-finding GitHub links where possible.
- Renamed files use the new-side path and line derived from the diff.
