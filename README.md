# ai-review 🤖

> 对标 CodeRabbit 的企业级智能 GitHub Code Review 机器人服务。

`ai-review` 是一款基于 GitHub App 与 DeepSeek 大模型的全自动代码审查机器人。它能够在开发者提交或更新 Pull Request 时自动触发，执行语法感知的智能代码切分、六大专业维度的并发审查、二阶 Self-Critique 降噪过滤，并将结构化的审查报告（包含 PR 摘要、变更清单、调用流程 Mermaid 图）与行级内联建议（含一键采纳的 `suggestion` 代码块）直接回写至 GitHub PR 页面。

---

## 目录

- [核心特性](#-核心特性)
- [系统架构](#-系统架构)
- [快速开始](#-快速开始)
  - [1. 注册 GitHub App](#1-注册-github-app)
  - [2. 安装与配置环境变量](#2-安装与配置环境变量)
  - [3. 本地启动与测试 Webhook](#3-本地启动与测试-webhook)
- [环境变量说明](#-环境变量说明)
- [仓库配置指南 (.ai-review.yml)](#-仓库配置指南-ai-reviewyml)
- [本地开发与测试](#-本地开发与测试)
- [项目结构](#-项目结构)
- [许可说明](#-许可说明)

---

## ✨ 核心特性

- **⚡ 全自动事件驱动**：监听 GitHub `pull_request` 的 `opened` 与 `synchronize` 事件，毫秒级响应 Webhook，后台无阻塞异步处理。
- **🧩 语法感知智能分块 (Tree-sitter)**：基于统一 Diff 与 AST 解析进行智能分块，保持函数与类的上下文完整性（支持每块最高 8000 tokens 上下文感知），规避机械切分丢失关键语境。
- **👥 6 维专项 Agent 并发审查**：基于 `Promise.allSettled` 并发调用 DeepSeek 大模型：
  - 🐞 **BugAgent**：排查空指针/`undefined` 访问、数组越界、边界条件、未捕获异常、竞态条件、逻辑反向等。
  - 🔒 **SecurityAgent**：排查 OWASP Top 10、SQL/命令注入、XSS、SSRF、硬编码密钥/Token、反序列化风险、越权缺陷等。
  - ⚡ **PerformanceAgent**：排查 N+1 查询、内存泄漏、未关闭资源、无效重复计算/大对象拷贝、高频循环内 I/O 等。
  - 🎨 **StyleAgent**：排查代码圈复杂度、变量命名规范、代码异味、职责不清、可维护性缺陷等。
  - 🧪 **TestAgent**：排查测试用例覆盖盲区、边界分支未测、断言缺失、脆弱断言等。
  - 📏 **CustomRulesAgent**：依据仓库自拟 `.ai-review.yml` 规则执行个性化规范审查（如禁止 `console.log`、公共接口必须有 JSDoc 等）。
- **🎯 二阶 Self-Critique 降噪过滤**：在建议产出后引入二次仲裁模型，剔除误报、无意义挑刺、非确定性建议与重复项，计算置信度得分（默认阈值 0.6），从源头杜绝 Review 噪音。
- **📝 结构化摘要与 Mermaid 可视化**：自动在 PR 描述末尾注入 Markdown 摘要区，包含改动概览、文件变更清单（Walkthrough）以及架构流程/时序 Mermaid 图。
- **💡 可一键应用的行级代码建议**：问题精确定位到 Diff 行，携带 ` ```suggestion ` 代码块，开发者可在 GitHub UI 上直接点击 *Commit suggestion* 应用修改。
- **🔄 幂等性与干净体验**：同一 PR 再次推送代码触发更新时，自动清理机器人历史审查评论，防止多轮推送造成评论堆叠。

---

## 🏛 系统架构

```
GitHub (PR Opened / Synchronized)
    │  POST /webhook (带 X-Hub-Signature-256 HMAC-SHA256 签名)
    ▼
[Webhook Server] (Express)
    │  1. 验证 HMAC-SHA256 签名（防重放与伪造）
    │  2. 立即响应 200 OK（满足 GitHub 10 秒超时要求）
    ▼
[Review Pipeline] (异步后台执行)
    │
    ├─► [Diff Fetcher] (Octokit REST API)
    │       拉取 PR Unified Diff、文件完整内容及 PR 原始描述
    │
    ├─► [Config Loader]
    │       动态读取仓库根目录 .ai-review.yml / .ai-review.yaml（无则使用默认）
    │
    ├─► [Exclusion Filter & Limiter]
    │       过滤锁定文件/产物，并按 maxFilesPerReview 截断
    │
    ├─► [Diff Parser & Chunker] (parse-diff + Tree-sitter)
    │       解析 Diff 并附带上下文扩充，生成语法感知 CodeChunk
    │
    ├─► [Orchestrator] (并发调度 6 个 Agent)
    │       ├── BugAgent
    │       ├── SecurityAgent
    │       ├── PerformanceAgent
    │       ├── StyleAgent
    │       ├── TestAgent
    │       └── CustomRulesAgent
    │
    ├─► [Self-Critique Filter] (二阶深度降噪)
    │       评估置信度，过滤误报与低质量建议
    │
    ├─► [Summary Agent]
    │       生成整体 PR Overview、文件变更表及 Mermaid 流程图
    │
    └─► [GitHub Publisher] (Octokit)
            ├── 更新 PR Body：幂等替换 <!-- ai-review-summary --> 区块
            └── 发布 Review：批量创建含 suggestion 块的行级 Inline Comments
```

---

## 🚀 快速开始

### 1. 注册 GitHub App

1. 登录 GitHub，访问 **Settings** -> **Developer settings** -> **GitHub Apps** -> **New GitHub App**。
2. 填写基本信息：
   - **GitHub App name**：例如 `my-ai-review-bot`。
   - **Homepage URL**：填写公司或个人主页地址。
3. 配置 Webhook：
   - **Webhook URL**：填写你的服务公网地址，例如 `https://your-domain.com/webhook`（本地调试可使用 [smee.io](https://smee.io) 生成的代理地址）。
   - **Webhook secret**：设置一个随机高强度密钥（例如 `my_super_secret_webhook_key_2026`）。
4. 配置权限（Permissions -> Repository permissions）：
   - **Pull requests**：`Read and write`（用于读取 PR 并发布 Review 评论及更新 PR Body）。
   - **Contents**：`Read-only`（用于读取 PR 文件差异及仓库内容）。
   - **Metadata**：`Read-only`（默认必选）。
5. 订阅事件（Subscribe to events）：
   - 勾选 **Pull request**。
6. 创建应用后：
   - 记录页面上的 **App ID**。
   - 在页面底部点击 **Generate a private key** 下载 `.pem` 私钥文件。
7. 在左侧菜单点击 **Install App**，将机器人安装到需要 Review 的测试仓库或 Organization。

---

### 2. 安装与配置环境变量

克隆仓库并安装依赖：

```bash
git clone https://github.com/your-org/ai-review.git
cd ai-review
npm install
```

复制环境变量模板并填入真实配置：

```bash
cp .env.example .env
```

`.env` 配置文件说明：

```ini
# GitHub App ID
GITHUB_APP_ID=123456

# GitHub App 私钥（PEM 内容，换行符替换为 \n；或者多行 PEM 格式均支持）
GITHUB_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----"

# Webhook Secret（需与 GitHub App 配置一致）
GITHUB_WEBHOOK_SECRET=my_super_secret_webhook_key_2026

# DeepSeek 模型 API Key
DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# DeepSeek API 端点（默认 https://api.deepseek.com，支持内网自建代理或 OpenAI 兼容端点）
DEEPSEEK_BASE_URL=https://api.deepseek.com

# 审查模型（默认 deepseek-chat）
DEEPSEEK_MODEL=deepseek-chat

# 服务监听端口
PORT=3000
```

---

### 3. 本地启动与测试 Webhook

#### 方式 A：启动开发服务器

```bash
npm run dev
```

输出日志：
```text
[ai-review] Server listening on port 3000
```

#### 方式 B：测试健康检查端点

```bash
curl http://localhost:3000/health
```

返回响应：
```json
{"status":"ok","version":"0.1.0"}
```

#### 方式 C：使用 smee.io 进行本地 Webhook 联调

1. 访问 [smee.io](https://smee.io) 点击 **Start a new channel** 获取专属转发 URL（例如 `https://smee.io/abc123xyz`）。
2. 将此 URL 填入你的 GitHub App 的 Webhook URL 中。
3. 在本地终端启动 Smee 客户端：
   ```bash
   npx smee -u https://smee.io/abc123xyz -t http://localhost:3000/webhook
   ```
4. 在目标仓库提交 Pull Request，观察服务终端日志输出及 GitHub PR 页面反馈。

---

## ⚙️ 环境变量说明

| 环境变量名 | 必填 | 默认值 | 说明 |
|:---|:---:|:---|:---|
| `GITHUB_APP_ID` | 是 | - | GitHub App 的数字 ID（可在 App 设置页查看） |
| `GITHUB_PRIVATE_KEY` | 是 | - | GitHub App 私钥内容（PEM 格式，可带 `\n` 或直接多行） |
| `GITHUB_WEBHOOK_SECRET` | 是 | - | 用于 HMAC-SHA256 签名校验的 Webhook 密钥 |
| `DEEPSEEK_API_KEY` | 是 | - | DeepSeek 开放平台 API 访问密钥 |
| `DEEPSEEK_BASE_URL` | 否 | `https://api.deepseek.com` | DeepSeek 或兼容 OpenAI 协议的 API Base URL |
| `DEEPSEEK_MODEL` | 否 | `deepseek-chat` | 审查与摘要采用的 LLM 模型名称 |
| `PORT` | 否 | `3000` | Express Webhook 服务监听端口 |
| `NODE_ENV` | 否 | `development` | 运行环境（`development` / `production` / `test`） |

---

## 🛠 仓库配置指南 (.ai-review.yml)

被审查的业务仓库可在根目录下创建 `.ai-review.yml`（或 `.ai-review.yaml`）自定义审查行为。若未提供此文件，系统将自动采用默认配置。

### 配置文件完整示例

```yaml
# .ai-review.yml
# ai-review 仓库级审查配置文件

# 审查报告与建议语言，支持 zh（中文）或 en（英文），默认为 zh
language: zh

# 公司/团队自定义规范（违反时由 CustomRulesAgent 报告并标示为 🔴 [RULE]）
rules:
  - "所有公共 API 函数必须有 JSDoc 注释"
  - "禁止在生产代码中使用 console.log，请使用统一日志库"
  - "数据库查询必须使用参数化查询，禁止字符串拼接"
  - "所有异步函数必须有 try-catch 或在调用方处理 Promise rejection"

# 额外排除的文件路径（支持通配符 glob，默认已排除 lock 文件、dist、min.js 等）
exclude:
  - "*.snap"
  - "coverage/**"
  - "__mocks__/**"
  - "docs/**"

# 针对各维度的严重级别覆盖（可选，支持 error | warning | info）
# severityOverride:
#   style: warning
#   performance: warning

# Self-Critique 过滤阈值（范围 0-1，得分低于该值的建议将被自动过滤，默认为 0.6）
selfCritiqueThreshold: 0.65

# 单次 PR 最多审查的文件数量上限（默认 20，超出时优先审查前 N 个文件）
maxFilesPerReview: 20
```

### 默认排除规则
即便未在 `.ai-review.yml` 中指定 `exclude`，系统默认也会自动跳过以下类型的文件：
- `*.min.js`
- `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`
- `dist/**`, `build/**`
- `*.generated.ts`, `*.generated.js`

---

## 💻 本地开发与测试

本项目采用 Node.js (>=20)、TypeScript (strict mode)、ESM 规范与 Vitest 测试框架构建。

### 开发常用命令

```bash
# 启动热重载开发服务器
npm run dev

# 运行全量单元测试与集成测试
npm test

# 启动测试侦听模式 (watch)
npm run test:watch

# 运行测试并生成代码覆盖率报告
npm run test:coverage

# 执行 TypeScript 类型检查
npx tsc --noEmit

# 打包构建生产代码至 dist 目录
npm run build

# 运行生产构建产物
npm start
```

### 运行测试套件

本项目所有核心逻辑均严格遵循 TDD 模式开发，覆盖率超过 80%：

```bash
npm test
```

测试覆盖范围：
- **`tests/parser/`**：Unified diff 解析与 Tree-sitter 语法感知分块（语言推导、Token 估算、上下文截断）。
- **`tests/agents/`**：DeepSeek 基础层、JSON 容错解析、6 大 Agent 逻辑与 PR Summary 摘要生成。
- **`tests/orchestrator/`**：Promise 并发调度、超时熔断与容错聚合。
- **`tests/filter/`**：二阶 Self-Critique 建议过滤与置信度裁决。
- **`tests/github/`**：Octokit App 鉴权、Diff 与文件拉取、Review 及 Suggestion 发布。
- **`tests/pipeline/`**：端到端 Review Pipeline 编排、动态配置读取与错误防御。
- **`tests/server/`**：Express HMAC-SHA256 签名校验、Draft PR 过滤与后台异步流转。

---

## 📂 项目结构

```
ai-review/
├── .ai-review.yml              # 示例仓库配置文件
├── .env.example                # 环境变量配置模板
├── package.json                # 项目依赖与 npm scripts
├── tsconfig.json               # TypeScript 严格模式配置
├── README.md                   # 完整工程技术文档
├── src/
│   ├── server/                 # Webhook 服务端
│   │   ├── app.ts              # Express 应用与中间件配置
│   │   └── webhook.handler.ts  # Webhook 签名鉴权、事件过滤与异步分发
│   ├── pipeline.ts             # Review Pipeline 完整业务流串联编排
│   ├── github/                 # GitHub 交互适配层
│   │   ├── octokit.ts          # GitHub App Octokit 客户端鉴权与初始化
│   │   ├── diff.fetcher.ts     # PR Diff、多文件源码及原始描述获取
│   │   └── publisher.ts        # PR Body 注入与行级 Review 批量发布
│   ├── parser/                 # 代码解析与切分
│   │   ├── diff.parser.ts      # Unified Diff 文件与 Hunk 解析
│   │   └── chunker.ts          # 语法感知代码分块与 Token 估算
│   ├── agents/                 # 专项代码审查 Agent
│   │   ├── types.ts            # ReviewComment、CodeChunk 等核心数据模型
│   │   ├── base.ts             # DeepSeek API 封装与 JSON 容错提取
│   │   ├── bug.agent.ts        # Bug 缺陷专项审查
│   │   ├── security.agent.ts   # 安全漏洞专项审查
│   │   ├── performance.agent.ts# 性能问题专项审查
│   │   ├── style.agent.ts      # 风格规范专项审查
│   │   ├── test.agent.ts       # 测试完备性审查
│   │   ├── custom.agent.ts     # 仓库自定义规范审查
│   │   └── summary.agent.ts    # PR 摘要与 Mermaid 流程图生成
│   ├── orchestrator/           # 并发调度器
│   │   └── index.ts            # Promise.allSettled 多 Agent 并行调度
│   ├── filter/                 # 建议质量过滤
│   │   └── self-critique.ts    # 二阶 Self-Critique 降噪过滤与评分
│   ├── reporter/               # 报告与评论渲染
│   │   └── markdown.reporter.ts# Markdown PR Body 及行级 Comment 模板生成
│   └── config/                 # 配置管理
│       ├── schema.ts           # Zod 配置 Schema 定义与校验
│       └── loader.ts           # .ai-review.yml 载入与容错降级
└── tests/                      # 自动化测试用例集（20 个套件，148+ 测例）
    ├── agents/
    ├── config/
    ├── filter/
    ├── github/
    ├── orchestrator/
    ├── parser/
    ├── reporter/
    └── server/
```

---

## 📄 许可说明

本项目遵循 [MIT License](LICENSE) 开源协议。
