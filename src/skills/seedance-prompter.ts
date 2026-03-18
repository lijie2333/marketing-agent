import { SchemaType } from "@google/generative-ai";
import { gemini } from "@/lib/gemini";
import { SkillDefinition } from "./registry";
import { readFileSync } from "fs";
import path from "path";

// Load seedance-bot reference materials at startup
const REFS_DIR = path.join(process.cwd(), "skills/seedance-bot/references");
const PROMPT_TEMPLATES = readFileSync(path.join(REFS_DIR, "prompt-templates.md"), "utf-8");
const COMPLIANCE = readFileSync(path.join(REFS_DIR, "compliance.md"), "utf-8");
const VOCAB = readFileSync(path.join(REFS_DIR, "vocab.md"), "utf-8");

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

export const seedancePrompterSkill: SkillDefinition = {
  name: "seedance-prompter",
  description:
    "Generate 即梦AI (Seedance 2.0) video prompts with matching voiceover scripts. All prompts are 15s, 9:16.",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      brandProfile: {
        type: SchemaType.STRING,
        description: "JSON string of brand profile",
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
    const model = gemini.getGenerativeModel({ model: "gemini-2.5-flash" });
    const profile = JSON.parse(params.brandProfile as string);
    const keywords = params.keywordPool ? JSON.parse(params.keywordPool as string) : {};
    const count = parseInt(params.count as string);
    const logoUrl = params.logoUrl as string | undefined;
    const hasLogo = !!logoUrl;

    const logoInstruction = hasLogo
      ? `\n- 【必须】每条提示词结尾 13-15 秒加入落版收尾，品牌标识@图片1从画面中央渐入，参见系统提示中的「品牌落版规则」`
      : "";

    const userPrompt = `请根据以下品牌信息，为「${params.direction}」方向生成 ${count} 条即梦AI视频提示词。

## 品牌信息
${JSON.stringify(profile, null, 2)}

## 生成要求
- 方向：${params.direction}
- 风格：${params.style}（请使用模板库中对应风格的模板）
- 时长：15秒
- 比例：9:16 竖屏
- 品牌人格：${profile.brandPersonality || "自然真实"}
- 视频基调：${profile.videoTone || "自然真实"}
- 关键词参考：${JSON.stringify(keywords)}${logoInstruction}

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

\`\`\`json
[
  {
    "prompt": "（完整提示词，包含嵌入的旁白/台词）",
    "script": "（从提示词中提取的旁白文字，如：每一件衣服，都是和自己的一次对话。）"
  }
]
\`\`\`

只返回 JSON 数组，不要有任何其他文字。`;

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      systemInstruction: SYSTEM_PROMPT,
    });

    const text = result.response.text();
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error("未能生成有效的提示词，请重试");
    const items: Array<{ prompt: string; script: string }> = JSON.parse(jsonMatch[0]);

    // Strip any Markdown formatting that slipped through (即梦 only accepts plain text)
    function stripMarkdown(text: string): string {
      return text
        .replace(/\*\*([^*]+)\*\*/g, "$1")   // **bold** → bold
        .replace(/\*([^*]+)\*/g, "$1")        // *italic* → italic
        .replace(/^#{1,6}\s+/gm, "")          // # headings
        .replace(/^[-*]\s+/gm, "")            // - list items
        .replace(/`([^`]+)`/g, "$1");          // `code`
    }

    return items.map((item) => ({
      content: stripMarkdown(item.prompt),
      script: item.script,
      duration: 15,
      ratio: "9:16",
      style: params.style as string,
      direction: params.direction as string,
      referenceImageUrls: hasLogo && logoUrl ? [logoUrl] : [],
    }));
  },
};
