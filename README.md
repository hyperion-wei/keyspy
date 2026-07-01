<div align="center">

<img src="public/favicon.png" alt="KeySpy Logo" width="80" />

# KeySpy

**AI API Key 泄露检测与可用性监控平台**

**AI API Key Leak Detection & Availability Monitoring Platform**

[**🇨🇳 中文**](#lang-zh) &nbsp;|&nbsp; [**🇺🇸 English**](#lang-en)

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-16-black?style=flat-square&logo=next.js)
![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-3-003B57?style=flat-square&logo=sqlite&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-38B2AC?style=flat-square&logo=tailwindcss&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)

</div>

---

<div id="lang-zh"></div>

# 中文

KeySpy 是一款自托管的 AI API Key 安全审计平台，集成了**敏感信息扫描（Hunt）**、**API 可用性监控**、**批量模型测试**等核心能力，帮助安全团队和开发者发现并管理互联网上泄露的大模型 API 密钥。

> 🌐 [Switch to English](#lang-en)

## 功能概览

| 模块 | 功能 | 说明 |
|------|------|------|
| **Hunt 扫描** | 全网敏感信息发现 | 自动爬取目标站点文件，通过 gitleaks + AI 双重引擎检测 API Key、密码、数据库连接串等泄露 |
| **Hunt 结果管理** | 扫描结果批量测试/删除 | 对发现的 Key 进行一键可用性测试，自动识别 Provider 和 Model |
| **API 监控** | LLM API 可用性监控 | 定时检测 OpenAI / Anthropic / Gemini 等 API 端点的响应状态 |
| **批量测试** | 多模型并发测试 | 支持批量添加监控配置，一键测试全部 API 可用性 |
| **模板管理** | 监控配置模板 | 创建可复用的监控模板，快速批量部署 |
| **LLM 管理** | AI 模型配置 | 管理 Chat 模型（用于 AI 辅助分析），支持多 Provider |
| **分组视图** | 按 Provider 分组 | 按厂商维度查看监控状态和可用性趋势 |
| **账户管理** | 多用户 + 角色控制 | 管理员/普通用户角色隔离 |

## 核心特色

> **真实 API 调用验证，而非简单的端口连通检测**

区别于仅验证 HTTP 200 状态码的工具，KeySpy 会对发现的每个 API Key 发起**真实的 LLM 推理请求**，确认密钥背后确实存在可用的大模型服务：

- **Say Hello 验证** — 向目标 API 发送 `"Say hello in exactly one word."` 指令，只有模型**真实返回响应**才算密钥可用，HTTP 200 但无内容的假端点将被准确排除
- **全模板模型遍历** — 测试一个 Key 时，自动遍历系统中**所有内置模板的全部模型列表**（default_model + 备选模型），深度挖掘该 Key 能调用哪些厂商、哪些模型，第一个成功的模型即标记该模板可用
- **多 URL 格式自动探测** — 对每个目标 Base URL，自动尝试多种路径格式（`/v1/chat/completions`、`/chat/completions`、已知厂商专属路径等），确保不因 URL 拼接问题漏报
- **智能挑战验证（可选）** — 通过随机生成的「语言理解挑战」（分类选择题 / 阅读理解大海捞针），验证 API 端点背后是**真实的 LLM** 而非伪装的代理服务器
- **推理模型兼容** — 自动剥离 DeepSeek-R1、QwQ 等推理模型的 `<think>` 标签内容，确保对思考型模型的正确判定

```
                    发现 API Key
                         ↓
              ┌──── 测试单个 Key ────┐
              │                      │
              ▼                      ▼
       遍历候选 URL 格式       遍历所有模板
       (/v1/chat/completions    (OpenAI / Anthropic /
        /chat/completions        Gemini / DeepSeek /
        厂商专属路径...)          MiniMax / 通义千问...)
              │                      │
              ▼                      ▼
        发送真实推理请求       遍历模板内全部模型
        "Say hello..."         (default + fallbacks)
              │                      │
              ▼                      ▼
        模型真实返回响应?       找到第一个成功模型
        ──────────────          即标记该模板可用
        ✅ 真实 LLM 响应
        ❌ 假端点 / 无内容
```

## 截图

### 登录

<div align="center">
  <img src="docs/screenshots/01-login.png" alt="登录页面" width="700" />
  <p><em>简洁的登录界面，支持安全的会话管理</em></p>
</div>

### 仪表盘

<div align="center">
  <img src="docs/screenshots/02-dashboard.png" alt="仪表盘" width="700" />
  <p><em>实时监控所有 API 端点的状态、延迟和活跃模型指标</em></p>
</div>

### 密钥扫描 (Hunt)

<div align="center">
  <img src="docs/screenshots/03-hunt.png" alt="Hunt 扫描" width="700" />
  <p><em>扫描代码库中的泄露 API Key，实时验证可用性，一键加入监控</em></p>
</div>

### 监控管理

<div align="center">
  <img src="docs/screenshots/04-manage.png" alt="监控管理" width="700" />
  <p><em>基于模板批量创建监控，自动检测可用模型，支持降级链</em></p>
</div>

### 模板管理

<div align="center">
  <img src="docs/screenshots/05-templates.png" alt="模板管理" width="700" />
  <p><em>内置主流 LLM 厂商模板，可自定义模型列表和端点</em></p>
</div>

### 账户管理

<div align="center">
  <img src="docs/screenshots/06-accounts.png" alt="账户管理" width="700" />
  <p><em>管理员专属的用户管理，支持角色分配和密码管理</em></p>
</div>

## 技术架构

```
┌─────────────────────────────────────────────────┐
│                  Next.js 全栈                     │
├─────────────────────┬───────────────────────────┤
│     前端 (React)     │       后端 (API Routes)    │
│  - Tailwind + shadcn│  - gitleaks 扫描引擎       │
│  - 暗色/亮色主题     │  - AI 分析 (Vercel AI SDK) │
│  - 响应式布局        │  - SQLite 持久化存储       │
│  - 实时状态更新      │  - Session Cookie 认证     │
└─────────────────────┴───────────────────────────┘
```

### 技术栈

- **框架**: Next.js 16 (Turbopack)
- **UI**: React 19 + Tailwind CSS 4 + shadcn/ui + Radix UI
- **数据库**: SQLite (better-sqlite3)
- **扫描引擎**: gitleaks + 自定义增强规则
- **AI 分析**: Vercel AI SDK（支持 OpenAI / Anthropic / Google）
- **测试框架**: Vitest

### 支持的 LLM Provider

| Provider | 识别特征 |
|----------|---------|
| OpenAI | `sk-` 前缀, `openai.com` |
| Anthropic | `sk-ant-` 前缀, `anthropic.com` |
| Google (Gemini) | `AIza` 前缀 |
| MiniMax | `sk-cp-` 前缀, `minimaxi.com` |
| 通义千问 (DashScope) | `sk-` 前缀, `dashscope` / `bailian` |
| 火山引擎 (Volcengine) | UUID 格式, `volces.com` |
| SiliconFlow | `siliconflow` 关键词 |
| DeepSeek | `deepseek` 关键词 |
| 百川 / Moonshot / 智谱 / 零一万物 / StepFun | 上下文关键词匹配 |

## 快速开始

### 环境要求

- Node.js >= 18
- pnpm >= 10
- gitleaks（已内置于 `tools/gitleaks/`）

### 安装与运行

```bash
# 克隆仓库
git clone https://github.com/hyperion-wei/keyspy.git
cd keyspy

# 安装依赖
pnpm install

# 开发模式
pnpm dev

# 构建
pnpm build

# 生产启动
pnpm start

# 运行测试
pnpm test
```

打开 [http://localhost:3000](http://localhost:3000)

### Docker

```bash
docker build -t keyspy .
docker run -p 3000:3000 keyspy
```

### 默认账户

| 用户名 | 密码 | 角色 |
|--------|------|------|
| admin | admin123 | 管理员 |

> 首次登录后请立即修改密码。

## 项目结构

```
keyspy/
├── app/
│   ├── api/                 # API 路由
│   │   ├── auth/            # 认证（登录/登出/会话）
│   │   ├── hunt/            # Hunt 扫描引擎
│   │   │   ├── scan/        # 扫描任务（爬取+gitleaks+AI分析）
│   │   │   ├── results/     # 扫描结果查询
│   │   │   ├── tasks/       # 任务状态查询
│   │   │   ├── test/        # 单 Key 可用性测试
│   │   │   └── test-all/    # 批量测试
│   │   ├── monitors/        # 监控配置 CRUD
│   │   ├── templates/       # 模板管理
│   │   ├── chat/            # AI 对话
│   │   ├── dashboard/       # 仪表盘数据
│   │   └── users/           # 账户管理
│   ├── hunt/                # Hunt 扫描页面
│   ├── manage/              # 管理页面
│   │   ├── accounts/        # 账户管理
│   │   ├── llm/             # LLM 配置管理
│   │   └── templates/       # 模板管理
│   ├── group/[groupName]/   # 分组视图
│   └── login/               # 登录页
├── components/              # UI 组件
├── lib/                     # 核心库
│   ├── db.ts                # SQLite 数据库
│   ├── auth.ts              # 认证逻辑
│   ├── checker.ts           # API 可用性检测
│   └── poller.ts            # 定时轮询
├── tools/gitleaks/          # gitleaks 引擎 + 增强规则
├── data/                    # SQLite 数据库文件
└── test-screens/            # 测试截图
```

## 核心流程

### Hunt 扫描流程

```
目标 URL
  ↓
1. 爬取下载文件（crawlAndDownload）
  ↓
2. gitleaks 默认规则扫描 + 增强规则扫描（JSON apiKey / 连接串 / 密码等）
  ↓
3. 结果合并去重（mergeAndFilterReports）
  ↓
4. 结果映射（mapToFindings）→ 过滤短匹配
  ↓
5. 分类识别（classifyFinding）
   - 已知 Provider → 高置信度
   - 上下文推断 → 中置信度
   - 前缀/UUID 回退 → 中/低置信度
  ↓
6. 同文件聚合 + 按 Key 去重
  ↓
7. AI 分析（analyzeFindings）→ 补充 model / base_url
  ↓
8. 存储到数据库
```

### 监控流程

```
定时任务（poller）
  ↓
检测各 API 端点响应
  ↓
记录状态 → 更新仪表盘 → 异常告警
```

## 环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `PORT` | 服务端口 | 3000 |
| `DATABASE_PATH` | SQLite 数据库路径 | `./data/app.db` |
| `SESSION_SECRET` | 自定义会话密钥 | 自动生成 |
| `NEXT_DISABLE_STANDALONE` | 禁用 standalone 输出 | - |
| `NEXT_PUBLIC_BASE_URL` | 公开访问地址（SEO 用） | - |

## API 端点

| 方法 | 端点 | 说明 |
|------|------|------|
| POST | `/api/auth` | 登录/登出 |
| GET | `/api/dashboard` | 仪表盘数据 |
| POST | `/api/monitors` | 创建监控（单个/批量） |
| GET | `/api/monitors` | 获取所有监控 |
| POST | `/api/hunt/scan` | 发起扫描 |
| POST | `/api/hunt/test` | 测试单个 Key |
| POST | `/api/hunt/test-all` | 批量测试 Key |
| GET | `/api/templates` | 获取模板列表 |
| GET/POST/PUT/DELETE | `/api/users` | 账户管理（仅管理员） |

## 版本历史

详见 [CHANGELOG.md](./CHANGELOG.md)

## License

MIT

<p align="right"><a href="#lang-en">🌐 Switch to English</a> · <a href="#lang-zh">⬆ 返回顶部</a></p>

---

<div id="lang-en"></div>

# English

KeySpy is a self-hosted AI API Key security audit platform that integrates **sensitive information scanning (Hunt)**, **API availability monitoring**, and **batch model testing** to help security teams and developers discover and manage leaked LLM API keys on the internet.

> 🇨🇳 [切换到中文](#lang-zh)

## Features Overview

| Module | Feature | Description |
|--------|---------|-------------|
| **Hunt Scanner** | Sensitive info discovery | Automatically crawls target site files, detecting API Keys, passwords, connection strings via gitleaks + AI dual engine |
| **Hunt Results** | Batch test/delete | One-click availability testing for discovered keys, auto-identifying Provider and Model |
| **API Monitoring** | LLM API availability | Periodic detection of OpenAI / Anthropic / Gemini API endpoint response status |
| **Batch Testing** | Multi-model concurrent | Batch add monitoring configs, one-click test all API availability |
| **Templates** | Monitoring templates | Create reusable monitoring templates for rapid batch deployment |
| **LLM Management** | AI model config | Manage Chat models (for AI-assisted analysis), multi-Provider support |
| **Group View** | By Provider | View monitoring status and availability trends by vendor |
| **Accounts** | Multi-user + roles | Admin/user role-based access control |

## Highlights

> **Real API call validation — not just HTTP 200 checks**

Unlike tools that merely verify HTTP 200 status codes, KeySpy issues **real LLM inference requests** to confirm that a discovered API key actually powers a working language model:

- **Say Hello Validation** — Sends `"Say hello in exactly one word."` to each target API; only counts the key as usable when the model **actually returns a response**, accurately filtering out fake endpoints that respond with 200 but no content
- **Full Template Model Traversal** — When testing a single key, KeySpy automatically iterates through **every model in every built-in template** (default model + all fallback models), deeply mining which providers and models the key can access; the first successful model marks that template as usable
- **Multi-URL Format Auto-Probing** — For each target Base URL, automatically tries multiple path formats (`/v1/chat/completions`, `/chat/completions`, known provider-specific paths, etc.) to ensure no valid endpoint is missed due to URL concatenation issues
- **Intelligent Challenge Verification (optional)** — Randomly generated "language understanding challenges" (category selection / reading comprehension needle-in-a-haystack) verify the endpoint is a **genuine LLM** rather than a disguised proxy server
- **Reasoning Model Compatibility** — Automatically strips `<think>` tags from reasoning models (DeepSeek-R1, QwQ, etc.) to ensure correct validation of thinking-capable models

```
                 Discovered API Key
                         ↓
              ┌──── Test Single Key ────┐
              │                         │
              ▼                         ▼
       Probe URL formats         Traverse all templates
       (/v1/chat/completions     (OpenAI / Anthropic /
        /chat/completions         Gemini / DeepSeek /
        provider-specific...)      MiniMax / DashScope...)
              │                         │
              ▼                         ▼
        Send real inference      Try every model in
        request "Say hello..."   template (default +
              │                  all fallbacks)
              ▼                         ▼
        Model returns real       First success marks
        response?                template as usable
        ──────────────
        ✅ Genuine LLM response
        ❌ Fake endpoint / no content
```

## Screenshots

### Login

<div align="center">
  <img src="docs/screenshots/01-login.png" alt="Login Page" width="700" />
  <p><em>Clean, minimal login interface with secure session management</em></p>
</div>

### Dashboard

<div align="center">
  <img src="docs/screenshots/02-dashboard.png" alt="Dashboard" width="700" />
  <p><em>Real-time overview of all monitored API endpoints with status, latency, and active model indicators</em></p>
</div>

### Key Leak Scanner (Hunt)

<div align="center">
  <img src="docs/screenshots/03-hunt.png" alt="Hunt Scanner" width="700" />
  <p><em>Scan codebases for leaked API keys, validate them live, and add working keys to monitoring</em></p>
</div>

### Monitor Management

<div align="center">
  <img src="docs/screenshots/04-manage.png" alt="Manage Monitors" width="700" />
  <p><em>Configure monitoring with template-based batch creation, automatic model detection, and fallback chains</em></p>
</div>

### Template Management

<div align="center">
  <img src="docs/screenshots/05-templates.png" alt="Templates" width="700" />
  <p><em>Built-in templates for major LLM providers with customizable model lists and endpoints</em></p>
</div>

### Account Management

<div align="center">
  <img src="docs/screenshots/06-accounts.png" alt="Accounts" width="700" />
  <p><em>Admin-only user management with role assignment and password management</em></p>
</div>

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  Next.js Full-Stack               │
├─────────────────────┬───────────────────────────┤
│     Frontend         │       Backend (API Routes)  │
│  - Tailwind + shadcn│  - gitleaks scan engine    │
│  - Dark/light themes│  - AI analysis (Vercel AI)  │
│  - Responsive layout│  - SQLite persistent store  │
│  - Real-time updates│  - Session Cookie auth      │
└─────────────────────┴───────────────────────────┘
```

### Tech Stack

- **Framework**: Next.js 16 (Turbopack)
- **UI**: React 19 + Tailwind CSS 4 + shadcn/ui + Radix UI
- **Database**: SQLite (better-sqlite3)
- **Scan Engine**: gitleaks + custom enhanced rules
- **AI Analysis**: Vercel AI SDK (OpenAI / Anthropic / Google)
- **Testing**: Vitest

### Supported LLM Providers

| Provider | Detection Patterns |
|----------|---------|
| OpenAI | `sk-` prefix, `openai.com` |
| Anthropic | `sk-ant-` prefix, `anthropic.com` |
| Google (Gemini) | `AIza` prefix |
| MiniMax | `sk-cp-` prefix, `minimaxi.com` |
| DashScope (Qwen) | `sk-` prefix, `dashscope` / `bailian` |
| Volcengine | UUID format, `volces.com` |
| SiliconFlow | `siliconflow` keyword |
| DeepSeek | `deepseek` keyword |
| Baichuan / Moonshot / Zhipu / Yi / StepFun | Context keyword matching |

## Quick Start

### Prerequisites

- Node.js >= 18
- pnpm >= 10
- gitleaks (bundled in `tools/gitleaks/`)

### Installation

```bash
# Clone the repository
git clone https://github.com/hyperion-wei/keyspy.git
cd keyspy

# Install dependencies
pnpm install

# Development mode
pnpm dev

# Build
pnpm build

# Production start
pnpm start

# Run tests
pnpm test
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Docker

```bash
docker build -t keyspy .
docker run -p 3000:3000 keyspy
```

### Default Credentials

| Username | Password | Role |
|----------|----------|------|
| admin | admin123 | Administrator |

> Change the default password immediately after first login.

## Project Structure

```
keyspy/
├── app/
│   ├── api/                 # API route handlers
│   │   ├── auth/            # Authentication (login/logout/session)
│   │   ├── hunt/            # Hunt scan engine
│   │   │   ├── scan/        # Scan tasks (crawl + gitleaks + AI)
│   │   │   ├── results/     # Scan result queries
│   │   │   ├── tasks/       # Task status queries
│   │   │   ├── test/        # Single key availability test
│   │   │   └── test-all/    # Batch testing
│   │   ├── monitors/        # Monitor CRUD
│   │   ├── templates/       # Template management
│   │   ├── chat/            # AI conversation
│   │   ├── dashboard/       # Dashboard data
│   │   └── users/           # Account management
│   ├── hunt/                # Hunt scanner UI
│   ├── manage/              # Management pages
│   │   ├── accounts/        # Account management
│   │   ├── llm/             # LLM config management
│   │   └── templates/       # Template management
│   ├── group/[groupName]/   # Group view
│   └── login/               # Login page
├── components/              # UI components
├── lib/                     # Core libraries
│   ├── db.ts                # SQLite database
│   ├── auth.ts              # Authentication logic
│   ├── checker.ts           # API availability checker
│   └── poller.ts            # Scheduled polling
├── tools/gitleaks/          # gitleaks engine + enhanced rules
├── data/                    # SQLite database files
└── test-screens/            # Test screenshots
```

## Core Workflows

### Hunt Scan Workflow

```
Target URL
  ↓
1. Crawl and download files (crawlAndDownload)
  ↓
2. gitleaks default rules + enhanced rules scan (JSON apiKey / connection strings / passwords)
  ↓
3. Merge and deduplicate results (mergeAndFilterReports)
  ↓
4. Map to findings (mapToFindings) → filter short matches
  ↓
5. Classify (classifyFinding)
   - Known Provider → high confidence
   - Context inference → medium confidence
   - Prefix/UUID fallback → medium/low confidence
  ↓
6. Same-file aggregation + dedup by Key
  ↓
7. AI analysis (analyzeFindings) → enrich model / base_url
  ↓
8. Store to database
```

### Monitoring Workflow

```
Scheduled task (poller)
  ↓
Detect API endpoint responses
  ↓
Record status → Update dashboard → Alert on anomalies
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | 3000 |
| `DATABASE_PATH` | SQLite database path | `./data/app.db` |
| `SESSION_SECRET` | Custom session secret | Auto-generated |
| `NEXT_DISABLE_STANDALONE` | Disable standalone output | - |
| `NEXT_PUBLIC_BASE_URL` | Public URL (for SEO) | - |

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth` | Login/Logout |
| GET | `/api/dashboard` | Dashboard data |
| POST | `/api/monitors` | Create monitor (single/batch) |
| GET | `/api/monitors` | List all monitors |
| POST | `/api/hunt/scan` | Scan for leaked keys |
| POST | `/api/hunt/test` | Test single key |
| POST | `/api/hunt/test-all` | Test key against all templates |
| GET | `/api/templates` | List templates |
| GET/POST/PUT/DELETE | `/api/users` | Account management (admin only) |

## Changelog

See [CHANGELOG.md](./CHANGELOG.md)

## License

MIT

<p align="right"><a href="#lang-zh">🇨🇳 切换到中文</a> · <a href="#lang-en">⬆ Back to Top</a></p>
