import { SchemaType } from "@google/generative-ai";
import { gemini } from "@/lib/gemini";
import { SkillDefinition } from "./registry";

export const strategyPlannerSkill: SkillDefinition = {
  name: "strategy-planner",
  description:
    "Generate a video content matrix and keyword pool based on the brand profile.",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      brandProfile: {
        type: SchemaType.STRING,
        description: "JSON string of the brand profile",
      },
      totalVideos: {
        type: SchemaType.STRING,
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
