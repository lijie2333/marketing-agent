import { SchemaType } from "@google/generative-ai";
import { gemini } from "@/lib/gemini";
import { SkillDefinition } from "./registry";

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
        description: "Video style (e.g. 产品/电商/广告)",
      },
      duration: {
        type: SchemaType.STRING,
        description: "Video duration in seconds (5, 10, or 15)",
      },
      count: {
        type: SchemaType.STRING,
        description: "Number of prompts to generate",
      },
      keywordPool: {
        type: SchemaType.STRING,
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
