# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Main App (Next.js)
```bash
npm run dev      # Start dev server at localhost:3000
npm run build    # Production build
npm run start    # Start production server
npm run lint     # Run ESLint
```

### Database
```bash
npx prisma migrate dev          # Apply migrations and regenerate client
npx prisma migrate dev --name <name>  # Create named migration
npx prisma generate             # Regenerate Prisma client after schema changes
npx prisma studio               # Open Prisma Studio GUI
```

### Worker (separate process, run from /worker directory)
```bash
cd worker && npm run first-login   # First-time: log in to 即梦 and save browser session
cd worker && npm start             # Start the BullMQ video generation worker
```

## Environment Variables

Required in `.env.local` (see `.env.local.example`):
- `DATABASE_URL` — PostgreSQL connection string
- `NEXTAUTH_SECRET` — JWT signing key (generate with `openssl rand -base64 32`)
- `NEXTAUTH_URL` — App base URL (e.g., `http://localhost:3000`)
- `GEMINI_API_KEY` — Google AI Studio API key (used for Gemini 2.5 Flash)
- `REDIS_URL` — Redis connection string (for BullMQ)
- `UPLOAD_DIR` — Server-side path for uploaded/generated files (e.g., `./uploads`)

## Architecture

### Two-Process System

This app runs as two separate processes:

1. **Next.js app** (`npm run dev`) — handles all web UI, API routes, authentication, and job dispatch
2. **Worker** (`worker/npm start`) — a standalone Node.js process that consumes BullMQ jobs from Redis, uses Playwright to automate the 即梦 (Jimeng/Seedance) video generation platform, and saves results to disk and the database

### Request Flow

```
User → Next.js Frontend → API Routes → Prisma (Postgres)
                                     ↓
                               BullMQ Queue (Redis)
                                     ↓
                               Worker Process
                                     ↓
                         Playwright → 即梦 website
                                     ↓
                          /uploads/videos/ + DB update
```

### AI Skills Pipeline

The core business logic lives in `src/skills/`. Each skill calls the Gemini 2.5 Flash API:

| Skill | File | Purpose |
|-------|------|---------|
| `brand-analyzer` | `src/skills/brand-analyzer.ts` | Extract brand profile from uploads + text |
| `strategy-planner` | `src/skills/strategy-planner.ts` | Generate content matrix + keyword pool |
| `seedance-prompter` | `src/skills/seedance-prompter.ts` | Generate video prompts + voiceover scripts (SCELA formula) |
| `compliance-checker` | `src/skills/compliance-checker.ts` | Flag prompts for content compliance |
| `job-dispatcher` | `src/skills/job-dispatcher.ts` | Push approved prompts to Redis queue |

Skills are registered in `src/skills/registry.ts` and orchestrated via `src/agent/orchestrator.ts`.

### Database Schema (Prisma)

Key entities and relationships:
- `Merchant` → `BrandProfile` (1:many) → `VideoStrategy` (1:many) → `Prompt` (1:many) → `VideoJob` (1:1)
- `VideoJob.status`: `QUEUED → PROCESSING → COMPLETED | FAILED | NEEDS_REVIEW`
- `Prompt.complianceStatus`: `PENDING | APPROVED | NEEDS_REVIEW | REJECTED`
- Schema at `prisma/schema.prisma`

### Route Groups

- `/(auth)` — `/login`, `/register` — unauthenticated
- `/(dashboard)` — all other pages — protected by NextAuth middleware (`src/middleware.ts`)

### Key Directories

- `src/app/api/` — API route handlers (Next.js App Router)
- `src/skills/` — Gemini AI skill definitions
- `src/agent/` — Orchestrator for multi-step AI pipelines
- `src/lib/` — Shared utilities: `db.ts` (Prisma), `queue.ts` (BullMQ), `gemini.ts` (Google AI), `auth.ts` (NextAuth)
- `src/components/` — Shared React components (shadcn/ui based)
- `worker/` — Independent Node.js process with its own `package.json`
- `uploads/` — Runtime file storage for user uploads and generated videos

### Worker Session Management

The Playwright worker persists browser session state to `.jimeng-session/` (gitignored). Run `npm run first-login` from the `worker/` directory once to authenticate. Subsequent `npm start` runs reuse the saved session.
