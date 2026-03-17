# Marketing Agent 设计文档

**日期：** 2026-03-18
**状态：** 已确认
**项目：** AI 短视频营销 SaaS 平台

---

## 1. 项目概述

面向商家的 AI 短视频批量生产 SaaS 平台。商家上传品牌资料，AI 自动生成品牌画像和视频策略，批量产出即梦AI提示词，并通过浏览器自动化将提示词提交至即梦平台完成视频生成。

**核心价值：** 帮助有大量短视频投放需求的商家，用 AI 全自动完成从品牌分析到视频生产的完整链路。

**AI 模型选型理由：** 选用 Gemini API，因其原生支持多模态（PDF/图片/文本）输入，免费额度高，适合 MVP 阶段降低成本。

---

## 2. 技术栈

| 层级 | 技术选型 | 理由 |
|------|---------|------|
| 前后端框架 | Next.js 14+（App Router） | 全栈单代码库，部署简单 |
| 数据库 | PostgreSQL + Prisma ORM | 结构化数据，关系清晰 |
| AI 模型 | Gemini API（多模态） | 原生支持 PDF/图片，成本低 |
| 任务队列 | BullMQ + Redis | 支持并发 Worker、重试、优先级，比 pg-boss 更适合高并发自动化场景 |
| 浏览器自动化 | Playwright Worker 独立 Node.js 服务 | 需持久化 browser session，不能跑在 Serverless 环境 |
| UI 组件库 | Shadcn/ui | 快速构建，风格统一 |
| 认证 | NextAuth.js（邮箱/密码） | 商家账号体系，支持 session 管理 |

---

## 3. 整体架构

```
商家浏览器
    ↓ HTTPS
[Next.js Web App]
    ├── /api/auth          (NextAuth.js)
    ├── /api/upload        (文件上传 → 存储)
    ├── /api/agent         (触发 Agent 任务)
    └── /api/jobs          (任务状态查询)
    ↓
[Agent Orchestrator]
    Gemini Function Calling，多轮工具调用循环：
    1. 调用 brand-analyzer → 获取品牌信息
    2. 调用 strategy-planner → 生成内容矩阵
    3. 循环调用 seedance-prompter → 逐批生成提示词
    4. 调用 compliance-checker → 过滤违规内容
    5. 调用 job-dispatcher → 推入队列
    ↓
[BullMQ + Redis 任务队列]
    ↓ Worker 拉取任务
[Playwright Worker 服务（独立 Node.js 进程）]
    - 部署在有 GUI 的服务器/本地机器
    - 维护一个持久化的即梦浏览器 Session（商家提前手动登录一次）
    - 并发数：可配置（默认 3 个并发任务）
    - 执行：粘贴提示词 → 提交 → 轮询生成状态 → 截图/记录结果 URL
    ↓
[PostgreSQL 数据库]  ←→  [Next.js Dashboard]
```

**关键依赖风险：** 即梦AI 无公开 API，依赖浏览器自动化其 Web UI。UI 变更会导致自动化失效，需定期维护选择器。这是第一期最高技术风险点。

---

## 4. Agent 能力层

### 4.1 执行模型

Agent Orchestrator 是一个**多轮工具调用循环**：

```typescript
async function runAgent(context: AgentContext): Promise<AgentResult> {
  const messages = [buildSystemPrompt(), buildUserContext(context)];
  while (true) {
    const response = await gemini.generateContent({ messages, tools: registeredSkills });
    if (response.finishReason === 'STOP') return response.text;
    // 执行 AI 请求的工具调用
    for (const toolCall of response.toolCalls) {
      const result = await skillRegistry.invoke(toolCall.name, toolCall.args);
      messages.push(buildToolResult(toolCall.id, result));
    }
  }
}
```

Agent 失败重试：单次工具调用失败最多重试 2 次，整个 Agent 执行超时 5 分钟后终止并标记错误。

### 4.2 Skill 注册接口

```typescript
interface Skill {
  name: string;
  description: string;           // 给 Gemini 看的工具描述
  parameters: JSONSchema;         // 入参 schema
  handler: (params: unknown) => Promise<unknown>;
}

// 注册示例
skillRegistry.register(brandAnalyzerSkill);
```

新 Skill 在 `src/skills/` 目录下新增文件并调用 `skillRegistry.register()` 即可。**所有新 Skill 的创建统一走 `skill-creator` 流程。**

### 4.3 初始 Skills 清单

| Skill | 功能描述 | 输入 | 输出 |
|-------|---------|------|------|
| `brand-analyzer` | 调用 Gemini Vision 分析上传文件，提取品牌结构化信息 | 文件 URL 数组 + 问卷答案 | BrandProfile JSON |
| `strategy-planner` | 基于品牌画像生成内容矩阵和关键词库 | BrandProfile | VideoStrategy JSON |
| `seedance-prompter` | 基于 SCELA 公式批量生成即梦提示词 | 策略方向 + 数量 | Prompt 数组 |
| `compliance-checker` | 检查提示词中的违规内容（真实人名/版权IP/政治内容） | Prompt 数组 | 标注合规状态的 Prompt 数组 |
| `job-dispatcher` | 将合规提示词批量推入 BullMQ 队列 | Prompt 数组 | 任务 ID 列表 |

---

## 5. 数据模型

```prisma
model Merchant {
  id            String         @id @default(cuid())
  name          String
  email         String         @unique
  passwordHash  String
  brandProfiles BrandProfile[]
  createdAt     DateTime       @default(now())
}

model BrandProfile {
  id                String          @id @default(cuid())
  merchantId        String
  merchant          Merchant        @relation(fields: [merchantId], references: [id])
  // AI 生成字段（可编辑）
  brandPersonality  String          // 品牌人格描述
  coreSellingPoints String[]        // 核心卖点列表
  targetAudience    String          // 目标受众描述
  recommendedStyles String[]        // 推荐视频风格（对应 seedance-bot 风格模板）
  videoTone         String          // 视频基调
  complianceNotes   String[]        // 合规注意事项
  // 原始输入（用于重新生成）
  uploadedFileUrls  String[]        // 上传文件 URL
  questionnaireAnswers Json         // 问卷答案
  strategies        VideoStrategy[]
  createdAt         DateTime        @default(now())
  updatedAt         DateTime        @updatedAt
}

model VideoStrategy {
  id             String        @id @default(cuid())
  brandProfileId String
  brandProfile   BrandProfile  @relation(fields: [brandProfileId], references: [id])
  contentMatrix  Json          // 内容方向数组: [{direction, style, duration, count}]
  keywordPool    Json          // {selling: [], emotion: [], scene: []}
  prompts        Prompt[]
  createdAt      DateTime      @default(now())
}

model Prompt {
  id             String        @id @default(cuid())
  strategyId     String
  strategy       VideoStrategy @relation(fields: [strategyId], references: [id])
  content        String        // 即梦提示词正文
  duration       Int           // 视频时长（秒）
  ratio          String        // "16:9" | "9:16"
  style          String        // 风格标签
  direction      String        // 内容方向（来自内容矩阵）
  complianceStatus ComplianceStatus @default(PENDING)
  isConfirmed    Boolean       @default(false)  // 商家确认后才可入队
  videoJob       VideoJob?
  createdAt      DateTime      @default(now())
}

enum ComplianceStatus {
  PENDING
  APPROVED
  NEEDS_REVIEW  // 需人工审核
  REJECTED
}

model VideoJob {
  id            String      @id @default(cuid())
  promptId      String      @unique
  prompt        Prompt      @relation(fields: [promptId], references: [id])
  status        JobStatus   @default(QUEUED)
  workerId      String?     // 认领此任务的 Worker 实例 ID
  retryCount    Int         @default(0)
  maxRetries    Int         @default(3)
  resultUrl     String?     // 生成的视频 URL（从即梦页面抓取）
  errorMessage  String?
  startedAt     DateTime?
  completedAt   DateTime?
  createdAt     DateTime    @default(now())
  updatedAt     DateTime    @updatedAt
}

enum JobStatus {
  QUEUED        // 已入队，等待 Worker
  PROCESSING    // Worker 正在执行
  COMPLETED     // 成功，resultUrl 有值
  FAILED        // 超过最大重试次数
  NEEDS_REVIEW  // 合规问题，需人工处理
}
```

---

## 6. 商家入驻流程（Onboarding）

```
Step 1: 基础信息
  → 品牌名、行业、主营产品/服务、目标投放平台

Step 2: 多模态资料上传
  → 支持：PDF（≤10MB）、图片（JPG/PNG/WEBP，≤5MB/张，最多9张）
  → 上传后存储至服务器，获得文件 URL

Step 3: 引导式问卷（6-8题）
  → 目标客群画像？核心卖点？竞品差异化？期望视频风格？投放量级？

Step 4: AI 生成品牌画像
  → 触发 Agent（brand-analyzer）
  → 展示生成结果，商家可逐字段编辑
  → 若商家不满意 → 可修改问卷答案后重新生成（最多3次）
  → 商家点击「确认画像」→ 进入策略生成
```

---

## 7. 视频策略 & 批量生产

### 7.1 策略生成

商家确认画像后，Agent 自动运行 `strategy-planner`，生成内容矩阵：
- 3-5 个内容方向，每个方向包含：推荐风格、时长、建议视频数量
- 关键词库（卖点词/情绪词/场景词）

### 7.2 提示词生成与确认

```
商家设置各方向视频数量（上限：每方向50条，总计200条/批次）
    ↓
Agent 批量调用 seedance-prompter + compliance-checker
    ↓
商家在 /prompts 页面：
  - 预览每条提示词
  - 编辑内容
  - 删除不满意的条目
  - NEEDS_REVIEW 状态的条目需手动标记为 APPROVED 或 REJECTED
    ↓
商家点击「确认并开始生产」→ isConfirmed=true → job-dispatcher 入队
```

### 7.3 Playwright Worker 执行详情

```
Worker 启动：
  - 加载持久化 browser profile（商家已手动登录即梦的 session）
  - 一个 Worker 进程管理 N 个并发 browser context（默认 N=3）

每条任务执行流程：
  1. 从 BullMQ 拉取任务，标记 status=PROCESSING，记录 workerId
  2. 打开即梦视频生成页面
  3. 粘贴提示词，设置时长和比例参数
  4. 点击生成，轮询页面状态（最长等待 5 分钟）
  5. 成功：抓取视频 URL，写入 resultUrl，status=COMPLETED
  6. 失败：retryCount+1，若 < maxRetries 则重新入队，否则 status=FAILED

失败通知：
  - 任务 FAILED 后，在 Dashboard /jobs 页面显示红色警告
  - 商家可手动触发单条重试
```

### 7.4 视频结果获取

即梦生成完成后，Playwright 从页面抓取视频播放 URL（通过网络请求拦截或页面 DOM 解析），写入 `VideoJob.resultUrl`。商家在 `/library` 页面可预览和下载。

---

## 8. Dashboard 页面结构

| 路由 | 功能 |
|------|------|
| `/onboarding` | 入驻引导（4步流程） |
| `/profile` | 品牌画像查看与编辑，支持重新生成 |
| `/strategy` | 内容矩阵管理，设置各方向视频数量 |
| `/prompts` | 提示词列表，预览/编辑/合规审核/确认入队 |
| `/jobs` | 生产任务队列，实时状态/成功率统计/失败重试 |
| `/library` | 视频库，结果预览/批量下载 |

---

## 9. 现有资产复用

| 现有文件 | 复用方式 |
|---------|---------|
| `即梦批量生成助手.html` | 参考其即梦操作逻辑（DOM 选择器、交互流程），转化为 Playwright 自动化脚本 |
| `skills/seedance-bot/SKILL.md` | 转译为 `seedance-prompter` Skill 的核心规则（SCELA 公式 + 风格模板 + 合规检查） |

---

## 10. 第一期范围（MVP）

第一期聚焦核心链路，按优先级排序：

1. **P0 - 商家认证**：注册/登录（NextAuth.js）
2. **P0 - Onboarding**：4步入驻流程 + 品牌画像生成
3. **P0 - 提示词生成**：策略生成 + 批量提示词 + 合规检查
4. **P1 - 生产执行**：BullMQ 队列 + Playwright Worker + 结果回写
5. **P1 - Dashboard**：任务状态 + 视频库

**第二期（后续迭代）：**
- 多商家 SaaS（当前第一期已按多租户设计，数据通过 merchantId 隔离）
- 热点追踪 Skill（`trend-researcher`）
- 数据分析 Dashboard
- 所有新 Skill 使用 `skill-creator` 流程协商创建
