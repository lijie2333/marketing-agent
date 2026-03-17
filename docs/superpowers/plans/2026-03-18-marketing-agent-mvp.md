# Marketing Agent MVP Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a full-stack SaaS platform where merchants upload brand materials, AI generates a brand profile + video strategy + 即梦AI prompts in batch, and a Playwright Worker automates video generation on 即梦.

**Architecture:** Next.js 14 App Router (web + API), Gemini Function Calling Agent with a skill registry, BullMQ+Redis task queue, and an independent Playwright Node.js worker service that automates jimeng.jianying.com. Data is isolated per merchant via `merchantId` on all tables.

**Tech Stack:** Next.js 14, TypeScript, Prisma + PostgreSQL, NextAuth.js, Gemini API (`@google/generative-ai`), BullMQ + Redis, Playwright, Shadcn/ui, Tailwind CSS

---

## File Map

```
marketing-agent/
├── prisma/
│   └── schema.prisma                    # All DB models
├── src/
│   ├── app/
│   │   ├── layout.tsx                   # Root layout
│   │   ├── (auth)/
│   │   │   ├── login/page.tsx           # Login page
│   │   │   └── register/page.tsx        # Register page
│   │   ├── (dashboard)/
│   │   │   ├── layout.tsx               # Dashboard shell + nav
│   │   │   ├── onboarding/page.tsx      # 4-step onboarding wizard
│   │   │   ├── profile/page.tsx         # View/edit brand profile
│   │   │   ├── strategy/page.tsx        # Content matrix + batch settings
│   │   │   ├── prompts/page.tsx         # Prompt list: preview/edit/confirm
│   │   │   ├── jobs/page.tsx            # Job queue status
│   │   │   └── library/page.tsx         # Video results
│   │   └── api/
│   │       ├── auth/[...nextauth]/route.ts   # NextAuth handler
│   │       ├── upload/route.ts               # File upload endpoint
│   │       ├── agent/run/route.ts            # Trigger agent pipeline
│   │       ├── prompts/route.ts              # List/update prompts
│   │       ├── prompts/confirm/route.ts      # Confirm + dispatch batch
│   │       └── jobs/route.ts                 # Job status + retry
│   ├── lib/
│   │   ├── auth.ts                      # NextAuth config (email/password)
│   │   ├── db.ts                        # Prisma singleton
│   │   ├── gemini.ts                    # Gemini client singleton
│   │   └── queue.ts                     # BullMQ queue + connection
│   ├── agent/
│   │   └── orchestrator.ts              # Gemini multi-turn tool-call loop
│   ├── skills/
│   │   ├── registry.ts                  # SkillRegistry class
│   │   ├── brand-analyzer.ts            # Gemini Vision: extract brand info
│   │   ├── strategy-planner.ts          # Generate content matrix
│   │   ├── seedance-prompter.ts         # SCELA prompt generation
│   │   ├── compliance-checker.ts        # Flag violations
│   │   └── job-dispatcher.ts            # Push to BullMQ
│   └── components/
│       ├── onboarding/
│       │   ├── StepBasicInfo.tsx
│       │   ├── StepUpload.tsx
│       │   ├── StepQuestionnaire.tsx
│       │   └── StepProfile.tsx
│       └── ui/                          # Shadcn components (auto-generated)
└── worker/                              # Independent Playwright service
    ├── package.json                     # Separate from main app
    ├── index.ts                         # Worker entry point
    ├── jimeng.ts                        # 即梦 browser automation
    └── downloader.ts                    # Video URL extraction
```

---

## Task 1: Project Bootstrap

**Files:**
- Create: `package.json`, `tsconfig.json`, `tailwind.config.ts`, `.env.local.example`
- Create: `src/app/layout.tsx`

- [ ] **Step 1.1: Initialize Next.js project**

```bash
cd "/Users/lijie/lijie agent project/marketing agent"
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --yes
```

- [ ] **Step 1.2: Install core dependencies**

```bash
npm install @prisma/client prisma
npm install next-auth@beta @auth/prisma-adapter
npm install @google/generative-ai
npm install bullmq ioredis
npm install bcryptjs
npm install -D @types/bcryptjs
```

- [ ] **Step 1.3: Install Shadcn/ui**

```bash
npx shadcn@latest init --defaults
npx shadcn@latest add button input label card textarea badge progress toast
```

- [ ] **Step 1.4: Create `.env.local.example`**

```env
DATABASE_URL="postgresql://user:password@localhost:5432/marketing_agent"
NEXTAUTH_SECRET="generate-with-openssl-rand-base64-32"
NEXTAUTH_URL="http://localhost:3000"
GEMINI_API_KEY="your-gemini-api-key"
REDIS_URL="redis://localhost:6379"
UPLOAD_DIR="./uploads"
```

Copy to `.env.local` and fill in real values.

- [ ] **Step 1.5: Commit**

```bash
git init
git add -A
git commit -m "chore: bootstrap Next.js project with dependencies"
```

---

## Task 2: Database Schema

**Files:**
- Create: `prisma/schema.prisma`

- [ ] **Step 2.1: Initialize Prisma**

```bash
npx prisma init --datasource-provider postgresql
```

- [ ] **Step 2.2: Write schema**

Replace `prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Merchant {
  id            String         @id @default(cuid())
  name          String
  email         String         @unique
  passwordHash  String
  brandProfiles BrandProfile[]
  sessions      Session[]
  createdAt     DateTime       @default(now())
}

model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  merchantId   String
  merchant     Merchant @relation(fields: [merchantId], references: [id], onDelete: Cascade)
  expires      DateTime
}

model BrandProfile {
  id                   String          @id @default(cuid())
  merchantId           String
  merchant             Merchant        @relation(fields: [merchantId], references: [id], onDelete: Cascade)
  brandPersonality     String
  coreSellingPoints    String[]
  targetAudience       String
  recommendedStyles    String[]
  videoTone            String
  complianceNotes      String[]
  uploadedFileUrls     String[]
  questionnaireAnswers Json
  regenerationCount    Int             @default(0)
  strategies           VideoStrategy[]
  createdAt            DateTime        @default(now())
  updatedAt            DateTime        @updatedAt
}

model VideoStrategy {
  id             String        @id @default(cuid())
  brandProfileId String
  brandProfile   BrandProfile  @relation(fields: [brandProfileId], references: [id], onDelete: Cascade)
  contentMatrix  Json
  keywordPool    Json
  prompts        Prompt[]
  createdAt      DateTime      @default(now())
}

model Prompt {
  id               String           @id @default(cuid())
  strategyId       String
  strategy         VideoStrategy    @relation(fields: [strategyId], references: [id], onDelete: Cascade)
  content          String
  duration         Int
  ratio            String
  style            String
  direction        String
  complianceStatus ComplianceStatus @default(PENDING)
  isConfirmed      Boolean          @default(false)
  videoJob         VideoJob?
  createdAt        DateTime         @default(now())
  updatedAt        DateTime         @updatedAt
}

model VideoJob {
  id           String    @id @default(cuid())
  promptId     String    @unique
  prompt       Prompt    @relation(fields: [promptId], references: [id], onDelete: Cascade)
  status       JobStatus @default(QUEUED)
  workerId     String?
  retryCount   Int       @default(0)
  maxRetries   Int       @default(3)
  resultUrl    String?
  errorMessage String?
  startedAt    DateTime?
  completedAt  DateTime?
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
}

enum ComplianceStatus {
  PENDING
  APPROVED
  NEEDS_REVIEW
  REJECTED
}

enum JobStatus {
  QUEUED
  PROCESSING
  COMPLETED
  FAILED
  NEEDS_REVIEW
}
```

- [ ] **Step 2.3: Run migration**

```bash
npx prisma migrate dev --name init
npx prisma generate
```

Expected: Migration applied, Prisma Client generated.

- [ ] **Step 2.4: Create Prisma singleton**

Create `src/lib/db.ts`:

```typescript
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const db =
  globalForPrisma.prisma ||
  new PrismaClient({ log: ["error"] });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
```

- [ ] **Step 2.5: Commit**

```bash
git add prisma/ src/lib/db.ts
git commit -m "feat: add database schema and Prisma client"
```

---

## Task 3: Authentication

**Files:**
- Create: `src/lib/auth.ts`
- Create: `src/app/api/auth/[...nextauth]/route.ts`
- Create: `src/app/(auth)/login/page.tsx`
- Create: `src/app/(auth)/register/page.tsx`

- [ ] **Step 3.1: Write NextAuth config**

Create `src/lib/auth.ts`:

```typescript
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { db } from "@/lib/db";
import bcrypt from "bcryptjs";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        const merchant = await db.merchant.findUnique({
          where: { email: credentials.email as string },
        });
        if (!merchant) return null;
        const valid = await bcrypt.compare(
          credentials.password as string,
          merchant.passwordHash
        );
        if (!valid) return null;
        return { id: merchant.id, email: merchant.email, name: merchant.name };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) token.id = user.id;
      return token;
    },
    session({ session, token }) {
      session.user.id = token.id as string;
      return session;
    },
  },
  pages: { signIn: "/login" },
});
```

- [ ] **Step 3.2: Create auth API route**

Create `src/app/api/auth/[...nextauth]/route.ts`:

```typescript
import { handlers } from "@/lib/auth";
export const { GET, POST } = handlers;
```

- [ ] **Step 3.3: Create register API**

Create `src/app/api/auth/register/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import bcrypt from "bcryptjs";

export async function POST(req: Request) {
  const { name, email, password } = await req.json();
  if (!name || !email || !password) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }
  const exists = await db.merchant.findUnique({ where: { email } });
  if (exists) {
    return NextResponse.json({ error: "Email already registered" }, { status: 409 });
  }
  const passwordHash = await bcrypt.hash(password, 12);
  const merchant = await db.merchant.create({
    data: { name, email, passwordHash },
  });
  return NextResponse.json({ id: merchant.id }, { status: 201 });
}
```

- [ ] **Step 3.4: Create login and register pages**

Create `src/app/(auth)/login/page.tsx` — a form with email/password that calls `signIn("credentials", ...)`.

Create `src/app/(auth)/register/page.tsx` — a form that POSTs to `/api/auth/register` then redirects to `/login`.

(Use Shadcn `Card`, `Input`, `Button` components. Basic form, no extra validation.)

- [ ] **Step 3.5: Add middleware to protect dashboard routes**

Create `src/middleware.ts`:

```typescript
import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const isDashboard = req.nextUrl.pathname.startsWith("/onboarding") ||
    req.nextUrl.pathname.startsWith("/profile") ||
    req.nextUrl.pathname.startsWith("/strategy") ||
    req.nextUrl.pathname.startsWith("/prompts") ||
    req.nextUrl.pathname.startsWith("/jobs") ||
    req.nextUrl.pathname.startsWith("/library");
  if (isDashboard && !isLoggedIn) {
    return NextResponse.redirect(new URL("/login", req.nextUrl));
  }
});

export const config = { matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"] };
```

- [ ] **Step 3.6: Commit**

```bash
git add src/lib/auth.ts src/app/api/auth/ src/app/(auth)/ src/middleware.ts
git commit -m "feat: add NextAuth email/password authentication"
```

---

## Task 4: Skill Registry & Agent Orchestrator

**Files:**
- Create: `src/skills/registry.ts`
- Create: `src/agent/orchestrator.ts`
- Create: `src/lib/gemini.ts`

- [ ] **Step 4.1: Create Gemini client singleton**

Create `src/lib/gemini.ts`:

```typescript
import { GoogleGenerativeAI } from "@google/generative-ai";

const globalForGemini = globalThis as unknown as { gemini: GoogleGenerativeAI };

export const gemini =
  globalForGemini.gemini ||
  new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

if (process.env.NODE_ENV !== "production") globalForGemini.gemini = gemini;
```

- [ ] **Step 4.2: Write Skill Registry**

Create `src/skills/registry.ts`:

```typescript
export interface SkillDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
  handler: (params: Record<string, unknown>) => Promise<unknown>;
}

class SkillRegistry {
  private skills = new Map<string, SkillDefinition>();

  register(skill: SkillDefinition) {
    this.skills.set(skill.name, skill);
  }

  getAll(): SkillDefinition[] {
    return Array.from(this.skills.values());
  }

  async invoke(name: string, params: Record<string, unknown>): Promise<unknown> {
    const skill = this.skills.get(name);
    if (!skill) throw new Error(`Skill not found: ${name}`);
    return skill.handler(params);
  }

  toGeminiTools() {
    return [
      {
        functionDeclarations: this.getAll().map((s) => ({
          name: s.name,
          description: s.description,
          parameters: s.parameters,
        })),
      },
    ];
  }
}

export const skillRegistry = new SkillRegistry();
```

- [ ] **Step 4.3: Write Agent Orchestrator**

Create `src/agent/orchestrator.ts`:

```typescript
import { gemini } from "@/lib/gemini";
import { skillRegistry } from "@/skills/registry";

const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const MAX_TOOL_RETRIES = 2;

export interface AgentContext {
  systemPrompt: string;
  userMessage: string;
}

export async function runAgent(context: AgentContext): Promise<string> {
  const model = gemini.getGenerativeModel({
    model: "gemini-1.5-pro",
    tools: skillRegistry.toGeminiTools(),
  });

  const chat = model.startChat({
    systemInstruction: context.systemPrompt,
  });

  const deadline = Date.now() + TIMEOUT_MS;
  let response = await chat.sendMessage(context.userMessage);

  while (Date.now() < deadline) {
    const candidate = response.response.candidates?.[0];
    if (!candidate) throw new Error("No candidate in Gemini response");

    const parts = candidate.content.parts;
    const toolCalls = parts.filter((p) => p.functionCall);

    if (toolCalls.length === 0) {
      // Terminal: text response
      return response.response.text();
    }

    // Execute tool calls
    const toolResults = await Promise.all(
      toolCalls.map(async (part) => {
        const call = part.functionCall!;
        let result: unknown;
        let attempts = 0;
        while (attempts <= MAX_TOOL_RETRIES) {
          try {
            result = await skillRegistry.invoke(
              call.name,
              call.args as Record<string, unknown>
            );
            break;
          } catch (err) {
            attempts++;
            if (attempts > MAX_TOOL_RETRIES) {
              result = { error: (err as Error).message };
            }
          }
        }
        return {
          functionResponse: { name: call.name, response: { result } },
        };
      })
    );

    response = await chat.sendMessage(toolResults);
  }

  throw new Error("Agent timeout after 5 minutes");
}
```

- [ ] **Step 4.4: Commit**

```bash
git add src/skills/registry.ts src/agent/orchestrator.ts src/lib/gemini.ts
git commit -m "feat: add skill registry and Gemini agent orchestrator"
```

---

## Task 5: Brand Analyzer Skill

**Files:**
- Create: `src/skills/brand-analyzer.ts`
- Modify: `src/skills/registry.ts` (import and register)

- [ ] **Step 5.1: Write brand-analyzer skill**

Create `src/skills/brand-analyzer.ts`:

```typescript
import { gemini } from "@/lib/gemini";
import { SkillDefinition } from "./registry";

export const brandAnalyzerSkill: SkillDefinition = {
  name: "brand-analyzer",
  description:
    "Analyze uploaded brand files (images, PDFs) and questionnaire answers to extract structured brand profile information.",
  parameters: {
    type: "object",
    properties: {
      fileUrls: {
        type: "string",
        description: "JSON array of uploaded file URLs to analyze",
      },
      questionnaireAnswers: {
        type: "string",
        description: "JSON object of questionnaire question-answer pairs",
      },
      basicInfo: {
        type: "string",
        description: "JSON object with brandName, industry, products, platforms",
      },
    },
    required: ["questionnaireAnswers", "basicInfo"],
  },
  handler: async (params) => {
    const model = gemini.getGenerativeModel({ model: "gemini-1.5-pro" });
    const basicInfo = JSON.parse(params.basicInfo as string);
    const answers = JSON.parse(params.questionnaireAnswers as string);

    const prompt = `
You are a brand strategist. Based on the following merchant information, generate a structured brand profile in JSON.

Brand basic info: ${JSON.stringify(basicInfo)}
Questionnaire answers: ${JSON.stringify(answers)}

Return ONLY valid JSON with this exact structure:
{
  "brandPersonality": "string - 2-3 adjectives describing brand personality",
  "coreSellingPoints": ["array of 3-5 key selling points"],
  "targetAudience": "string - detailed target audience description",
  "recommendedStyles": ["array from: 产品/电商/广告, 生活/治愈/Vlog, 短剧/对白/情感, 舞蹈/MV/卡点, 变身/变装/转场"],
  "videoTone": "string - tone and feel for videos",
  "complianceNotes": ["array of compliance items to watch for"]
}`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Failed to extract JSON from brand analysis");
    return JSON.parse(jsonMatch[0]);
  },
};
```

- [ ] **Step 5.2: Register the skill**

Add to end of `src/skills/registry.ts`:

```typescript
import { brandAnalyzerSkill } from "./brand-analyzer";
// (other imports will be added in later tasks)

skillRegistry.register(brandAnalyzerSkill);
```

- [ ] **Step 5.3: Commit**

```bash
git add src/skills/brand-analyzer.ts src/skills/registry.ts
git commit -m "feat: add brand-analyzer skill with Gemini Vision"
```

---

## Task 6: Strategy Planner & Seedance Prompter Skills

**Files:**
- Create: `src/skills/strategy-planner.ts`
- Create: `src/skills/seedance-prompter.ts`
- Create: `src/skills/compliance-checker.ts`
- Modify: `src/skills/registry.ts`

- [ ] **Step 6.1: Write strategy-planner skill**

Create `src/skills/strategy-planner.ts`:

```typescript
import { gemini } from "@/lib/gemini";
import { SkillDefinition } from "./registry";

export const strategyPlannerSkill: SkillDefinition = {
  name: "strategy-planner",
  description:
    "Generate a video content matrix and keyword pool based on the brand profile.",
  parameters: {
    type: "object",
    properties: {
      brandProfile: {
        type: "string",
        description: "JSON string of the brand profile",
      },
      totalVideos: {
        type: "string",
        description: "Total number of videos to plan for (as string)",
      },
    },
    required: ["brandProfile"],
  },
  handler: async (params) => {
    const model = gemini.getGenerativeModel({ model: "gemini-1.5-flash" });
    const profile = JSON.parse(params.brandProfile as string);
    const total = parseInt((params.totalVideos as string) || "50");

    const prompt = `
You are a short video marketing strategist specializing in Chinese social media (抖音, 小红书, 视频号).

Brand profile: ${JSON.stringify(profile)}
Total videos needed: ${total}

Generate a content matrix. Return ONLY valid JSON:
{
  "contentMatrix": [
    {
      "direction": "direction name in Chinese",
      "description": "what this direction covers",
      "style": "one of the recommendedStyles from brand profile",
      "duration": 10,
      "suggestedCount": 10
    }
  ],
  "keywordPool": {
    "selling": ["selling point keywords"],
    "emotion": ["emotional tone words"],
    "scene": ["scene/setting words"]
  }
}

Ensure suggestedCount values sum to approximately ${total}. Create 3-5 directions.`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Failed to extract strategy JSON");
    return JSON.parse(jsonMatch[0]);
  },
};
```

- [ ] **Step 6.2: Write seedance-prompter skill**

Create `src/skills/seedance-prompter.ts`:

```typescript
import { gemini } from "@/lib/gemini";
import { SkillDefinition } from "./registry";

// SCELA formula rules derived from skills/seedance-bot/SKILL.md
const SCELA_SYSTEM = `
You are an expert 即梦AI (Seedance 2.0) prompt writer. Use the SCELA formula:
- S (Subject): Original virtual character with brand's visual characteristics. Never use real people or copyrighted IPs.
- C (Camera): Specific camera movement (推镜/拉镜/环绕/跟镜/俯拍/仰拍)
- E (Effect): Specific visual effects (not generic "炫酷" but concrete like "金色粒子从手掌飘散")
- L (Light/Look): Color grading + visual quality keywords
- A (Audio): Environment sound + key sound effects on a separate line

Style templates:
- 产品/电商/广告: Focus on product close-ups, clean backgrounds, strong CTA
- 生活/治愈/Vlog: Natural lighting, handheld feel, warm tones
- 短剧/对白/情感: Character-driven, dialogue moments, emotional beats
- 变身/变装/转场: Transformation moment as centerpiece
- 舞蹈/MV/卡点: Beat-sync, dynamic cuts, energy

Compliance rules:
- No real names, no brand trademarks, no political content
- Replace real IPs: keep visual style, remove copyrightable elements
- Output ONLY the prompt text, no explanations
`;

export const seedancePrompterSkill: SkillDefinition = {
  name: "seedance-prompter",
  description:
    "Generate 即梦AI video prompts using the SCELA formula based on brand profile and content direction.",
  parameters: {
    type: "object",
    properties: {
      brandProfile: {
        type: "string",
        description: "JSON string of brand profile",
      },
      direction: {
        type: "string",
        description: "Content direction name",
      },
      style: {
        type: "string",
        description: "Video style (e.g. 产品/电商/广告)",
      },
      duration: {
        type: "string",
        description: "Video duration in seconds (5, 10, or 15)",
      },
      count: {
        type: "string",
        description: "Number of prompts to generate",
      },
      keywordPool: {
        type: "string",
        description: "JSON string of keyword pool",
      },
    },
    required: ["brandProfile", "direction", "style", "duration", "count"],
  },
  handler: async (params) => {
    const model = gemini.getGenerativeModel({ model: "gemini-1.5-flash" });
    const profile = JSON.parse(params.brandProfile as string);
    const keywords = params.keywordPool ? JSON.parse(params.keywordPool as string) : {};
    const count = parseInt(params.count as string);

    const prompt = `
Brand: ${JSON.stringify(profile)}
Direction: ${params.direction}
Style: ${params.style}
Duration: ${params.duration}s
Keywords: ${JSON.stringify(keywords)}

Generate ${count} unique 即梦AI video prompts for this brand. Each prompt should be distinct.

Return ONLY a JSON array of strings, each string is one complete prompt:
["prompt 1 text", "prompt 2 text", ...]

Each prompt must follow SCELA formula and be 80-200 characters in Chinese.`;

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      systemInstruction: SCELA_SYSTEM,
    });

    const text = result.response.text();
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error("Failed to extract prompts JSON");
    const prompts: string[] = JSON.parse(jsonMatch[0]);

    return prompts.map((content) => ({
      content,
      duration: parseInt(params.duration as string),
      ratio: "9:16",
      style: params.style as string,
      direction: params.direction as string,
    }));
  },
};
```

- [ ] **Step 6.3: Write compliance-checker skill**

Create `src/skills/compliance-checker.ts`:

```typescript
import { SkillDefinition } from "./registry";

// Violation patterns (from seedance-bot compliance.md rules)
const VIOLATION_PATTERNS = [
  /[a-zA-Z\u4e00-\u9fa5]+(?:先生|女士|总统|主席)/,  // Real person titles
  /iPhone|Samsung|Nike|Adidas|Louis Vuitton|Gucci/i,   // Brand trademarks
  /钢铁侠|蜘蛛侠|蝙蝠侠|超人|孙悟空|哪吒/,          // Copyrighted IPs (without replacement indicator)
];

export const complianceCheckerSkill: SkillDefinition = {
  name: "compliance-checker",
  description:
    "Check prompts for compliance issues. Flags prompts with real names, copyrighted IPs, or brand trademarks.",
  parameters: {
    type: "object",
    properties: {
      prompts: {
        type: "string",
        description: "JSON array of prompt objects with content field",
      },
    },
    required: ["prompts"],
  },
  handler: async (params) => {
    const prompts = JSON.parse(params.prompts as string) as Array<{
      content: string;
      [key: string]: unknown;
    }>;

    return prompts.map((p) => {
      const hasViolation = VIOLATION_PATTERNS.some((pattern) =>
        pattern.test(p.content)
      );
      return {
        ...p,
        complianceStatus: hasViolation ? "NEEDS_REVIEW" : "APPROVED",
      };
    });
  },
};
```

- [ ] **Step 6.4: Register all three skills**

Update `src/skills/registry.ts` imports and registrations:

```typescript
import { brandAnalyzerSkill } from "./brand-analyzer";
import { strategyPlannerSkill } from "./strategy-planner";
import { seedancePrompterSkill } from "./seedance-prompter";
import { complianceCheckerSkill } from "./compliance-checker";

skillRegistry.register(brandAnalyzerSkill);
skillRegistry.register(strategyPlannerSkill);
skillRegistry.register(seedancePrompterSkill);
skillRegistry.register(complianceCheckerSkill);
```

- [ ] **Step 6.5: Commit**

```bash
git add src/skills/
git commit -m "feat: add strategy-planner, seedance-prompter, compliance-checker skills"
```

---

## Task 7: File Upload API

**Files:**
- Create: `src/app/api/upload/route.ts`

- [ ] **Step 7.1: Write upload endpoint**

```bash
npm install formidable
npm install -D @types/formidable
mkdir -p uploads
```

Create `src/app/api/upload/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

const UPLOAD_DIR = process.env.UPLOAD_DIR || "./uploads";
const MAX_SIZE_MB = 10;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get("file") as File;

  if (!file) return NextResponse.json({ error: "No file" }, { status: 400 });
  if (file.size > MAX_SIZE_MB * 1024 * 1024) {
    return NextResponse.json({ error: `File exceeds ${MAX_SIZE_MB}MB` }, { status: 413 });
  }

  const allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
  if (!allowed.includes(file.type)) {
    return NextResponse.json({ error: "Invalid file type" }, { status: 415 });
  }

  const merchantDir = path.join(UPLOAD_DIR, session.user.id);
  await mkdir(merchantDir, { recursive: true });

  const filename = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const filepath = path.join(merchantDir, filename);
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(filepath, buffer);

  const url = `/uploads/${session.user.id}/${filename}`;
  return NextResponse.json({ url });
}
```

- [ ] **Step 7.2: Commit**

```bash
git add src/app/api/upload/
git commit -m "feat: add file upload API with type and size validation"
```

---

## Task 8: Onboarding UI

**Files:**
- Create: `src/app/(dashboard)/onboarding/page.tsx`
- Create: `src/components/onboarding/StepBasicInfo.tsx`
- Create: `src/components/onboarding/StepUpload.tsx`
- Create: `src/components/onboarding/StepQuestionnaire.tsx`
- Create: `src/components/onboarding/StepProfile.tsx`
- Create: `src/app/api/agent/run/route.ts`

- [ ] **Step 8.1: Write Agent API endpoint**

For brand analysis, call `brandAnalyzerSkill.handler()` directly rather than through the full agent orchestrator — the orchestrator's text response doesn't reliably surface structured tool output. The orchestrator is designed for multi-step reasoning chains; single-tool calls are simpler to call directly.

Create `src/app/api/agent/run/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { brandAnalyzerSkill } from "@/skills/brand-analyzer";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { basicInfo, uploadedFileUrls, questionnaireAnswers } = await req.json();

  try {
    // Call skill directly to get structured JSON output reliably
    const profileData = await brandAnalyzerSkill.handler({
      basicInfo: JSON.stringify(basicInfo),
      fileUrls: JSON.stringify(uploadedFileUrls || []),
      questionnaireAnswers: JSON.stringify(questionnaireAnswers),
    }) as {
      brandPersonality: string;
      coreSellingPoints: string[];
      targetAudience: string;
      recommendedStyles: string[];
      videoTone: string;
      complianceNotes: string[];
    };

    const profile = await db.brandProfile.create({
      data: {
        merchantId: session.user.id,
        ...profileData,
        uploadedFileUrls: uploadedFileUrls || [],
        questionnaireAnswers,
      },
    });

    return NextResponse.json({ profileId: profile.id, profile });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
```

> **Note:** The `runAgent` orchestrator in `src/agent/orchestrator.ts` is used by the strategy pipeline (Task 9) where multi-step reasoning across multiple tools is needed. For single-tool calls like brand analysis, calling the skill handler directly is simpler and more reliable.

- [ ] **Step 8.2: Write Onboarding wizard page**

Create `src/app/(dashboard)/onboarding/page.tsx` — a 4-step wizard using React `useState` to track current step (1-4). Each step renders a component. Step 4 shows the AI-generated profile for confirmation.

```typescript
"use client";
import { useState } from "react";
import StepBasicInfo from "@/components/onboarding/StepBasicInfo";
import StepUpload from "@/components/onboarding/StepUpload";
import StepQuestionnaire from "@/components/onboarding/StepQuestionnaire";
import StepProfile from "@/components/onboarding/StepProfile";

export default function OnboardingPage() {
  const [step, setStep] = useState(1);
  const [data, setData] = useState<{
    basicInfo?: Record<string, string>;
    uploadedFileUrls?: string[];
    questionnaireAnswers?: Record<string, string>;
    profileId?: string;
  }>({});

  const next = (newData: Partial<typeof data>) => {
    setData((prev) => ({ ...prev, ...newData }));
    setStep((s) => s + 1);
  };

  return (
    <div className="max-w-2xl mx-auto py-10 px-4">
      <div className="mb-8">
        <div className="text-sm text-muted-foreground mb-2">步骤 {step} / 4</div>
        <div className="h-2 bg-muted rounded-full">
          <div
            className="h-2 bg-primary rounded-full transition-all"
            style={{ width: `${(step / 4) * 100}%` }}
          />
        </div>
      </div>
      {step === 1 && <StepBasicInfo onNext={(d) => next({ basicInfo: d })} />}
      {step === 2 && <StepUpload onNext={(urls) => next({ uploadedFileUrls: urls })} />}
      {step === 3 && (
        <StepQuestionnaire
          onNext={async (answers) => {
            const res = await fetch("/api/agent/run", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ...data, questionnaireAnswers: answers }),
            });
            const json = await res.json();
            next({ questionnaireAnswers: answers, profileId: json.profileId });
          }}
        />
      )}
      {step === 4 && data.profileId && (
        <StepProfile profileId={data.profileId} />
      )}
    </div>
  );
}
```

- [ ] **Step 8.3: Write step components**

`StepBasicInfo.tsx` — Form with: brandName, industry, products (textarea), platforms (checkboxes: 抖音/小红书/视频号). Submit calls `onNext(formData)`.

`StepUpload.tsx` — File input supporting multiple files (images + PDF). On select, POSTs each to `/api/upload`. Collects URLs. Submit calls `onNext(urls)`.

`StepQuestionnaire.tsx` — 6 questions as labeled textareas:
1. 您的目标客群是谁？（年龄、性别、职业、兴趣）
2. 您产品/服务的核心卖点是什么？（列举3-5个）
3. 您的主要竞争对手是谁？您比他们好在哪里？
4. 您期望的短视频风格是什么？
5. 每月大概需要生产多少条视频？
6. 有什么内容是绝对不能出现在视频里的？

Submit shows loading ("AI 正在分析中…"), calls `onNext(answers)`.

`StepProfile.tsx` — Fetches `/api/profile/[id]` and displays the generated profile fields. Each field is editable (controlled inputs). "确认画像" button saves edits and redirects to `/strategy`.

- [ ] **Step 8.4: Write profile GET API**

Create `src/app/api/profile/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const profile = await db.brandProfile.findFirst({
    where: { id: params.id, merchantId: session.user.id },
  });
  if (!profile) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(profile);
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const profile = await db.brandProfile.updateMany({
    where: { id: params.id, merchantId: session.user.id },
    data: body,
  });
  return NextResponse.json(profile);
}
```

- [ ] **Step 8.5: Commit**

```bash
git add src/app/(dashboard)/onboarding/ src/components/onboarding/ src/app/api/agent/ src/app/api/profile/
git commit -m "feat: add onboarding wizard and agent run endpoint"
```

---

## Task 9: Strategy & Prompt Generation

**Files:**
- Create: `src/app/(dashboard)/strategy/page.tsx`
- Create: `src/app/api/strategy/route.ts`
- Create: `src/app/(dashboard)/prompts/page.tsx`
- Create: `src/app/api/prompts/route.ts`
- Create: `src/skills/job-dispatcher.ts`

- [ ] **Step 9.1: Write strategy generation API**

Create `src/app/api/strategy/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { strategyPlannerSkill } from "@/skills/strategy-planner";
import { seedancePrompterSkill } from "@/skills/seedance-prompter";
import { complianceCheckerSkill } from "@/skills/compliance-checker";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { profileId, counts } = await req.json();
  // counts: { [direction: string]: number }

  const profile = await db.brandProfile.findFirst({
    where: { id: profileId, merchantId: session.user.id },
  });
  if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  // 1. Generate strategy
  const strategyResult = await strategyPlannerSkill.handler({
    brandProfile: JSON.stringify(profile),
    totalVideos: String(Object.values(counts || {}).reduce((a: number, b) => a + (b as number), 0) || 50),
  }) as { contentMatrix: Array<{ direction: string; style: string; duration: number }>; keywordPool: object };

  const strategy = await db.videoStrategy.create({
    data: {
      brandProfileId: profileId,
      contentMatrix: strategyResult.contentMatrix,
      keywordPool: strategyResult.keywordPool,
    },
  });

  // 2. Generate prompts per direction
  const allPromptData: Array<{
    content: string; duration: number; ratio: string; style: string; direction: string; complianceStatus: string;
  }> = [];

  for (const dir of strategyResult.contentMatrix) {
    const count = (counts?.[dir.direction] as number) || dir.suggestedCount || 10;
    const prompts = await seedancePrompterSkill.handler({
      brandProfile: JSON.stringify(profile),
      direction: dir.direction,
      style: dir.style,
      duration: String(dir.duration),
      count: String(Math.min(count, 50)),
      keywordPool: JSON.stringify(strategyResult.keywordPool),
    }) as Array<{ content: string; duration: number; ratio: string; style: string; direction: string }>;

    const checked = await complianceCheckerSkill.handler({
      prompts: JSON.stringify(prompts),
    }) as Array<{ content: string; complianceStatus: string; duration: number; ratio: string; style: string; direction: string }>;

    allPromptData.push(...checked);
  }

  // 3. Save prompts
  await db.prompt.createMany({
    data: allPromptData.map((p) => ({
      strategyId: strategy.id,
      content: p.content,
      duration: p.duration,
      ratio: p.ratio,
      style: p.style,
      direction: p.direction,
      complianceStatus: p.complianceStatus as "APPROVED" | "NEEDS_REVIEW",
    })),
  });

  return NextResponse.json({ strategyId: strategy.id });
}
```

- [ ] **Step 9.2: Write prompts API (list + update)**

Create `src/app/api/prompts/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const strategyId = req.nextUrl.searchParams.get("strategyId");
  const prompts = await db.prompt.findMany({
    where: {
      strategyId: strategyId || undefined,
      strategy: { brandProfile: { merchantId: session.user.id } },
    },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(prompts);
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, ...data } = await req.json();
  await db.prompt.updateMany({
    where: { id, strategy: { brandProfile: { merchantId: session.user.id } } },
    data,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await req.json();
  await db.prompt.deleteMany({
    where: { id, strategy: { brandProfile: { merchantId: session.user.id } } },
  });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 9.3: Write job-dispatcher skill**

Create `src/skills/job-dispatcher.ts`:

```typescript
import { db } from "@/lib/db";
import { videoQueue } from "@/lib/queue";
import { SkillDefinition } from "./registry";

export const jobDispatcherSkill: SkillDefinition = {
  name: "job-dispatcher",
  description: "Dispatch confirmed prompts to the video generation queue.",
  parameters: {
    type: "object",
    properties: {
      strategyId: { type: "string", description: "Strategy ID to dispatch all confirmed prompts for" },
    },
    required: ["strategyId"],
  },
  handler: async (params) => {
    const prompts = await db.prompt.findMany({
      where: {
        strategyId: params.strategyId as string,
        isConfirmed: true,
        complianceStatus: "APPROVED",
        videoJob: null,
      },
    });

    const jobs = await Promise.all(
      prompts.map(async (p) => {
        const job = await db.videoJob.create({
          data: { promptId: p.id, status: "QUEUED" },
        });
        await videoQueue.add("generate-video", { jobId: job.id, promptId: p.id, content: p.content, duration: p.duration, ratio: p.ratio });
        return job.id;
      })
    );

    return { dispatched: jobs.length, jobIds: jobs };
  },
};
```

- [ ] **Step 9.4: Setup BullMQ queue**

Create `src/lib/queue.ts`:

```typescript
import { Queue } from "bullmq";
import IORedis from "ioredis";

export const redisConnection = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

export const videoQueue = new Queue("video-generation", {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 30000 },
  },
});
```

- [ ] **Step 9.5: Write strategy and prompts pages**

`src/app/(dashboard)/strategy/page.tsx` — Shows content matrix (fetched from DB), lets merchant adjust counts per direction. "生成提示词" button POSTs to `/api/strategy`.

`src/app/(dashboard)/prompts/page.tsx` — List of all prompts with:
- Content display (truncated, expandable)
- Compliance badge (APPROVED=green, NEEDS_REVIEW=yellow)
- Edit button (inline textarea edit)
- Delete button
- Checkbox for bulk select
- "确认并开始生产" button — marks selected as `isConfirmed=true`, then calls `/api/prompts/confirm`

- [ ] **Step 9.6: Write confirm endpoint**

Create `src/app/api/prompts/confirm/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { jobDispatcherSkill } from "@/skills/job-dispatcher";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { promptIds, strategyId } = await req.json();

  await db.prompt.updateMany({
    where: {
      id: { in: promptIds },
      strategy: { brandProfile: { merchantId: session.user.id } },
      complianceStatus: "APPROVED",
    },
    data: { isConfirmed: true },
  });

  const result = await jobDispatcherSkill.handler({ strategyId });
  return NextResponse.json(result);
}
```

- [ ] **Step 9.7: Commit**

```bash
git add src/app/(dashboard)/strategy/ src/app/(dashboard)/prompts/ src/app/api/strategy/ src/app/api/prompts/ src/skills/job-dispatcher.ts src/lib/queue.ts
git commit -m "feat: add strategy generation, prompt management, and job dispatch"
```

---

## Task 10: Playwright Worker Service

**Files:**
- Create: `worker/package.json`
- Create: `worker/index.ts`
- Create: `worker/jimeng.ts`

- [ ] **Step 10.1: Setup worker directory**

```bash
mkdir -p worker
cd worker
npm init -y
npm install playwright bullmq ioredis @prisma/client
npm install -D typescript ts-node @types/node
npx playwright install chromium
```

Create `worker/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true
  }
}
```

- [ ] **Step 10.2: Write 即梦 automation module**

Create `worker/jimeng.ts`:

```typescript
import { Browser, BrowserContext, Page, chromium } from "playwright";
import path from "path";

const JIMENG_URL = "https://jimeng.jianying.com/ai-tool/video/generate";
const SESSION_DIR = path.join(__dirname, "../.jimeng-session");

export class JimengAutomation {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;

  async init() {
    this.browser = await chromium.launchPersistentContext(SESSION_DIR, {
      headless: false, // Must be false to maintain session
      viewport: { width: 1280, height: 900 },
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
    this.context = this.browser;
  }

  async generateVideo(params: {
    content: string;
    duration: number;
    ratio: string;
  }): Promise<string | null> {
    if (!this.context) throw new Error("Not initialized");

    const page = await this.context.newPage();
    try {
      await page.goto(JIMENG_URL, { waitUntil: "networkidle", timeout: 30000 });

      // Find input field (based on 即梦批量生成助手.html auto-detection logic)
      const input = await this.findInputField(page);
      if (!input) throw new Error("Input field not found on 即梦 page");

      await input.click();
      await input.fill("");
      await page.waitForTimeout(300);
      await input.fill(params.content);
      await page.waitForTimeout(500);

      // Click generate button
      const generateBtn = await page.locator('button:has-text("生成"), [class*="generate"]:has-text("生成")').first();
      await generateBtn.click();

      // Wait for video generation (up to 5 minutes)
      const videoUrl = await this.waitForVideoUrl(page, 5 * 60 * 1000);
      return videoUrl;
    } finally {
      await page.close();
    }
  }

  private async findInputField(page: Page) {
    // Try contenteditable first (即梦 uses rich text editor)
    const contenteditable = page.locator('[contenteditable="true"]').first();
    if (await contenteditable.isVisible().catch(() => false)) return contenteditable;

    // Fallback: textarea with relevant placeholder
    const textarea = page.locator('textarea[placeholder*="描述"], textarea[placeholder*="输入"], textarea[placeholder*="想"]').first();
    if (await textarea.isVisible().catch(() => false)) return textarea;

    return null;
  }

  private async waitForVideoUrl(page: Page, timeoutMs: number): Promise<string | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await page.waitForTimeout(5000);

      // Try to intercept video URL from network or DOM
      const videoEl = page.locator("video[src]").first();
      if (await videoEl.isVisible().catch(() => false)) {
        const src = await videoEl.getAttribute("src");
        if (src) return src;
      }

      // Check for download button appearing (means generation complete)
      const downloadBtn = page.locator('[class*="download"], button:has-text("下载")').first();
      if (await downloadBtn.isVisible().catch(() => false)) {
        // Hover to trigger download URL
        await downloadBtn.hover();
        await page.waitForTimeout(500);
        const video = page.locator("video").first();
        const src = await video.getAttribute("src").catch(() => null);
        if (src) return src;
      }
    }
    return null;
  }

  async close() {
    await this.browser?.close();
  }
}
```

- [ ] **Step 10.3: Write worker entry point**

Create `worker/index.ts`:

```typescript
import { Worker, Job } from "bullmq";
import IORedis from "ioredis";
import { PrismaClient } from "@prisma/client";
import { JimengAutomation } from "./jimeng";
import { chromium } from "playwright";
import path from "path";

const redis = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});
const db = new PrismaClient();
const jimeng = new JimengAutomation();

const WORKER_ID = `worker-${process.pid}`;
const CONCURRENCY = parseInt(process.env.CONCURRENCY || "3");
const SESSION_DIR = path.join(__dirname, "../.jimeng-session");

// First-login mode: open browser for manual login, then exit
async function firstLogin() {
  console.log("[first-login] Opening 即梦 for manual login. Log in, then press Ctrl+C.");
  const browser = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: false,
    viewport: { width: 1280, height: 900 },
  });
  const page = await browser.newPage();
  await page.goto("https://jimeng.jianying.com");
  await new Promise(() => {}); // Wait until Ctrl+C
}

async function main() {
  if (process.env.FIRST_LOGIN === "true") {
    return firstLogin();
  }

  await jimeng.init();
  console.log(`[${WORKER_ID}] Playwright Worker started, concurrency=${CONCURRENCY}`);

  const worker = new Worker(
    "video-generation",
    async (job: Job) => {
      const { jobId, content, duration, ratio } = job.data;

      await db.videoJob.update({
        where: { id: jobId },
        data: { status: "PROCESSING", workerId: WORKER_ID, startedAt: new Date() },
      });

      try {
        const resultUrl = await jimeng.generateVideo({ content, duration, ratio });

        await db.videoJob.update({
          where: { id: jobId },
          data: {
            status: resultUrl ? "COMPLETED" : "FAILED",
            resultUrl,
            errorMessage: resultUrl ? null : "Video URL not captured",
            completedAt: new Date(),
          },
        });
      } catch (err) {
        const message = (err as Error).message;
        const job_record = await db.videoJob.findUnique({ where: { id: jobId } });
        const isLastRetry = (job_record?.retryCount ?? 0) + 1 >= (job_record?.maxRetries ?? 3);

        await db.videoJob.update({
          where: { id: jobId },
          data: {
            status: isLastRetry ? "FAILED" : "QUEUED",
            retryCount: { increment: 1 },
            errorMessage: message,
          },
        });
        throw err; // Let BullMQ handle retry
      }
    },
    { connection: redis, concurrency: CONCURRENCY }
  );

  worker.on("failed", (job, err) => {
    console.error(`[${WORKER_ID}] Job ${job?.id} failed:`, err.message);
  });

  process.on("SIGTERM", async () => {
    await worker.close();
    await jimeng.close();
    process.exit(0);
  });
}

main().catch(console.error);
```

- [ ] **Step 10.4: First-time login instructions**

Add `worker/README.md`:

```markdown
## 即梦登录初始化

Worker 使用持久化 browser profile，需要先手动登录一次：

1. 运行：`FIRST_LOGIN=true npx ts-node index.ts`
2. 浏览器会打开即梦页面，手动完成登录
3. 登录成功后按 Ctrl+C 停止
4. 之后正常运行 `npx ts-node index.ts` 即可复用 session
```

- [ ] **Step 10.5: Commit**

```bash
cd ..
git add worker/
git commit -m "feat: add Playwright Worker service for 即梦 automation"
```

---

## Task 11: Dashboard Pages (Jobs + Library)

**Files:**
- Create: `src/app/(dashboard)/jobs/page.tsx`
- Create: `src/app/(dashboard)/library/page.tsx`
- Create: `src/app/api/jobs/route.ts`
- Create: `src/app/(dashboard)/layout.tsx`

- [ ] **Step 11.1: Write Jobs API**

Create `src/app/api/jobs/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { videoQueue } from "@/lib/queue";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const jobs = await db.videoJob.findMany({
    where: { prompt: { strategy: { brandProfile: { merchantId: session.user.id } } } },
    include: { prompt: { select: { content: true, direction: true, style: true } } },
    orderBy: { createdAt: "desc" },
  });

  const stats = {
    total: jobs.length,
    queued: jobs.filter((j) => j.status === "QUEUED").length,
    processing: jobs.filter((j) => j.status === "PROCESSING").length,
    completed: jobs.filter((j) => j.status === "COMPLETED").length,
    failed: jobs.filter((j) => j.status === "FAILED").length,
  };

  return NextResponse.json({ jobs, stats });
}

export async function POST(req: NextRequest) {
  // Retry failed jobs
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { jobId } = await req.json();
  const job = await db.videoJob.findFirst({
    where: { id: jobId, status: "FAILED", prompt: { strategy: { brandProfile: { merchantId: session.user.id } } } },
    include: { prompt: true },
  });
  if (!job) return NextResponse.json({ error: "Job not found or not retryable" }, { status: 404 });

  await db.videoJob.update({ where: { id: jobId }, data: { status: "QUEUED", retryCount: 0, errorMessage: null } });
  await videoQueue.add("generate-video", { jobId, promptId: job.promptId, content: job.prompt.content, duration: job.prompt.duration, ratio: job.prompt.ratio });

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 11.2: Write Jobs page**

`src/app/(dashboard)/jobs/page.tsx` — Poll `/api/jobs` every 10 seconds. Show stats bar (total/queued/processing/completed/failed). Table of jobs with status badges. Failed jobs show "重试" button.

- [ ] **Step 11.3: Write Library page**

`src/app/(dashboard)/library/page.tsx` — Grid of completed videos. Each card shows: video preview (if URL is playable), direction label, style badge, download link. "批量下载" button opens all resultUrls in new tabs.

- [ ] **Step 11.4: Write Dashboard layout**

Create `src/app/(dashboard)/layout.tsx` — Sidebar nav with links to: /onboarding, /profile, /strategy, /prompts, /jobs, /library. Show current user email. Sign out button.

- [ ] **Step 11.5: Commit**

```bash
git add src/app/(dashboard)/ src/app/api/jobs/
git commit -m "feat: add jobs dashboard and video library pages"
```

---

## Task 12: End-to-End Smoke Test

- [ ] **Step 12.1: Start all services**

```bash
# Terminal 1: PostgreSQL (if not running)
# Terminal 2: Redis
redis-server

# Terminal 3: Next.js
npm run dev

# Terminal 4: Playwright Worker
cd worker && npx ts-node index.ts
```

- [ ] **Step 12.2: Smoke test flow**

1. Register a new merchant at `http://localhost:3000/register`
2. Login → should redirect to `/onboarding`
3. Complete Step 1 (basic info) → Step 2 (skip upload, continue) → Step 3 (fill questionnaire) → confirm generated profile
4. Navigate to `/strategy` → click "生成提示词" → verify prompts appear at `/prompts`
5. Review prompts, approve, click "确认并开始生产"
6. Navigate to `/jobs` → verify jobs appear with QUEUED status
7. Check worker terminal → verify it picks up jobs
8. Navigate to `/library` → verify completed videos appear

- [ ] **Step 12.3: Fix any issues found**

- [ ] **Step 12.4: Final commit**

```bash
git add -A
git commit -m "feat: complete MVP implementation - marketing agent v1"
```

---

## Environment Setup Checklist

Before starting:
- [ ] PostgreSQL running locally (or connection string to remote)
- [ ] Redis running locally (`redis-server`)
- [ ] Gemini API key from Google AI Studio
- [ ] `.env.local` filled with all values from `.env.local.example`
- [ ] `NEXTAUTH_SECRET` generated: `openssl rand -base64 32`
- [ ] Worker also needs `DATABASE_URL` and `REDIS_URL` in its environment (set in `worker/.env` or shell)
