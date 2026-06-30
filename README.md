<div align="center">

<img src="public/favicon.png" alt="KeySpy Logo" width="80" />

# KeySpy

**AI API Key Leak Detection & Availability Monitoring Platform**

[Features](#features) · [Screenshots](#screenshots) · [Quick Start](#quick-start) · [Architecture](#architecture) · [Tech Stack](#tech-stack)

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-16-black?style=flat-square&logo=next.js)
![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-3-003B57?style=flat-square&logo=sqlite&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-38B2AC?style=flat-square&logo=tailwindcss&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)

</div>

---

## Overview

KeySpy is a self-hosted platform for detecting leaked AI API keys in codebases and monitoring their availability in real-time. It scans source code, configuration files, and chat histories for exposed keys, validates them against LLM provider APIs, and provides a comprehensive monitoring dashboard with automatic model failover.

## Features

### Key Leak Detection (Hunt)
- **Smart Scanning** — Scans files and directories for AI API key patterns (OpenAI, Anthropic, Gemini, DeepSeek, MiniMax, etc.)
- **AI-Powered Analysis** — Uses LLM to classify found keys as active, inactive, or test keys
- **Concurrent Batch Testing** — Test all discovered keys simultaneously with live API validation
- **Auto Model Detection** — For each key, tests all provider models and identifies which ones work

### Availability Monitoring
- **Real-time Dashboard** — Overview of all monitored API endpoints with status indicators and latency
- **Automatic Failover** — When the primary model fails, automatically falls back to the next available model in the template's model list
- **Template System** — Built-in templates for OpenAI, Anthropic, Gemini, DeepSeek, MiniMax with customizable models
- **Group Management** — Organize monitors by group with per-group dashboards

### Administration
- **Role-Based Access** — Admin and user roles with granular permission control
- **Account Management** — Full user CRUD with admin-only access to sensitive operations
- **Batch Key Import** — Add multiple API keys at once with automatic model availability testing
- **Dark/Light Theme** — Full theme support with system preference detection

### Security
- **Parameterized SQL** — All database queries use parameterized statements to prevent SQL injection
- **Session-Based Auth** — Secure cookie-based authentication with bcrypt password hashing
- **Local-First** — All data stored in local SQLite, no external database required
- **No Open Registration** — Registration disabled by default, admin-managed accounts only

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

## Quick Start

### Prerequisites

- **Node.js** >= 18
- **pnpm** (recommended) or npm

### Installation

```bash
# Clone the repository
git clone https://github.com/hyperion-wei/keyspy.git
cd keyspy

# Install dependencies
pnpm install

# Start development server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

**Default credentials:** `admin` / `admin123`

> Change the default password immediately after first login.

### Production Build

```bash
pnpm build
pnpm start
```

### Docker

```bash
docker build -t keyspy .
docker run -p 3000:3000 keyspy
```

## Architecture

```
keyspy/
├── app/
│   ├── api/                 # API route handlers
│   │   ├── auth/            # Authentication (login/logout/session)
│   │   ├── dashboard/       # Dashboard data aggregation
│   │   ├── hunt/            # Key scanning, testing, and results
│   │   ├── monitors/        # Monitor CRUD + batch creation
│   │   ├── templates/       # Template management
│   │   └── users/           # User administration
│   ├── hunt/                # Key leak scanner UI
│   ├── login/               # Authentication page
│   ├── manage/              # Monitor configuration UI
│   │   ├── accounts/        # User management
│   │   ├── llm/             # LLM chat settings
│   │   └── templates/       # Template editor
│   ├── group/[groupName]/   # Per-group dashboard
│   └── page.tsx             # Main dashboard
├── components/              # Shared UI components
├── lib/
│   ├── db.ts               # SQLite database layer
│   ├── auth.ts             # Authentication utilities
│   ├── checker.ts          # API availability checker
│   ├── test-utils.ts       # Shared model testing functions
│   └── challenge.ts        # Key validation challenges
└── data/                   # SQLite database files
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) |
| UI | React 19, shadcn/ui, Tailwind CSS 4 |
| Database | SQLite (better-sqlite3) |
| Auth | Session cookies + bcryptjs |
| AI SDK | Vercel AI SDK (OpenAI, Anthropic, Gemini) |
| Language | TypeScript |
| Package Manager | pnpm |

## Configuration

### Environment Variables

Create a `.env.local` file:

```bash
# Optional: customize session secret
SESSION_SECRET=your-random-secret-here

# Optional: admin email whitelist (comma-separated)
ADMIN_EMAILS=admin@example.com
```

### Default Admin Account

The admin account (`admin` / `admin123`) is automatically created on first startup. Use the **Account Management** page to create additional users.

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
| GET/POST/PUT/DELETE | `/api/users` | User management (admin only) |

## License

MIT
