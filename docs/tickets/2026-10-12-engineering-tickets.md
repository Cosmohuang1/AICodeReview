# 工程实施工单清单 (Engineering Tickets)
> 基于 Matt Pocock `to-tickets` 规约拆解  
> 关联规格书：[2026-10-12-coderabbit-system-spec.md](../specs/2026-10-12-coderabbit-system-spec.md)  
> 执行模式：严谨 TDD (Red -> Green -> Refactor)

---

### [TICKET-01] 真实 Git 工作区状态探测服务 (Git Workspace Service)
* **目标**：取代内存中的静态假仓库信息，实现真实 Git 状态提取。
* **文件清单**：
  - 新建 `src/services/git.service.ts`
  - 新建 `tests/services/git.service.test.ts`
* **功能点**：
  1. `getWorkspaceStatus(repoPath: string)`：提取当前分支、HEAD commit hash、未暂存与已暂存改动文件。
  2. `getFileDiffStats(repoPath: string)`：运行 `git diff --numstat`，计算每个文件的真实增删行数。
  3. `getUnifiedDiff(repoPath: string)`：获取当前工作区真实的 Unified Diff。
* **验收条件 (DoD)**：
  - 单元测试覆盖全部分支情况（空变更、多文件增删、未跟踪文件）。
  - 执行 `getWorkspaceStatus` 返回本机真实当前仓库的分支与提交信息。

---

### [TICKET-02] 真实回归测试执行器 (Test Runner Service)
* **目标**：取代写死的“457 通过，0 失败”，真实调用子进程跑测并提取真实指标。
* **文件清单**：
  - 新建 `src/services/test-runner.service.ts`
  - 新建 `tests/services/test-runner.service.test.ts`
* **功能点**：
  1. `runTestSuite(cwd: string, cmd?: string)`：安全执行测试脚本（如 `npm test`）。
  2. 输出解析器：解析 vitest / jest 控制台输出，提取实际 passed 数、failed 数、运行耗时。
  3. 超时与异常防护：设置 30s 默认超时，避免测试挂死。
* **验收条件 (DoD)**：
  - 测试通过时正确捕获 exitCode=0 及真实通过用例数。
  - 测试断言失败时正确捕获 exitCode!=0 及报错日志片段。

---

### [TICKET-03] 真实代码补丁写盘与回滚服务 (File Patch Service)
* **目标**：取代只输出文本不改文件的假智能体，实现安全的代码写盘应用。
* **文件清单**：
  - 新建 `src/services/patch.service.ts`
  - 新建 `tests/services/patch.service.test.ts`
* **功能点**：
  1. `applyFileChanges(cwd: string, changes: Array<{ path: string, content: string }>)`：直接写入更新代码。
  2. 安全备份：写盘前自动保存原始文件内容，若后续测试严重崩溃支持一键 rollback。
* **验收条件 (DoD)**：
  - 成功在临时测试目录下写入、更新文件，且内容精确无误。
  - 出现异常时支持干净回滚到修改前状态。

---

### [TICKET-04] Coding Agent 真实执行循环 (Agentic Execution Loop)
* **目标**：将“用户输入需求 -> DeepSeek 编写代码 -> 真实写盘 -> 真实跑测 -> 真实 Git Commit”全链路串联。
* **文件清单**：
  - 新建 `src/services/agent-loop.service.ts`
  - 新建 `tests/services/agent-loop.service.test.ts`
* **功能点**：
  1. 接收用户指令与上下文，驱动 DeepSeek 生成补丁操作。
  2. 调用 `patch.service` 真实写盘。
  3. 调用 `test-runner.service` 真实运行测试，获得真实验证结果。
  4. 创建隔离分支 `coderabbit/task-<id>` 并执行本地 `git commit`。
* **验收条件 (DoD)**：
  - 全流程端到端自动化跑通，分支与 Commit 真实落盘于 Git。

---

### [TICKET-05] 后端 API 路由改造与静态假数据清理
* **目标**：清除 `src/server/api.routes.ts` 中的静态假卡片，接入上述真实服务。
* **文件清单**：
  - 修改 `src/server/api.routes.ts`
  - 修改 `tests/server/api.routes.test.ts`
* **功能点**：
  1. 废除 `tasksList` 中的硬编码 `SqlSugar...` 静态模板。
  2. 实现 `/api/workspace/status`：提供当前工程真实分支、提交、修改文件列表。
  3. 实现 `/api/agent/execute`：触发真实代码修改与回归跑测。
  4. 实现 `/api/agent/deliver`：分支推送与真实 PR 触发。
* **验收条件 (DoD)**：
  - 既有 152 项测试及新 API 测试 100% 通过。

---

### [TICKET-06] 前端 Web 控制台全面接入真实数据流
* **目标**：让用户在 `http://localhost:3000` 看到的每一个文件、每一行数字、每次跑测都是当前真实的工程状态！
* **文件清单**：
  - 修改 `public/index.html`
* **功能点**：
  1. 页面打开时自动调用 `/api/workspace/status` 展现真实的工作区变更。
  2. 追问与执行按钮连接 `/api/agent/execute`，实时展示真实的修改文件与真实的测试回归结果（如 `152 passed, 0 failed`）。
  3. 右侧 Actions 面板展示真实的 Git Commit Hash，点击 Create PR 触发真实交付。
* **验收条件 (DoD)**：
  - 浏览器端与本机本地文件系统及 Git 状态完全一致，无任何伪造数据。
