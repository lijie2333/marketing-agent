# Logo 落版参考图生成 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 允许商家上传品牌 Logo，自动在每条视频提示词结尾生成落版收尾（@图片1），并在 Playwright Worker 执行时自动上传图片到即梦实现图生视频。

**Architecture:** Logo 存储在 BrandProfile.logoUrl（品牌级资产）；生成提示词时 seedance-prompter 收到 logoUrl，在结尾注入落版 @图片1 描述；Prompt 记录冗余保存 referenceImageUrls；Worker 执行时先上传图片到即梦，再提交含 @图片1 的提示词文本。

**Tech Stack:** Next.js App Router, Prisma/PostgreSQL, Playwright, BullMQ/Redis, Google Gemini

---

## 文件改动总览

| 文件 | 操作 | 职责 |
|------|------|------|
| `prisma/schema.prisma` | 修改 | 新增 BrandProfile.logoUrl, Prompt.referenceImageUrls |
| `src/app/api/agent/run/route.ts` | 修改 | 接收并保存 logoUrl |
| `src/components/onboarding/StepInput.tsx` | 修改 | 新增品牌 Logo 上传 UI |
| `src/app/(dashboard)/onboarding/page.tsx` | 修改 | 将 logoUrl 传递给 API |
| `src/components/onboarding/StepProfile.tsx` | 修改 | 展示 Logo 预览，PATCH 时包含 logoUrl |
| `src/app/(dashboard)/profile/page.tsx` | 修改 | 品牌卡片展示 Logo 缩略图 |
| `src/skills/seedance-prompter.ts` | 修改 | 接收 logoUrl，注入落版 @图片1 指令 |
| `src/app/api/strategy/route.ts` | 修改 | 传递 logoUrl 给 prompter，存储 referenceImageUrls |
| `src/skills/job-dispatcher.ts` | 修改 | 队列数据中包含 referenceImageUrls |
| `src/app/api/jobs/route.ts` | 修改 | 重试时也包含 referenceImageUrls |
| `worker/index.ts` | 修改 | 解析 referenceImageUrls 为本地路径，传给 jimeng |
| `worker/jimeng.ts` | 修改 | 新增 uploadReferenceImages()，generateVideo 上传图片后再提交提示词 |

---

## Task 1：数据库 Schema 变更

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: 修改 Schema**

在 `BrandProfile` model 中，在 `uploadedFileUrls` 字段后新增：

```prisma
logoUrl              String?
```

在 `Prompt` model 中，在 `isConfirmed` 字段后新增：

```prisma
referenceImageUrls   String[]  @default([])
```

- [ ] **Step 2: 生成迁移**

```bash
cd "/Users/lijie/lijie agent project/marketing agent"
npx prisma migrate dev --name add_logo_and_reference_images
```

预期输出：`✔  Generated Prisma Client` 和迁移成功提示。

- [ ] **Step 3: Commit**

```bash
git add prisma/
git commit -m "feat: add logoUrl to BrandProfile and referenceImageUrls to Prompt"
```

---

## Task 2：上传 API 支持 Logo 子目录

**Files:**
- Modify: `src/app/api/upload/route.ts`

Logo 和品牌资料都用同一个上传接口，但通过 `?type=logo` 把 Logo 存进独立子目录，方便区分。

- [ ] **Step 1: 修改上传路由**

在 `src/app/api/upload/route.ts` 中修改 POST 函数：

```typescript
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Support ?type=logo for logo uploads (stored in logos/ subfolder)
  const { searchParams } = new URL(req.url);
  const uploadType = searchParams.get("type"); // "logo" | null

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

  const subDir = uploadType === "logo" ? "logos" : "";
  const merchantDir = path.join(UPLOAD_DIR, session.user.id, subDir);
  await mkdir(merchantDir, { recursive: true });

  const filename = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const filepath = path.join(merchantDir, filename);
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(filepath, buffer);

  const urlPath = subDir ? `${session.user.id}/${subDir}/${filename}` : `${session.user.id}/${filename}`;
  const url = `${PUBLIC_URL_PREFIX}/${urlPath}`;
  return NextResponse.json({ url });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/upload/route.ts
git commit -m "feat: support ?type=logo in upload API for logo subfolder"
```

---

## Task 3：Onboarding - 添加 Logo 上传 UI

**Files:**
- Modify: `src/components/onboarding/StepInput.tsx`
- Modify: `src/app/(dashboard)/onboarding/page.tsx`

Logo 上传始终显示（不受"文字描述/上传资料"切换影响），放在提交按钮上方作为独立区块。

- [ ] **Step 1: 修改 StepInput.tsx**

更新 `StepInputProps` 类型，在 `onNext` 签名中增加 `logoUrl`：

```typescript
interface StepInputProps {
  onNext: (data: { description: string; uploadedFileUrls: string[]; logoUrl?: string }) => Promise<void>;
}
```

在组件 state 中增加：

```typescript
const [logoUrl, setLogoUrl] = useState<string | null>(null);
const [logoUploading, setLogoUploading] = useState(false);
```

新增 Logo 上传处理函数：

```typescript
async function handleLogoFile(e: React.ChangeEvent<HTMLInputElement>) {
  const file = e.target.files?.[0];
  if (!file) return;
  setLogoUploading(true);
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/upload?type=logo", { method: "POST", body: fd });
  if (res.ok) {
    const { url } = await res.json() as { url: string };
    setLogoUrl(url);
  }
  setLogoUploading(false);
  e.target.value = "";
}
```

在 `handleSubmit` 中传递 logoUrl：

```typescript
await onNext({
  description: mode === "description" ? description.trim() : "",
  uploadedFileUrls: mode === "upload" ? urls : [],
  logoUrl: logoUrl ?? undefined,
});
```

在 JSX 中，在提交按钮 `<Button>` 上方加入 Logo 上传区块：

```tsx
{/* Logo 上传（可选，独立于品牌资料） */}
<div className="space-y-2 border-t pt-4">
  <Label>品牌 Logo（可选）</Label>
  <p className="text-xs text-muted-foreground">
    上传后 AI 会在每条视频结尾自动生成落版收尾（像广告片片尾一样）
  </p>
  {logoUrl ? (
    <div className="flex items-center gap-3">
      <img src={logoUrl} alt="品牌Logo" className="h-12 w-12 object-contain rounded border" />
      <span className="text-xs text-muted-foreground truncate max-w-[160px]">
        {logoUrl.split("/").pop()}
      </span>
      <button
        type="button"
        onClick={() => setLogoUrl(null)}
        className="text-xs text-destructive hover:underline"
      >
        移除
      </button>
    </div>
  ) : (
    <div className="flex items-center gap-3">
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={handleLogoFile}
        className="hidden"
        id="logo-upload"
      />
      <label
        htmlFor="logo-upload"
        className="cursor-pointer text-sm px-3 py-1.5 rounded border border-border hover:border-muted-foreground transition-colors"
      >
        {logoUploading ? "上传中..." : "选择 Logo 图片"}
      </label>
      <span className="text-xs text-muted-foreground">JPG / PNG / WEBP，最大 10MB</span>
    </div>
  )}
</div>
```

- [ ] **Step 2: 修改 onboarding/page.tsx**

更新 `handleInput` 参数类型并转发 `logoUrl`：

```typescript
async function handleInput(data: { description: string; uploadedFileUrls: string[]; logoUrl?: string }) {
  setError(null);
  try {
    const res = await fetch("/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),  // logoUrl 自动包含在 data 里
    });
    // ... 其余不变
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/onboarding/StepInput.tsx src/app/(dashboard)/onboarding/page.tsx
git commit -m "feat: add brand logo upload to onboarding StepInput"
```

---

## Task 4：Agent Run API 保存 logoUrl

**Files:**
- Modify: `src/app/api/agent/run/route.ts`

- [ ] **Step 1: 修改 agent/run/route.ts**

更新请求体解析，加入 `logoUrl`：

```typescript
const { description, uploadedFileUrls, logoUrl } = await req.json() as {
  description: string;
  uploadedFileUrls?: string[];
  logoUrl?: string;
};
```

在 `db.brandProfile.create` 的 `data` 对象中加入：

```typescript
logoUrl: logoUrl || null,
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/agent/run/route.ts
git commit -m "feat: save logoUrl to BrandProfile on agent run"
```

---

## Task 5：Profile 确认步骤显示 Logo，PATCH 时保存

**Files:**
- Modify: `src/components/onboarding/StepProfile.tsx`
- Modify: `src/app/(dashboard)/profile/page.tsx`

- [ ] **Step 1: 修改 StepProfile.tsx**

更新 `BrandProfile` 类型加入 `logoUrl`：

```typescript
interface BrandProfile {
  // ... 现有字段
  logoUrl?: string | null;
}
```

在 JSX 的品牌名称/行业 grid 上方添加 Logo 预览区块：

```tsx
{profile.logoUrl && (
  <div className="flex items-center gap-3 p-3 bg-muted/40 rounded-lg">
    <img
      src={profile.logoUrl}
      alt="品牌Logo"
      className="h-12 w-12 object-contain rounded border bg-white"
    />
    <div>
      <p className="text-xs font-medium">品牌 Logo 已上传</p>
      <p className="text-xs text-muted-foreground">视频结尾将自动生成落版收尾</p>
    </div>
  </div>
)}
```

`handleConfirm` 已通过 `JSON.stringify(profile)` 发送全量字段，由于 `profile` 类型已包含 `logoUrl`，无需额外改动 PATCH 逻辑（`profile/[id]/route.ts` 的 PATCH 已是通用更新）。

- [ ] **Step 2: 修改 profile/page.tsx**

更新 `BrandProfile` 类型加入 `logoUrl`：

```typescript
interface BrandProfile {
  // ... 现有字段
  logoUrl?: string | null;
}
```

在品牌卡片 `<CardHeader>` 的品牌名旁边展示 Logo 小图：

```tsx
<div className="flex items-center gap-3">
  {profile.logoUrl && (
    <img
      src={profile.logoUrl}
      alt="logo"
      className="h-8 w-8 object-contain rounded border bg-white shrink-0"
    />
  )}
  <CardTitle className="text-lg">
    {profile.brandName || profile.brandPersonality}
  </CardTitle>
  {/* ... 其余 badges */}
</div>
```

- [ ] **Step 3: Commit**

```bash
git add src/components/onboarding/StepProfile.tsx src/app/(dashboard)/profile/page.tsx
git commit -m "feat: show logo preview in StepProfile and profile page"
```

---

## Task 6：Seedance Prompter 注入落版指令

**Files:**
- Modify: `src/skills/seedance-prompter.ts`

- [ ] **Step 1: 修改 seedance-prompter.ts**

在 `parameters.properties` 中新增：

```typescript
logoUrl: {
  type: SchemaType.STRING,
  description: "Optional brand logo public URL. When provided, every prompt must end with a closing slate using @图片1.",
},
```

在 `SYSTEM_PROMPT` 末尾、最后的 `\`` 前追加一个新章节：

```
## 品牌落版规则（当 hasLogo=true 时，每条提示词必须遵守）

每条提示词的最后 2 秒（13-15秒）必须包含落版描述，自然融入叙事流结尾，不要生硬割裂。

落版模板（根据品牌色调和视频风格灵活调整措辞）：
「13-15秒，节奏渐缓，画面轻柔收尾，品牌标识@图片1从画面中央渐入放大，配合[品牌主色]光晕粒子散射，旁白（声音类型）低语："[品牌名/金句]"，落版。」

要求：
- @图片1 是品牌 Logo 参考图，必须在落版描述中出现，不要在提示词其他位置引用
- 落版描述控制在 30-50 字以内，简洁、不破坏前段叙事节奏
- 光晕颜色贴合品牌色调（如无品牌色则用白色或金色）
- 旁白融入前段的 Audio 段落，不要单独列出
```

在 `handler` 中读取 `logoUrl`，并根据是否有 Logo 调整 userPrompt：

```typescript
const logoUrl = params.logoUrl as string | undefined;
const hasLogo = !!logoUrl;
```

在 userPrompt 的 `## 生成要求` 区块末尾追加：

```typescript
const logoInstruction = hasLogo
  ? `\n- 【必须】每条提示词结尾 13-15 秒加入落版收尾，使用 @图片1 引用品牌 Logo，参见系统提示中的「品牌落版规则」`
  : "";
```

将 `logoInstruction` 拼接到 userPrompt 的生成要求末尾：

```typescript
const userPrompt = `...（现有内容）...
- 关键词参考：${JSON.stringify(keywords)}${logoInstruction}
...（其余内容不变）...`;
```

返回的每个 item 补上 `referenceImageUrls`：

```typescript
return items.map((item) => ({
  content: stripMarkdown(item.prompt),
  script: item.script,
  duration: 15,
  ratio: "9:16",
  style: params.style as string,
  direction: params.direction as string,
  referenceImageUrls: hasLogo && logoUrl ? [logoUrl] : [],
}));
```

- [ ] **Step 2: Commit**

```bash
git add src/skills/seedance-prompter.ts
git commit -m "feat: inject logo closing slate (@图片1) into seedance prompts when logoUrl provided"
```

---

## Task 7：Strategy API 传递 logoUrl 并存储 referenceImageUrls

**Files:**
- Modify: `src/app/api/strategy/route.ts`

- [ ] **Step 1: 修改 strategy/route.ts**

在读取 `profile` 后，提取 `logoUrl`：

```typescript
// profile already fetched above
const logoUrl = (profile as { logoUrl?: string | null }).logoUrl ?? undefined;
```

将 `logoUrl` 传给 `seedancePrompterSkill.handler`：

```typescript
const rawPrompts = await seedancePrompterSkill.handler({
  brandProfile: JSON.stringify(profile),
  direction: dir.direction,
  style: dir.style,
  count: String(Math.min(count, 50)),
  keywordPool: JSON.stringify(strategyResult.keywordPool),
  logoUrl,                          // 新增
}) as Array<{
  content: string;
  script: string;
  duration: number;
  ratio: string;
  style: string;
  direction: string;
  referenceImageUrls: string[];     // 新增
}>;
```

在 compliance check 后的 merge 步骤，保留 `referenceImageUrls`：

```typescript
return checked.map((p, i) => ({
  content: String(p.content || ""),
  script: String(p.script || rawPrompts[i]?.script || ""),
  duration: Number(p.duration) || 15,
  ratio: String(p.ratio || "9:16"),
  style: String(p.style || dir.style),
  direction: String(p.direction || dir.direction),
  complianceStatus: p.complianceStatus === "APPROVED" ? "APPROVED" as const : "NEEDS_REVIEW" as const,
  referenceImageUrls: rawPrompts[i]?.referenceImageUrls ?? [],  // 新增
}));
```

在 `db.prompt.createMany` 中包含 `referenceImageUrls`：

```typescript
await db.prompt.createMany({
  data: allPromptData.map((p) => ({
    strategyId: strategy.id,
    content: p.content,
    script: p.script || "",
    duration: p.duration,
    ratio: p.ratio,
    style: p.style,
    direction: p.direction,
    complianceStatus: p.complianceStatus,
    referenceImageUrls: p.referenceImageUrls,  // 新增
  })),
});
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/strategy/route.ts
git commit -m "feat: pass logoUrl to prompter and persist referenceImageUrls on Prompt"
```

---

## Task 8：Job Dispatcher 携带 referenceImageUrls 入队

**Files:**
- Modify: `src/skills/job-dispatcher.ts`

- [ ] **Step 1: 修改 job-dispatcher.ts**

`db.prompt.findMany` 的查询结果已包含 `referenceImageUrls`（Prisma 默认返回所有标量字段），直接在 `videoQueue.add` 中传递：

```typescript
await videoQueue.add("generate-video", {
  jobId: job.id,
  promptId: p.id,
  content: p.content,
  duration: p.duration,
  ratio: p.ratio,
  referenceImageUrls: p.referenceImageUrls,  // 新增
});
```

- [ ] **Step 2: Commit**

```bash
git add src/skills/job-dispatcher.ts
git commit -m "feat: include referenceImageUrls in video generation queue job"
```

---

## Task 9：Jobs Retry API 携带 referenceImageUrls

**Files:**
- Modify: `src/app/api/jobs/route.ts`

- [ ] **Step 1: 修改 jobs/route.ts 的 POST（重试逻辑）**

`findFirst` 已 include `prompt`，直接使用：

```typescript
await videoQueue.add("generate-video", {
  jobId,
  promptId: job.promptId,
  content: job.prompt.content,
  duration: job.prompt.duration,
  ratio: job.prompt.ratio,
  referenceImageUrls: job.prompt.referenceImageUrls,  // 新增
});
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/jobs/route.ts
git commit -m "feat: include referenceImageUrls in retry job dispatch"
```

---

## Task 10：Worker 解析 referenceImageUrls 为本地路径

**Files:**
- Modify: `worker/index.ts`

- [ ] **Step 1: 修改 worker/index.ts**

更新 job.data 的类型解构，加入 `referenceImageUrls`：

```typescript
const { jobId, content, duration, ratio, referenceImageUrls } = job.data as {
  jobId: string;
  content: string;
  duration: number;
  ratio: string;
  referenceImageUrls?: string[];
};
```

在 `VIDEOS_DIR` 常量下面新增：

```typescript
// Base directory for all user uploads (logos, brand materials, etc.)
const UPLOADS_BASE = path.resolve(__dirname, "../uploads");

/** Convert a public URL like /uploads/userId/logos/file.png to an absolute local path */
function resolveUploadPath(publicUrl: string): string {
  // publicUrl starts with /uploads/
  const relative = publicUrl.replace(/^\/uploads\//, "");
  return path.join(UPLOADS_BASE, relative);
}
```

在调用 `jimeng.generateVideo` 时传入解析后的路径：

```typescript
const referenceImagePaths = (referenceImageUrls ?? [])
  .map(resolveUploadPath)
  .filter((p) => fs.existsSync(p));  // 跳过不存在的文件（容错）

if (referenceImageUrls?.length && referenceImagePaths.length === 0) {
  console.warn(`[${WORKER_ID}] Job ${jobId}: referenceImageUrls specified but no files found locally`);
}

const remoteUrl = await jimeng.generateVideo({
  content,
  duration,
  ratio,
  referenceImagePaths,  // 新增
});
```

- [ ] **Step 2: Commit**

```bash
git add worker/index.ts
git commit -m "feat: resolve referenceImageUrls to local paths and pass to jimeng"
```

---

## Task 11：Jimeng Playwright 自动上传图片

**Files:**
- Modify: `worker/jimeng.ts`

这是整个功能最复杂的部分。需要在即梦页面上传参考图片，然后再提交含 `@图片1` 的提示词。

- [ ] **Step 1: 更新 generateVideo 签名**

在 `generateVideo` 的参数类型中加入 `referenceImagePaths`：

```typescript
async generateVideo(params: {
  content: string;
  duration: number;
  ratio: string;
  referenceImagePaths?: string[];
}): Promise<string> {
```

- [ ] **Step 2: 在填写提示词之前调用 uploadReferenceImages**

在 `configureVideoParams` 调用之后、"Fill prompt text" 步骤之前，插入：

```typescript
// Step 2: Upload reference images if provided (全能参考)
if (params.referenceImagePaths && params.referenceImagePaths.length > 0) {
  console.log(`[jimeng] Uploading ${params.referenceImagePaths.length} reference image(s)...`);
  await this.uploadReferenceImages(page, params.referenceImagePaths);
}
```

同时将后续步骤的编号注释从 Step 2 改为 Step 3，以此类推（Step 3→4，Step 4→5，Step 5→6）。

- [ ] **Step 3: 新增 uploadReferenceImages 私有方法**

在 `configureVideoParams` 方法之前插入：

```typescript
/**
 * Upload reference images to 即梦 (全能参考 / 图片参考 mode).
 * After upload, the images are labeled @图片1, @图片2, etc. by the platform.
 * The prompt text should already contain @图片N references.
 */
private async uploadReferenceImages(page: Page, filePaths: string[]): Promise<void> {
  // Strategy 1: Look for a file input that accepts images (most reliable)
  const uploaded = await page.evaluate(`(function() {
    var inputs = document.querySelectorAll('input[type="file"]');
    for (var i = 0; i < inputs.length; i++) {
      var inp = inputs[i];
      var accept = inp.accept || "";
      if (accept.indexOf("image") > -1 || accept === "") {
        return { found: true, index: i };
      }
    }
    return { found: false };
  })()`) as { found: boolean; index?: number };

  if (uploaded.found && uploaded.index !== undefined) {
    // Use setInputFiles — the most reliable Playwright upload method
    const fileInputs = page.locator('input[type="file"]');
    const targetInput = fileInputs.nth(uploaded.index);
    try {
      await targetInput.setInputFiles(filePaths);
      console.log("[jimeng] Set files on file input directly");
      await page.waitForTimeout(3000); // Wait for upload to process
      return;
    } catch (err) {
      console.warn("[jimeng] Direct setInputFiles failed, trying upload button click:", err);
    }
  }

  // Strategy 2: Click an upload button to trigger file picker
  // 即梦 typically has a paperclip/upload icon button in the generation area
  const uploadButtonSelectors = [
    'button[aria-label*="上传"]',
    'button[aria-label*="图片"]',
    'button[aria-label*="参考"]',
    '[class*="upload"] button',
    '[class*="reference"] button',
    '[class*="attach"] button',
    'button:has([class*="upload"])',
    'button:has([class*="image"])',
  ];

  let uploadBtn = null;
  for (const sel of uploadButtonSelectors) {
    const btn = page.locator(sel).first();
    if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
      uploadBtn = btn;
      break;
    }
  }

  if (uploadBtn) {
    // Use filechooser event approach
    const [fileChooser] = await Promise.all([
      page.waitForEvent("filechooser", { timeout: 5000 }),
      uploadBtn.click(),
    ]);
    await fileChooser.setFiles(filePaths);
    console.log("[jimeng] Uploaded via filechooser");
    await page.waitForTimeout(3000);
    return;
  }

  // Strategy 3: Trigger any hidden file input via filechooser
  try {
    const [fileChooser] = await Promise.all([
      page.waitForEvent("filechooser", { timeout: 3000 }),
      page.evaluate(`(function() {
        var inputs = document.querySelectorAll('input[type="file"]');
        if (inputs.length > 0) { inputs[0].click(); return true; }
        return false;
      })()`),
    ]);
    await fileChooser.setFiles(filePaths);
    console.log("[jimeng] Uploaded via hidden file input trigger");
    await page.waitForTimeout(3000);
    return;
  } catch {
    console.warn("[jimeng] Could not upload reference images — no upload trigger found. Proceeding without images.");
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add worker/jimeng.ts
git commit -m "feat: upload reference images to 即梦 before prompt submission (全能参考)"
```

---

## Task 12：端到端验证

- [ ] **Step 1: 运行数据库迁移验证**

```bash
cd "/Users/lijie/lijie agent project/marketing agent"
npx prisma studio
```

在 Prisma Studio 中确认 `BrandProfile` 有 `logoUrl` 字段，`Prompt` 有 `referenceImageUrls` 字段。

- [ ] **Step 2: 启动开发服务器**

```bash
npm run dev
```

- [ ] **Step 3: 端到端测试流程**

1. 访问 `http://localhost:3000/onboarding`
2. 在品牌信息页，确认 Logo 上传区块可见
3. 上传一张 PNG 图片作为 Logo，确认预览显示
4. 点击"生成品牌画像"，进入 Step 2，确认 Logo 预览可见
5. 确认品牌画像，跳转到 `/profile`，确认品牌卡片显示 Logo 缩略图
6. 前往 `/strategy`，生成策略
7. 生成完成后，在 `/prompts` 页面找一条提示词，确认内容中包含 `@图片1` 和落版描述（如"品牌标识@图片1从画面中央渐入"）
8. 选择提示词，点击派发，到 `/jobs` 查看任务入队

- [ ] **Step 4: Worker 验证（需要 Redis 和即梦会话）**

```bash
cd worker && npm start
```

观察控制台输出，确认：
- `[jimeng] Uploading 1 reference image(s)...` 日志出现
- 上传成功后继续填写提示词并提交
- 任务最终变为 `COMPLETED`

- [ ] **Step 5: Final commit**

```bash
git add .
git commit -m "docs: add logo reference video implementation plan"
```
