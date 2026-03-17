import { SchemaType } from "@google/generative-ai";
import { gemini } from "@/lib/gemini";
import { SkillDefinition } from "./registry";

export const brandAnalyzerSkill: SkillDefinition = {
  name: "brand-analyzer",
  description:
    "Analyze uploaded brand files (images, PDFs) and questionnaire answers to extract structured brand profile information.",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      fileUrls: {
        type: SchemaType.STRING,
        description: "JSON array of uploaded file URLs to analyze",
      },
      questionnaireAnswers: {
        type: SchemaType.STRING,
        description: "JSON object of questionnaire question-answer pairs",
      },
      basicInfo: {
        type: SchemaType.STRING,
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
