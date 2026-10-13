# 工业级自主 ReAct 自愈循环 Agent 引擎设计方案

## 1. 概述与设计目标

本项目旨在从传统的“单次提示词生成（One-shot Wrapper）”跃迁为**工业级自主多轮 ReAct 闭环智能体（Autonomous Self-Correction Agent）**。借鉴开源社区顶级项目（**Aider** 的 Search/Replace 局部代码精准匹配机制、**Cline** 的透明 ReAct 终端执行流、**SWE-agent** 的执行状态机），实现以下核心能力：

1. **原子工具箱（Toolbox）**：提供 `read_file`（切片防溢出）、`edit_file`（精准局部替换，防整文件截断）、`run_command`（真实命令执行与输出捕获）、`search_code`（全局关键词/正则查找）、`list_dir`（工程结构探测）；
2. **闭环自愈状态机（Self-Correction Loop）**：模型自主决策每一步动作，若执行命令或跑测失败（`exitCode !== 0`），错误栈自动作为观测结果进入下一轮上下文，模型自我反思并精准修补，直至全量验证通过；
3. **SSE 实时流式控制台（Live Streaming Terminal）**：后端通过 Server-Sent Events (SSE) 持续输出实时打字机式思考流、工具调用事件、终端实时标准输出，前端支持实时观察与一键中止。

---

## 2. 系统架构设计

```
[Web 前端 (index.html)]
    │  ▲
    │  │ SSE 实时事件流 (/api/agent/react/stream/:sessionId)
    ▼  │
[API 路由层 (api.routes.ts)]
    │
    ├──> [ReactStreamer] (事件分发器，支持客户端订阅与连接管理)
    │
    └──> [ReactEngine] (自主控制循环主控)
            │
            ├──> [DeepSeek/OpenAI Native Tools API] (基于 tools 与 tool_calls 协议)
            │
            └──> [Toolbox] (原子工具集)
                    ├── read_file (安全路径检查、代码行号标注、切片读取)
                    ├── edit_file (Aider 风格严格局部定位与替换)
                    ├── run_command (子进程执行、超长截断、超时与高危拦截)
                    ├── search_code (高效代码检索)
                    └── list_dir (目录树扫描)
```

---

## 3. 详细设计规格

### 3.1 原子工具箱接口契约 (`src/agent-engine/tools/`)

#### 1) `read_file`
- **参数**：`{ path: string, startLine?: number, endLine?: number }`
- **行为**：
  - 路径安全性校验，严禁越出工作区目录；
  - 若文件不存在返回明确错误信息；
  - 默认限制单次最多返回 500 行，防 Token 溢出；
  - 每行附加行号前缀 `L<line>: <content>`，供模型精准定位。

#### 2) `edit_file` (Aider 范式)
- **参数**：`{ path: string, targetContent: string, replacementContent: string }`
- **行为**：
  - 读取目标文件，严格检索 `targetContent`；
  - 若匹配出现 0 次，尝试去除首尾多余空白字符重试匹配；若仍匹配失败，报错返回并提示模型重新 `read_file` 获取精确上下文；
  - 若匹配出现 >1 次，报错提示提供包含周围更多行的上下文以保证唯一性；
  - 替换成功后写入磁盘，返回变更行数与 Diff 摘要。

#### 3) `run_command`
- **参数**：`{ command: string, timeoutMs?: number }`
- **行为**：
  - 工作目录绑定为目标工程根路径；
  - 安全过滤：拦截高危命令（如 `rm -rf /`, `mkfs`, `format` 等）；
  - 设置超时阈值（默认 30,000ms），防止测试死循环挂起；
  - 截获 `exitCode`、`stdout` 与 `stderr`，自动格式化为标准反馈。

#### 4) `search_code`
- **参数**：`{ query: string, path?: string, maxResults?: number }`
- **行为**：基于正则在指定目录递归搜索文本行，排除 `.git`、`node_modules`、`dist` 等噪音目录，最多返回前 50 条匹配。

#### 5) `list_dir`
- **参数**：`{ path?: string, maxDepth?: number }`
- **行为**：列出子目录与文件名称，标记是否为 Git 仓库及目录类型。

---

### 3.2 自主自愈状态机 (`src/agent-engine/react-engine.ts`)

- **循环终止条件**：
  1. 模型显式判断任务完成（返回无 `tool_calls` 的最终结论）；
  2. 达到最大步数阈值 `maxSteps`（默认 10 轮）；
  3. 收到外部 AbortSignal（用户点击“中止执行”）；
  4. 遇到不可恢复的异常。
- **自愈机制**：
  - 工具执行结果（包含命令 exit code 与报错日志）包装为 `role: 'tool'` 消息加入上下文；
  - 若测试未通过，系统要求模型：“自动化测试未通过，请分析上述错误原因并针对性修改，不要放弃”；
  - 当全量测试跑通且模型宣布完成时，触发自动 Git 分支提交与任务持久化。

---

### 3.3 实时流式传输规范 (`src/agent-engine/react-streamer.ts`)

- **端点**：`GET /api/agent/react/stream/:sessionId`
- **协议**：`text/event-stream`
- **事件类型**：
  - `start`: 任务开始
  - `think`: 模型的思考/决策文本片段
  - `tool_call`: 启动工具（包含工具名与参数）
  - `tool_result`: 工具执行输出（包含日志片段与是否成功）
  - `step`: 单步迭代完成
  - `finish`: 任务整体交付完成
  - `abort`: 任务被用户主动中止
  - `error`: 异常终止

---

## 4. 验证与测试策略

1. **单元测试**：针对 5 个原子工具分别编写独立单元测试，覆盖边界异常、文件不存在、多重匹配、超限保护；
2. **状态机测试**：模拟工具执行失败场景，验证 ReAct 循环能否捕获并正确驱动下一次修补；
3. **集成测试**：端到端验证 SSE 消息流发送与任务中止逻辑；
4. **全量回归**：确保 Vitest 全量测试用例（173+ 项）保持 100% 通过率。
