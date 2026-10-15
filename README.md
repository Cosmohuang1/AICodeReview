# ai-review 🤖

> 对标 CodeRabbit 的企业级全场景 AI 代码审查与自主修复智能体系统。

`ai-review` 是一款集 **Web 可视化控制台**、**本地命令行 CLI** 与 **GitHub App 自动化审查机器人** 三位一体的现代化 AI 代码审查工具。驱动于 DeepSeek 大模型与工业级审查引擎，它能够在开发者编写代码、提交本地 Commit 或创建 Pull Request 时，提供**0 Token 确定性规则拦截**、**语法感知智能切块**、**六大专业领域 Agent 并发审查**、**二阶 Self-Critique 批判降噪**、**精确行号防漂移锚定**以及**可一键应用的修复补丁**。

---

## 目录

- [✨ 核心特性](#-核心特性)
- [🖥️ 三大使用场景](#️-三大使用场景)
  - [1. Web 智能可视化工作台 (对标 CodeRabbit)](#1-web-智能可视化工作台-对标-coderabbit)
  - [2. 本地 CLI 命令行代码走查 (ai-review diff)](#2-本地-cli-命令行代码走查-ai-review-diff)
  - [3. GitHub App 自动化 PR 审查机器人](#3-github-app-自动化-pr-审查机器人)
- [🏛 总体系统架构](#-总体系统架构)
- [🚀 快速开始](#-快速开始)
  - [安装与环境配置](#安装与环境配置)
  - [启动 Web 控制台](#启动-web-控制台)
  - [运行本地 CLI 审查](#运行本地-cli-审查)
- [⚙️ 仓库配置指南 (.ai-review.yml)](#️-仓库配置指南-ai-reviewyml)
- [💻 本地开发与测试](#-本地开发与测试)
- [📂 项目结构](#-项目结构)
- [📄 许可说明](#-许可说明)

---

## ✨ 核心特性

- **🎯 统一审查服务 (ReviewService)**：CLI、Web 控制台与 GitHub Pipeline 共享同一套工业级审查内核，保障审查质量严格一致。
- **⚡ 0 Token 确定性规约前置扫描**：集成高危正则规则引擎，毫秒级 100% 捕获硬编码 API 密钥、AWS Token、私钥与 SQL 拼接反模式，不消耗任何大模型 Token。
- **🧩 语法感知智能分块 (AST / Chunking)**：基于统一 Diff 与文件语法结构，智能合并邻近改动并补充关键上下文，告别机械切分导致的语境割裂。
- **👥 6 维专项 Agent 并发审查**：
  - 🐞 **BugAgent**：排查空指针/`undefined` 访问、数组越界、边界条件、竞态条件等逻辑缺陷。
  - 🔒 **SecurityAgent**：排查 OWASP Top 10、命令注入、XSS、敏感数据泄露、越权风险。
  - ⚡ **PerformanceAgent**：排查 N+1 查询、内存泄漏、大对象冗余拷贝、循环内阻塞 I/O。
  - 🎨 **StyleAgent**：排查圈复杂度、命名规范、可维护性与代码异味。
  - 🧪 **TestAgent**：排查测试用例盲区、断言缺失与边界覆盖不足。
  - 📏 **CustomRulesAgent**：依据仓库 `.ai-review.yml` 执行自拟规约（如“生产代码禁止使用 console.log”）。
- **🛡️ 二阶 Self-Critique 批判降噪**：在建议产出后引入二次仲裁模型，结合全上下文核验误报、无意义挑刺与重复项，有效过滤低价值建议，保障极高信噪比。
- **⚓ Unified Diff 行号防漂移锚定**：采用精准行号计算与清洗算法，确保 Review 建议精准锁定在 PR 或工作区的真实改动行，彻底避免行号错位。
- **🤖 自主自愈 ReAct 智能体**：内置 5 大原子工具（`read_file`, `edit_file`, `run_command`, `search_code`, `list_dir`），具备“思考-行动-观察”闭环，能自动跑测试并在测试失败时自我修正。
- **💾 原生 SQLite 双重持久化**：采用 Node.js 原生 `node:sqlite`（零外部 C++ 编译依赖），实时持久化审查任务、批注、聊天历史与偏好设置。

---

## 🖥️ 三大使用场景

### 1. Web 智能可视化工作台 (对标 CodeRabbit)

无需提交代码或推送到远端，本地打开浏览器即享完整的代码审查工作台：

```bash
npm run dev
# 访问 http://localhost:3000
```

- **多代码仓库快速切换**：支持穿透浏览本地磁盘目录或自动扫描检测本地 Git 仓库，一键关联并切换。
- **Git 本地分支即时切换与新建**：顶部胶囊支持快捷搜索本地分支、即时检出分支或自动创建新分支。
- **Now vs Next 双列决策看板**：按 P0（高危阻断）/ P1（性能优化）/ P2（日常规范）自动分流审查建议。
- **一键采纳建议 (Commit suggestion)**：基于安全 `PatchService`（保留原始 CRLF/LF 换行符、防路径穿越、支持事务回滚），点击即可直接写盘修改源文件。
- **实时 SSE 思考流与自愈控制台**：多轮需求指令输入，实时查看 ReAct Agent 思考过程与命令执行流。

### 2. 本地 CLI 命令行代码走查 (ai-review diff)

在任何 Git 仓库中直接运行，支持在提交前快速完成质量自查与离线审查：

```bash
# 审查当前工作区未提交修改（默认）
npm run review
# 或全局使用
ai-review diff

# 对比当前分支与 main 分支的差异
ai-review diff -f main

# 对比指定两个分支或 Commit
ai-review diff -f main -t feature-user-auth

# 审查最近一次 Commit (git show HEAD)
ai-review diff --last

# 指定输出 Markdown 报告路径
ai-review diff -o ./docs/review-report.md

# 指定自定义配置文件
ai-review diff -c .ai-review.yml
```

CLI 输出效果包含：
- 终端全彩高亮分类展示（`[P0] 🔴 [BUG]` / `[P1] 🟡 [PERF]` / `[P2] 🔵 [STYLE]`）。
- 附带修改说明与代码建议块。
- 自动导出格式精美的 Markdown 报告（含 PR Summary 摘要与 Mermaid 流程图）。

### 3. GitHub App 自动化 PR 审查机器人

作为 GitHub App 部署到服务器或云容器，监听组织或仓库的 Pull Request：

- 监听 PR `opened` 与 `synchronize` 事件。
- 自动更新 PR 描述（在 `<!-- ai-review-summary -->` 区块中幂等更新）。
- 批量发表行级 Inline Comments，携带可直接点击应用的 ` ```suggestion ` 代码块。
- 审查记录自动同步保存至本地 SQLite 数据库。

---

## 🏛 总体系统架构

```
                     ┌────────────────────────────────────────────────────────┐
                     │                     三大调用入口                        │
                     └───────┬────────────────────────┬───────────────┬───────┘
                             │                        │               │
                             ▼                        ▼               ▼
                     GitHub Webhook             Web 控制台 API          CLI 终端
                  (webhook.handler.ts)        (api.routes.ts)         (cli.ts)
                             │                        │               │
                             └────────────────────────┼───────────────┘
                                                      │
                                                      ▼
                                       ┌─────────────────────────────┐
                                       │    ReviewService 统一服务    │
                                       │ (src/services/review.service)│
                                       └──────────────┬──────────────┘
                                                      │
      ┌───────────────────────────────────────────────┴───────────────────────────────────────────────┐
      │                                                                                               │
      ▼ 1. Diff 解析                                                                                  ▼ 2. 排除过滤与权重打分
[diff.parser]                                                                                   [picomatch & impact score]
      │                                                                                               │
      ▼ 3. 语法感知分块                                                                                ▼ 4. 0 Token 确定性规则扫描
[chunker.ts]                                                                                    [deterministic.engine.ts]
      │                                                                                               │
      ▼ 5. 6 大专精 Agent 并发走查 (concurrency=4)                                                     ▼ 6. 跨 Agent 智能去重
[orchestrator/index.ts]                                                                         [deduplicator.ts]
(Bug, Security, Perf, Style, Test, Custom)                                                            │
      │                                                                                               ▼ 7. Self-Critique 二阶自愈批判
      ├───────────────────────────────────────────────────────────────────────────────────────────────┤
      │                                                                                               │
      ▼ 8. Unified Diff 行号防漂移锚定                                                                  ▼ 9. CodeRabbit 风格富元数据增强
[position.anchorer.ts]                                                                          (P0/P1/P2、tag、whyPriority、diffSnippet)
      │                                                                                               │
      ▼ 10. 全局架构与 Mermaid 摘要生成                                                                ▼ 11. 结果分发与持久化
[summary.agent.ts]                                                                              ├─► GitHub Publisher
                                                                                                ├─► SQLite Storage (node:sqlite)
                                                                                                └─► CLI 终端全彩输出 & Markdown 报告
```

---

## 🚀 快速开始

### 安装与环境配置

```bash
git clone https://github.com/your-org/ai-review.git
cd ai-review
npm install
```

复制环境配置文件并填入 DeepSeek API Key：

```bash
cp .env.example .env
```

在 `.env` 中填写：

```ini
# DeepSeek 模型 API Key (必填)
DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat

# 服务端口 (可选，默认 3000)
PORT=3000

# GitHub App 配置 (仅当需要接入 GitHub PR 时配置)
GITHUB_APP_ID=123456
GITHUB_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
GITHUB_WEBHOOK_SECRET=my_super_secret_webhook_key
```

### 启动 Web 控制台

```bash
npm run dev
```

打开浏览器访问 `http://localhost:3000` 即可开始使用。

### 运行本地 CLI 审查

```bash
npm run review
```

---

## ⚙️ 仓库配置指南 (.ai-review.yml)

被审查的业务仓库根目录下可创建 `.ai-review.yml` 来自定义审查规则：

```yaml
# .ai-review.yml
language: zh # 报告语言：zh (中文) 或 en (英文)

# 自定义企业/团队规约 (CustomRulesAgent 将严格校验)
rules:
  - "所有公共 API 函数必须包含 JSDoc 注释"
  - "禁止在生产代码中使用 console.log，必须使用统一日志库 logger"
  - "数据库查询必须使用参数化绑定，严禁字符串拼接 SQL"
  - "异步调用必须添加 try-catch 保护或处理 Promise rejection"

# 排除检查的文件路径
exclude:
  - "*.min.js"
  - "*.snap"
  - "coverage/**"
  - "dist/**"
  - "docs/**"

# 针对各维度的严重级别覆盖 (可选: error | warning | info)
severityOverride:
  style: warning
  performance: warning

# Self-Critique 二阶过滤阈值 (0-1，默认 0.65)
selfCritiqueThreshold: 0.65

# 单次审查最多深入走查的核心文件数 (默认 10)
maxFilesPerReview: 10
```

---

## 💻 本地开发与测试

本项目采用 Node.js (>=20)、TypeScript (strict mode)、ESM 规范与 Vitest 测试框架构建。**所有核心功能均 100% 遵循 TDD 模式开发。**

```bash
# 运行全量单元测试与集成测试 (35 个套件，259 个用例)
npm test

# 测试监听模式
npm run test:watch

# TypeScript 类型检查 (严格模式)
npx tsc --noEmit

# 打包构建生产产物
npm run build
```

---

## 📂 项目结构

```
ai-review/
├── public/                     # Web 控制台前端 (SPA 单页工作台)
│   └── index.html              # CodeRabbit 风格三栏工作区、双列看板与分支切换
├── data/
│   └── ai-review.db            # SQLite 本地持久化数据库
├── src/
│   ├── cli.ts                  # CLI 命令行入口 (ai-review diff)
│   ├── pipeline.ts             # GitHub PR Review 流水线
│   ├── agent-engine/           # 自主自愈 ReAct Agent 引擎
│   │   ├── react-engine.ts     # Thought-Action-Observation 闭环状态机
│   │   ├── react-streamer.ts   # SSE 实时日志与终端流分发
│   │   └── tools/              # 5 大原子工具 (read, edit, run, search, list)
│   ├── agents/                 # 6 大专项走查 Agent + SummaryAgent
│   ├── config/                 # 配置加载器 (Zod Schema + YAML)
│   ├── filter/                 # 降噪过滤层 (去重 Deduplicator + Self-Critique)
│   ├── github/                 # GitHub API (Octokit + Diff Fetcher + Publisher)
│   ├── orchestrator/           # 滑动并发调度池 (严格并发度节流)
│   ├── parser/                 # Unified Diff 解析、AST 分块与行号锚定
│   ├── reporter/               # Markdown 报告渲染与国际化
│   ├── rules/                  # 0 Token 确定性规则引擎
│   ├── server/                 # Express 服务端 (Webhook + REST/SSE API)
│   ├── services/               # 核心业务服务层
│   │   ├── review.service.ts   # 统一审查服务 (统一 CLI、Web 与 Webhook)
│   │   ├── git.service.ts      # Git 工作区与分支安全操作
│   │   ├── patch.service.ts    # 事务级代码补丁应用与安全回滚
│   │   └── test-runner.service.ts # 自动化单元测试跑测器
│   └── storage/                # SQLite 原生存储服务
└── tests/                      # 自动化测试用例集 (35 个测试套件，259 个测试全绿)
```

---

## 📄 许可说明

本项目遵循 [MIT License](LICENSE) 开源协议。


## 🔬 本地浏览器验证（新功能）

使用 `ai-review review --browser` 审查本地 Git 改动，并依据 `.ai-review.yml` 中的文件到路由映射，使用 Playwright 验证受影响页面；`--browser-only` 不需要 DeepSeek API Key。默认连接已运行的 localhost 服务并启动隔离 Chromium。详细配置、安全限制和退出码见 [Local Browser Verification](docs/local-browser-review.md)。


本地浏览器验证 Web 控制台：在显式启用本地 API 并设置访问令牌后，打开 `/local-review.html`。安全配置和 CLI 示例见 [详细说明](docs/local-browser-review.md)。
