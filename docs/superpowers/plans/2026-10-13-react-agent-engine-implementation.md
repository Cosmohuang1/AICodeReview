# 工业级自主 ReAct 自愈循环 Agent 引擎实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建类似 Aider / Cline 的自主多轮 ReAct 纠错智能体引擎，具备原子工具箱（局部代码精准替换、命令执行、代码检索、文件读取）、闭环错误自愈反馈状态机、以及 Web 端 SSE 实时终端流式控制台。

**Architecture:** 
- `src/agent-engine/tools/`: 5 个严密原子工具，对外暴露标准 OpenAI/DeepSeek Tool Definition 及执行逻辑。
- `src/agent-engine/react-streamer.ts`: 负责前后端 SSE 长连接会话、事件广播与主动中止调度。
- `src/agent-engine/react-engine.ts`: 多轮 ReAct 核心状态机，处理工具调用、上下文追加、真实物理报错反馈与自我修正循环。
- `src/server/api.routes.ts`: 暴露 `/api/agent/react/run`、`/api/agent/react/stream/:sessionId`、`/api/agent/react/abort/:sessionId`。
- `public/index.html`: Web 实时流式控制台，展示打字机式思考流、工具动作、终端日志，支持随时中止。

**Tech Stack:** TypeScript (ESM, strict), Node.js (Child Process / FS), Express (SSE), Vitest, OpenAI SDK (DeepSeek-compatible mode).

## Global Constraints
- Node.js >= 20, TypeScript 严格模式 (strict: true), ESM (`"type": "module"`)
- 测试驱动开发 (TDD)，每个模块先写失败测试再编码实现
- 严禁假数据，所有文件读写与终端命令执行均基于物理系统真实反馈
- 界面纯中文，错误提示与操作引导友好详实

---

### Task 1: 原子工具箱 (Toolbox) 与单元测试

**Files:**
- Create: `src/agent-engine/tools/types.ts`
- Create: `src/agent-engine/tools/read-file.ts`
- Create: `src/agent-engine/tools/edit-file.ts`
- Create: `src/agent-engine/tools/run-command.ts`
- Create: `src/agent-engine/tools/search-code.ts`
- Create: `src/agent-engine/tools/list-dir.ts`
- Create: `src/agent-engine/tools/index.ts`
- Test: `tests/agent-engine/tools.test.ts`

**Interfaces:**
- Produces:
  - `AGENT_TOOLS`: OpenAI compatible `ChatCompletionTool[]`
  - `executeAgentTool(cwd: string, toolName: string, args: Record<string, any>): Promise<ToolResult>`

- [ ] **Step 1: 编写工具集失败测试**
- [ ] **Step 2: 运行测试确认 FAIL (`npx vitest run tests/agent-engine/tools.test.ts`)**
- [ ] **Step 3: 实现 5 个原子工具核心逻辑及安全防呆**
- [ ] **Step 4: 运行测试确认 PASS**
- [ ] **Step 5: Git commit: `feat(agent-engine): implement 5 atomic tools with unit tests`**

---

### Task 2: SSE 实时事件流分发器 (ReactStreamer)

**Files:**
- Create: `src/agent-engine/react-streamer.ts`
- Test: `tests/agent-engine/react-streamer.test.ts`

**Interfaces:**
- Produces:
  - `class ReactStreamer`:
    - `registerClient(sessionId: string, res: Response): void`
    - `broadcast(sessionId: string, event: StreamEventType, payload: any): void`
    - `closeSession(sessionId: string): void`
    - `abortSession(sessionId: string): boolean`
    - `createAbortSignal(sessionId: string): AbortSignal`

- [ ] **Step 1: 编写 ReactStreamer 失败测试**
- [ ] **Step 2: 运行测试确认 FAIL**
- [ ] **Step 3: 实现 ReactStreamer 订阅与广播机制**
- [ ] **Step 4: 运行测试确认 PASS**
- [ ] **Step 5: Git commit: `feat(agent-engine): implement SSE event streamer`**

---

### Task 3: 自主 ReAct 自愈状态机引擎 (ReactEngine)

**Files:**
- Create: `src/agent-engine/react-engine.ts`
- Test: `tests/agent-engine/react-engine.test.ts`

**Interfaces:**
- Consumes: `AGENT_TOOLS`, `executeAgentTool`, `ReactStreamer`
- Produces:
  - `runReactEngine(params: ReactEngineParams): Promise<ReactEngineResult>`

- [ ] **Step 1: 编写 ReactEngine 状态机测试（Mock 模型工具调用、报错反馈循环与完成态）**
- [ ] **Step 2: 运行测试确认 FAIL**
- [ ] **Step 3: 实现多轮自主 ReAct 控制循环、观测反馈与错误自愈**
- [ ] **Step 4: 运行测试确认 PASS**
- [ ] **Step 5: Git commit: `feat(agent-engine): implement autonomous react engine with self-correction`**

---

### Task 4: API 路由与后端服务整合

**Files:**
- Modify: `src/server/api.routes.ts`
- Test: `tests/server/react-agent.routes.test.ts`

**Interfaces:**
- Produces:
  - `POST /api/agent/react/run` -> `{ sessionId, taskId, status }`
  - `GET /api/agent/react/stream/:sessionId` -> SSE 文本事件流
  - `POST /api/agent/react/abort/:sessionId` -> `{ success, aborted }`

- [ ] **Step 1: 编写 API 路由测试**
- [ ] **Step 2: 运行测试确认 FAIL**
- [ ] **Step 3: 在 `api.routes.ts` 注册 ReAct 任务运行、流式与中止路由**
- [ ] **Step 4: 运行测试确认 PASS**
- [ ] **Step 5: Git commit: `feat(server): expose react agent sse and run routes`**

---

### Task 5: Web 前端实时流式控制台整合 (index.html)

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: 工作台增加“自主 ReAct 模式”流式控制台面板 `#reactLiveConsole`**
- [ ] **Step 2: 实现 EventSource 连接、实时打字机思考、命令执行日志折叠与一键中止交互**
- [ ] **Step 3: 任务完成时无缝过渡并更新工作台 Git 状态与历史卡片**

---

### Task 6: 全量系统验证与构建检查

- [ ] **Step 1: 运行全量测试套件 `npm test`，确认所有测试通过**
- [ ] **Step 2: 运行 TypeScript 类型检查 `npx tsc --noEmit`，确认零错误**
- [ ] **Step 3: 检查 `npm run dev` 正常运行并进行端到端体验验证**
- [ ] **Step 4: Git 提交并推送到远程仓库**
