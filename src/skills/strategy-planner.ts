import { SchemaType } from "@google/generative-ai";
import { getDefaultGeminiModelName, getGeminiModel, withGeminiRetry } from "@/lib/gemini";
import type { SkillDefinition } from "./registry";

export const strategyPlannerSkill: SkillDefinition = {
  name: "strategy-planner",
  description:
    "Generate a video content matrix and keyword pool based on the brand profile.",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      brandProfile: {
        type: SchemaType.STRING,
        description: "JSON string of the brand profile summary",
      },
      brandProfileMarkdown: {
        type: SchemaType.STRING,
        description: "Markdown document for the detailed brand profile",
      },
      strategySystemPrompt: {
        type: SchemaType.STRING,
        description: "Optional strategy system prompt derived from the brand profile",
      },
      totalVideos: {
        type: SchemaType.STRING,
        description: "Total number of videos to plan for (as string)",
      },
    },
    required: ["brandProfile"],
  },
  handler: async (params) => {
    const model = getGeminiModel({ model: getDefaultGeminiModelName() });
    const profile = JSON.parse(params.brandProfile as string);
    const brandProfileMarkdown = (params.brandProfileMarkdown as string) || "";
    const strategySystemPrompt = (params.strategySystemPrompt as string) || "";
    const total = parseInt((params.totalVideos as string) || "50");

    const prompt = `
请根据以下品牌画像资料，规划适合中国社交媒体（抖音、小红书、视频号）的短视频内容矩阵。

## 品牌画像摘要
${JSON.stringify(profile, null, 2)}

## 品牌画像 Markdown（优先依据这份资料判断）
${brandProfileMarkdown}

## 任务目标
需要规划的视频总数：${total}

请生成内容矩阵。只返回 JSON，不要有其他文字：
{
  "contentMatrix": [
    {
      "direction": "方向名称（中文）",
      "description": "该方向覆盖的内容",
      "style": "从品牌画像的 recommendedStyles 中选择最匹配的风格",
      "duration": 15,
      "suggestedCount": 10
    }
  ],
  "keywordPool": {
    "selling": ["卖点关键词"],
    "emotion": ["情感调性词"],
    "scene": ["场景/环境词"]
  }
}

注意：
- 所有视频时长固定为 15 秒（duration 必须为 15）
- style 必须是以下之一：产品/电商/广告、生活/治愈/Vlog、短剧/对白/情感、舞蹈/MV/卡点、变身/变装/转场、动作/战斗/追逐、仙侠/奇幻/史诗、科幻/机甲/末日
- suggestedCount 总和应约等于 ${total}
- 创建 3-5 个方向
- 每个方向都要能够继续批量扩展成多条不同提示词，而不是只适合做一条视频
- 方向命名、description、keywordPool 必须体现品牌画像中的用户洞察、卖点、场景、视觉信号与合规边界`;

    const result = await withGeminiRetry("strategy planning", () =>
      model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        systemInstruction:
          strategySystemPrompt ||
          "你是一位资深短视频策略师，擅长把品牌画像拆解成可批量执行的视频内容方向。",
      })
    );
    const text = result.response.text();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Failed to extract strategy JSON");
    return JSON.parse(jsonMatch[0]);
  },
};
