import { SchemaType } from "@google/generative-ai";
import {
  getDefaultGeminiAnalysisModelName,
  getDefaultGeminiModelName,
  getGeminiModel,
  withGeminiRetry,
} from "@/lib/gemini";
import type { SkillDefinition } from "./registry";
import { readFileSync } from "fs";
import path from "path";

// Load seedance-bot reference materials at startup
const REFS_DIR = path.join(process.cwd(), "skills/seedance-bot/references");
const PROMPT_TEMPLATES = readFileSync(path.join(REFS_DIR, "prompt-templates.md"), "utf-8");
const COMPLIANCE = readFileSync(path.join(REFS_DIR, "compliance.md"), "utf-8");
const VOCAB = readFileSync(path.join(REFS_DIR, "vocab.md"), "utf-8");

interface StoryboardShot {
  shotName: string;
  visual: string;
  camera: string;
  motion: string;
  effect: string;
  light: string;
  audio: string;
  voiceover: string;
  startSecond?: number;
  endSecond?: number;
}

interface StoryboardPlan {
  title: string;
  hook: string;
  storyArc: string;
  voiceTone: string;
  shots: StoryboardShot[];
}

interface PromptItem {
  content: string;
  script: string;
  storyboard?: StoryboardPlan;
  duration: number;
  ratio: string;
  style: string;
  direction: string;
  referenceImageUrls: string[];
}

function shouldUseStoryboardPipeline() {
  return process.env.ENABLE_STORYBOARD_PIPELINE === "true";
}

const SYSTEM_PROMPT = `你是一位专业的短视频内容策划师，精通 Seedance 2.0（即梦AI）视频提示词写作。

## SCELA 公式

每条视频提示词必须包含 5 个要素：
- **S** Subject — 主体：原创虚拟角色或无品牌标识产品，保留品牌核心视觉特征
- **C** Camera — 镜头：从词汇库选最匹配的运镜
- **E** Effect — 特效：具体化，不说「炫酷」，要说「蓝色电弧绕剑旋转」
- **L** Light/Look — 光影风格：色调 + 画质关键词
- **A** Audio — 音效 + 配音旁白（即梦AI可直接生成语音）

叙述结构：
- **流畅叙事**（优先）：镜头跟随主体动作，场景转换，特效，音效
- **时间戳分镜**（仅需精确时序时用）：0-Xs / X-Ys / Y-末

## 配音旁白（必须嵌入提示词中）

即梦AI 可以根据提示词直接生成配音旁白，因此旁白文案必须写在提示词内部，不要分离。

写法示例：
- 旁白（温柔女声）道："每一件衣服，都是和自己的一次对话。"
- 旁白（磁性男声）道："科技，不该让生活更复杂。"
- 台词（女主角，自信微笑）："这就是我的风格。"

旁白/台词要求：
- **必须嵌入提示词的音效部分**（Audio 段落），不单独输出
- 标注声音类型：女声/男声 + 语气特征（温柔/磁性/活力/沉稳等）
- 内容要**凝练**（15秒内能读完，约 45-60 个中文字）
- 贴合品牌人格和视频基调
- 有记忆点：金句、反转、号召行动
- 口语化，不要书面语

## 关键约束
- 所有视频时长固定为 15秒，比例 9:16 竖屏
- 提示词用中文，200-500 字
- 旁白/台词嵌入提示词中，不单独输出
- 合规约束内嵌在描述中，不单独列出
- 【极其重要】生成的提示词（prompt字段）必须是纯文本，绝对不能包含任何 Markdown 格式符号，包括但不限于：**加粗**、*斜体*、# 标题、- 列表符号。即梦AI只接受纯文本。用中文标点和自然段落组织内容，不要用 Markdown。

---

## 模板库

${PROMPT_TEMPLATES}

---

## 词汇库

${VOCAB}

---

## 合规规范

${COMPLIANCE}

---

## 品牌落版规则（当提供了品牌Logo时，每条提示词必须遵守）

每条提示词的最后 2 秒（13-15秒）必须包含落版描述，自然融入叙事流结尾，不要生硬割裂。

落版模板（根据品牌色调和视频风格灵活调整措辞）：
「13-15秒，节奏渐缓，画面轻柔收尾，品牌标识@图片1从画面中央渐入放大，配合[品牌主色]光晕粒子散射，旁白（声音类型）低语："[品牌名/金句]"，落版。」

要求：
- @图片1 是品牌 Logo 参考图，必须出现在落版描述中，不要在提示词其他位置引用
- 落版描述控制在 30-50 字以内，简洁、不破坏前段叙事节奏
- 光晕颜色贴合品牌色调（无品牌色则用白色或金色）
- 旁白融入前段的 Audio 段落，不要单独列出
`;

const STORYBOARD_SYSTEM_PROMPT = `你是一位资深广告导演和分镜设计师，负责先把品牌视频拆成可拍、可生成、可转化的时间戳分镜。

你的分镜必须满足：
- 总时长固定 15 秒，9:16 竖屏
- 每个镜头必须写清楚：画面主体、场景、动作、镜头运动、特效/光影、音效、旁白
- 每个镜头是连续时间段，最终会被渲染成「X-Y秒：镜头描述」格式
- 分镜数量控制在 4-5 个镜头，画面节奏要明显推进
- 第一个镜头必须有钩子，最后一个镜头必须收束
- 如果提供了 Logo，最后 2 秒必须预留落版镜头，并在画面描述中明确 @图片1
- 旁白文案必须口语化、有画面感、15 秒内能说完，总字数控制在 45-60 字左右
- 不要输出 Markdown，不要解释思路，只输出 JSON
`;

const STORYBOARD_REFINER_SYSTEM_PROMPT = `你是一位短视频总导演兼剪辑指导，负责把已有分镜优化成更强画面感、更强节奏感、更适合即梦生成的版本。

你的优化重点：
- 第一镜头是否足够抓人
- 每个镜头是否真的有清晰画面，而不是抽象口号
- 镜头推进是否连贯，15 秒内是否有起承转合
- 每个镜头是否都写清楚主体、动作、场景、镜头运动、特效/光影、音效、旁白
- 最终是否适合直接渲染成“X-Y秒：...”的时间戳 prompt
- 如果有 Logo，最后 2 秒是否明确收口到 @图片1 落版

不要减少信息量，不要输出解释，只返回优化后的 JSON 数组。`;

function buildShotWindows(count: number, totalDuration = 15, reserveClosingSeconds = 0) {
  if (count <= 0) return [];
  if (count === 1) return [{ startSecond: 0, endSecond: totalDuration }];

  const normalShotCount = reserveClosingSeconds > 0 ? count - 1 : count;
  const normalDuration = totalDuration - reserveClosingSeconds;
  const windows: Array<{ startSecond: number; endSecond: number }> = [];

  if (normalShotCount <= 0) {
    return [{ startSecond: 0, endSecond: totalDuration }];
  }

  let cursor = 0;
  for (let index = 0; index < normalShotCount; index += 1) {
    const next =
      index === normalShotCount - 1
        ? normalDuration
        : Math.round(((index + 1) * normalDuration) / normalShotCount);
    windows.push({
      startSecond: cursor,
      endSecond: next,
    });
    cursor = next;
  }

  if (reserveClosingSeconds > 0) {
    windows.push({
      startSecond: totalDuration - reserveClosingSeconds,
      endSecond: totalDuration,
    });
  }

  return windows;
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStoryboardPlan(
  raw: StoryboardPlan,
  hasLogo: boolean,
  brandName: string
): StoryboardPlan {
  const reserveClosingSeconds = hasLogo ? 2 : 0;
  const shots = Array.isArray(raw.shots) ? raw.shots : [];
  const filteredShots = shots
    .map((shot) => ({
      shotName: normalizeText(shot.shotName) || "镜头",
      visual: normalizeText(shot.visual),
      camera: normalizeText(shot.camera),
      motion: normalizeText(shot.motion),
      effect: normalizeText(shot.effect),
      light: normalizeText(shot.light),
      audio: normalizeText(shot.audio),
      voiceover: normalizeText(shot.voiceover),
    }))
    .filter((shot) => shot.visual || shot.voiceover || shot.camera);

  const fallbackShots =
    filteredShots.length > 0
      ? filteredShots
      : [
          {
            shotName: "开场钩子",
            visual: `${brandName}相关主体强势入镜，快速建立视觉记忆点`,
            camera: "近景快速推进",
            motion: "主体向镜头前方运动",
            effect: "高对比节奏切换",
            light: "电影级质感光影",
            audio: "环境氛围音逐步抬升",
            voiceover: `${brandName}，一开场就让人记住。`,
          },
          {
            shotName: "卖点展开",
            visual: "展示产品核心使用场景和关键卖点",
            camera: "中近景跟拍",
            motion: "主体动作自然推进",
            effect: "细节高光和材质特写",
            light: "干净通透的商业光效",
            audio: "产品细节音效清晰可辨",
            voiceover: "好看之外，更重要的是它真的好用。",
          },
          {
            shotName: "结尾收束",
            visual: hasLogo
              ? `品牌标识@图片1从画面中央渐入，形成广告片式收尾`
              : "主角完成动作后定格收束，画面情绪自然落点",
            camera: "慢推定格",
            motion: "节奏放缓",
            effect: "粒子与光晕轻柔收口",
            light: "柔光收尾",
            audio: "尾音渐弱",
            voiceover: hasLogo ? `${brandName}，把记忆点留在最后两秒。` : "看完这一秒，记住这个画面。",
          },
        ];

  const windows = buildShotWindows(fallbackShots.length, 15, reserveClosingSeconds);
  const normalizedShots = fallbackShots.map((shot, index) => {
    const window = windows[index] ?? { startSecond: 0, endSecond: 15 };
    const isClosingShot = hasLogo && index === fallbackShots.length - 1;

    return {
      ...shot,
      startSecond: window.startSecond,
      endSecond: window.endSecond,
      visual: isClosingShot && !shot.visual.includes("@图片1")
        ? `${shot.visual}，品牌标识@图片1从画面中央渐入放大`
        : shot.visual,
    };
  });

  return {
    title: normalizeText(raw.title) || `${brandName} ${normalizeText(raw.hook) || "分镜版提示词"}`,
    hook: normalizeText(raw.hook),
    storyArc: normalizeText(raw.storyArc),
    voiceTone: normalizeText(raw.voiceTone) || "温柔女声，节奏清晰",
    shots: normalizedShots,
  };
}

function extractScript(plan: StoryboardPlan) {
  return plan.shots
    .map((shot) => shot.voiceover.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function renderTimestampPrompt(plan: StoryboardPlan) {
  return plan.shots
    .map((shot) => {
      const voice = shot.voiceover
        ? `旁白（${plan.voiceTone}）道："${shot.voiceover}"`
        : "";
      return `${shot.startSecond}-${shot.endSecond}秒：${shot.visual}。镜头：${shot.camera}${shot.motion ? `，${shot.motion}` : ""}。特效/光影：${shot.effect}${shot.light ? `，${shot.light}` : ""}。音效：${shot.audio}${voice ? `。${voice}` : ""}`;
    })
    .join("\n");
}

async function generateStoryboardBatch(input: {
  model: ReturnType<typeof getGeminiModel>;
  brandProfile: Record<string, unknown>;
  brandProfileMarkdown: string;
  direction: string;
  style: string;
  count: number;
  keywords: unknown;
  hasLogo: boolean;
}) {
  const { model, brandProfile, brandProfileMarkdown, direction, style, count, keywords, hasLogo } = input;
  const logoInstruction = hasLogo
    ? "最后一个镜头必须是 13-15 秒的品牌落版镜头，并在 visual 中显式包含 @图片1。"
    : "最后一个镜头做情绪收束或转化收束，不需要 Logo 落版。";

  const storyboardPrompt = `请为以下品牌信息生成 ${count} 组「先分镜、后生成提示词」的视频分镜方案。

## 品牌摘要
${JSON.stringify(brandProfile, null, 2)}

## 品牌画像 Markdown
${brandProfileMarkdown}

## 本次方向
- 内容方向：${direction}
- 风格：${style}
- 关键词池：${JSON.stringify(keywords)}
- 时长：15秒
- 比例：9:16

## 分镜要求
- 每组分镜必须是 4-5 个镜头
- 每个镜头都要适合最终渲染成「几秒到几秒一个镜头」的提示词格式
- 第一镜头必须强钩子，最后一镜头必须完成收束
- 每个镜头必须包含：shotName、visual、camera、motion、effect、light、audio、voiceover
- voiceover 是该镜头里真正要说的话，口语化、有记忆点
- ${logoInstruction}

## 输出格式
只返回 JSON 数组，不要任何额外说明：
[
  {
    "title": "方案标题",
    "hook": "这条视频的前3秒钩子",
    "storyArc": "这条视频的情绪推进",
    "voiceTone": "如：温柔女声，真诚但有节奏",
    "shots": [
      {
        "shotName": "镜头名称",
        "visual": "画面里看到什么",
        "camera": "镜头语言",
        "motion": "动作或转场",
        "effect": "特效细节",
        "light": "光影与质感",
        "audio": "环境音/音效",
        "voiceover": "这一个镜头对应的旁白或台词"
      }
    ]
  }
]`;

  const result = await withGeminiRetry("storyboard generation", () =>
    model.generateContent({
      contents: [{ role: "user", parts: [{ text: storyboardPrompt }] }],
      systemInstruction: `${STORYBOARD_SYSTEM_PROMPT}\n\n以下是即梦提示词规则与模板参考，请把这些约束前置到分镜设计中：\n${SYSTEM_PROMPT}`,
    })
  );

  const text = result.response.text();
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error("未能生成有效的分镜设计，请重试");
  }

  return JSON.parse(jsonMatch[0]) as StoryboardPlan[];
}

async function refineStoryboardBatch(input: {
  model: ReturnType<typeof getGeminiModel>;
  brandProfile: Record<string, unknown>;
  brandProfileMarkdown: string;
  direction: string;
  style: string;
  keywords: unknown;
  hasLogo: boolean;
  plans: StoryboardPlan[];
}) {
  const { model, brandProfile, brandProfileMarkdown, direction, style, keywords, hasLogo, plans } = input;

  if (plans.length === 0) return plans;

  const refinePrompt = `请对以下分镜方案做自动优化，不要改变总方向，只提升画面感、可生成性和节奏感。

## 品牌摘要
${JSON.stringify(brandProfile, null, 2)}

## 品牌画像 Markdown
${brandProfileMarkdown}

## 本次方向
- 内容方向：${direction}
- 风格：${style}
- 关键词池：${JSON.stringify(keywords)}
- 是否有 Logo 落版：${hasLogo ? "有，最后 2 秒必须包含 @图片1" : "无"}

## 待优化分镜
${JSON.stringify(plans, null, 2)}

## 优化要求
- 保留原方案核心卖点与叙事方向
- 把抽象表达改成能看见的镜头画面
- 加强镜头之间的推进关系，避免每个镜头像独立句子
- 旁白要更口语化，且能和镜头同步
- 不能输出 Markdown，不能输出说明，只返回优化后的 JSON 数组`;

  const result = await withGeminiRetry("storyboard refinement", () =>
    model.generateContent({
      contents: [{ role: "user", parts: [{ text: refinePrompt }] }],
      systemInstruction: STORYBOARD_REFINER_SYSTEM_PROMPT,
    })
  );

  const text = result.response.text();
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return plans;

  try {
    return JSON.parse(jsonMatch[0]) as StoryboardPlan[];
  } catch {
    return plans;
  }
}

async function generateDirectPromptBatch(input: {
  model: ReturnType<typeof getGeminiModel>;
  brandProfile: Record<string, unknown>;
  brandProfileMarkdown: string;
  direction: string;
  style: string;
  count: number;
  keywords: unknown;
  logoUrl?: string;
}) {
  const { model, brandProfile, brandProfileMarkdown, direction, style, count, keywords, logoUrl } = input;
  const hasLogo = !!logoUrl;

  const logoInstruction = hasLogo
    ? `\n- 【必须】每条提示词结尾 13-15 秒加入落版收尾，品牌标识@图片1从画面中央渐入，参见系统提示中的「品牌落版规则」`
    : "";

  const userPrompt = `请根据以下品牌信息，为「${direction}」方向生成 ${count} 条即梦AI视频提示词。

## 品牌摘要
${JSON.stringify(brandProfile, null, 2)}

## 品牌画像 Markdown（请优先根据这份画像生成提示词，里面包含可复用的品牌洞察与素材引用）
${brandProfileMarkdown}

## 生成要求
- 方向：${direction}
- 风格：${style}（请使用模板库中对应风格的模板）
- 时长：15秒
- 比例：9:16 竖屏
- 品牌人格：${brandProfile.brandPersonality || "自然真实"}
- 视频基调：${brandProfile.videoTone || "自然真实"}
- 关键词参考：${JSON.stringify(keywords)}${logoInstruction}
- 必须尽量吸收品牌画像 Markdown 中的用户洞察、叙事角度、视觉信号、禁忌元素和素材引用
- 如果 Markdown 中出现图片引用，请把它理解为品牌素材库。只有 Logo 落版时可以显式使用 @图片1，其余素材只作为创意参考，不要在最终 prompt 里输出 Markdown 链接

## 重要：配音旁白必须嵌入提示词

即梦AI 可以直接根据提示词生成语音配音，所以旁白/台词必须写在提示词内部（音效段落中），格式如：
- 旁白（温柔女声）道："文案内容"
- 旁白（磁性男声）道："文案内容"
- 台词（角色，情绪）："文案内容"

旁白内容要求：45-60字以内，凝练有力，口语化，有记忆点。

## 输出格式
返回一个 JSON 数组，每个元素包含：
- prompt：完整的视频提示词（200-500字，遵循 SCELA 公式，旁白/台词已嵌入其中，纯文本无Markdown符号）
- script：提取出提示词中的旁白/台词文字（仅用于前端展示，不会单独发送给即梦）

[
  {
    "prompt": "完整提示词",
    "script": "旁白或台词提取"
  }
]

只返回 JSON 数组，不要有任何其他文字。`;

  const result = await withGeminiRetry("direct prompt generation", () =>
    model.generateContent({
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      systemInstruction: SYSTEM_PROMPT,
    })
  );

  const text = result.response.text();
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error("未能生成有效的提示词，请重试");
  }

  return JSON.parse(jsonMatch[0]) as Array<{ prompt: string; script: string }>;
}

export const seedancePrompterSkill: SkillDefinition = {
  name: "seedance-prompter",
  description:
    "Generate 即梦AI (Seedance 2.0) video prompts with matching voiceover scripts. All prompts are 15s, 9:16.",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      brandProfile: {
        type: SchemaType.STRING,
        description: "JSON string of brand profile summary",
      },
      brandProfileMarkdown: {
        type: SchemaType.STRING,
        description: "Markdown document of the detailed brand profile",
      },
      direction: {
        type: SchemaType.STRING,
        description: "Content direction name",
      },
      style: {
        type: SchemaType.STRING,
        description: "Video style category",
      },
      count: {
        type: SchemaType.STRING,
        description: "Number of prompts to generate",
      },
      keywordPool: {
        type: SchemaType.STRING,
        description: "JSON string of keyword pool from strategy",
      },
      logoUrl: {
        type: SchemaType.STRING,
        description: "Optional brand logo public URL. When provided, every prompt must end with a closing slate using @图片1.",
      },
    },
    required: ["brandProfile", "direction", "style", "count"],
  },
  handler: async (params) => {
    const model = getGeminiModel({ model: getDefaultGeminiModelName() });
    const storyboardModel = getGeminiModel({ model: getDefaultGeminiAnalysisModelName() });
    const profile = JSON.parse(params.brandProfile as string);
    const brandProfileMarkdown = (params.brandProfileMarkdown as string) || "";
    const keywords = params.keywordPool ? JSON.parse(params.keywordPool as string) : {};
    const count = parseInt(params.count as string);
    const logoUrl = params.logoUrl as string | undefined;
    const hasLogo = !!logoUrl;
    const useStoryboardPipeline = shouldUseStoryboardPipeline();

    const generatedItems: PromptItem[] = [];
    const chunkSize = 5;

    for (let start = 0; start < count; start += chunkSize) {
      const currentCount = Math.min(chunkSize, count - start);
      if (!useStoryboardPipeline) {
        const directItems = await generateDirectPromptBatch({
          model,
          brandProfile: profile,
          brandProfileMarkdown,
          direction: params.direction as string,
          style: params.style as string,
          count: currentCount,
          keywords,
          logoUrl,
        });

        generatedItems.push(
          ...directItems.map((item) => ({
            content: stripMarkdown(item.prompt),
            script: item.script,
            duration: 15,
            ratio: "9:16",
            style: params.style as string,
            direction: params.direction as string,
            referenceImageUrls: hasLogo && logoUrl ? [logoUrl] : [],
          }))
        );
        continue;
      }

      try {
        const draftPlans = await generateStoryboardBatch({
          model: storyboardModel,
          brandProfile: profile,
          brandProfileMarkdown,
          direction: params.direction as string,
          style: params.style as string,
          count: currentCount,
          keywords,
          hasLogo,
        });

        let plansToUse = draftPlans;
        try {
          plansToUse = await refineStoryboardBatch({
            model: storyboardModel,
            brandProfile: profile,
            brandProfileMarkdown,
            direction: params.direction as string,
            style: params.style as string,
            keywords,
            hasLogo,
            plans: draftPlans,
          });
        } catch (error) {
          console.warn("[seedance-prompter] Storyboard refinement failed, using draft storyboard plans.", error);
        }

        const normalizedItems = plansToUse
          .slice(0, currentCount)
          .map((plan) =>
            normalizeStoryboardPlan(plan, hasLogo, String(profile.brandName || params.direction || "品牌"))
          );

        while (normalizedItems.length < currentCount) {
          normalizedItems.push(
            normalizeStoryboardPlan(
              {
                title: `${String(profile.brandName || params.direction || "品牌")} 备用分镜 ${generatedItems.length + normalizedItems.length + 1}`,
                hook: "开头直接给到品牌最有记忆点的视觉钩子",
                storyArc: "从吸引注意到建立信任，再自然收束",
                voiceTone: "温柔女声，节奏清晰",
                shots: [],
              },
              hasLogo,
              String(profile.brandName || params.direction || "品牌")
            )
          );
        }

        generatedItems.push(
          ...normalizedItems.map((item) => ({
            content: stripMarkdown(renderTimestampPrompt(item)),
            script: extractScript(item),
            storyboard: item,
            duration: 15,
            ratio: "9:16",
            style: params.style as string,
            direction: params.direction as string,
            referenceImageUrls: hasLogo && logoUrl ? [logoUrl] : [],
          }))
        );
      } catch (error) {
        console.warn("[seedance-prompter] Storyboard generation failed, falling back to direct prompt generation.", error);
        const directItems = await generateDirectPromptBatch({
          model,
          brandProfile: profile,
          brandProfileMarkdown,
          direction: params.direction as string,
          style: params.style as string,
          count: currentCount,
          keywords,
          logoUrl,
        });

        generatedItems.push(
          ...directItems.map((item) => ({
            content: stripMarkdown(item.prompt),
            script: item.script,
            duration: 15,
            ratio: "9:16",
            style: params.style as string,
            direction: params.direction as string,
            referenceImageUrls: hasLogo && logoUrl ? [logoUrl] : [],
          }))
        );
      }
    }

    // Strip any Markdown formatting that slipped through (即梦 only accepts plain text)
    function stripMarkdown(text: string): string {
      return text
        .replace(/\*\*([^*]+)\*\*/g, "$1")   // **bold** → bold
        .replace(/\*([^*]+)\*/g, "$1")        // *italic* → italic
        .replace(/^#{1,6}\s+/gm, "")          // # headings
        .replace(/^[-*]\s+/gm, "")            // - list items
        .replace(/`([^`]+)`/g, "$1");          // `code`
    }

    return generatedItems.slice(0, count);
  },
};
