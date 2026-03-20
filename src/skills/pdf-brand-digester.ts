import { SchemaType } from "@google/generative-ai";
import { getDefaultGeminiAnalysisModelName, getGeminiModel, withGeminiRetry } from "@/lib/gemini";
import {
  extractPdfText,
  isPdfFile,
  uploadedFileUrlToPath,
} from "@/lib/uploaded-assets";
import type { PdfBrandDigest } from "@/types/pdf-digest";
import type { SkillDefinition } from "./registry";

const PDF_BRAND_DIGEST_SCHEMA = `请返回严格 JSON：
{
  "brandFacts": {
    "brandName": "品牌名",
    "companyName": "公司主体名",
    "industry": "具体行业",
    "businessModel": "面向谁，提供什么服务",
    "productOrService": "核心产品/服务描述",
    "targetCustomers": ["目标客户类型"],
    "coreSellingPoints": ["核心卖点"],
    "proofPoints": ["数据、案例、资质、规模等证明点"],
    "brandTone": ["品牌气质词"],
    "complianceNotes": ["需要谨慎表达的点"]
  },
  "videoMarketingDigest": {
    "hookAngles": ["适合短视频前3秒的切入角度"],
    "contentPillars": ["可反复扩展的视频内容支柱"],
    "storyAngles": ["适合改写为广告/短视频的叙事方向"],
    "visualSignals": ["视觉符号、画面元素、场景线索"],
    "ctaAngles": ["适合的行动号召方向"],
    "mustMention": ["视频里建议明确点出的关键信息"],
    "mustAvoid": ["视频文案和表达中应避免的内容"]
  },
  "evidence": [
    {
      "insight": "提炼出的判断",
      "sources": ["来自哪些PDF文字线索"]
    }
  ]
}`;

async function buildPdfDigestPrompt(pdfFileUrls: string[], description: string) {
  const sections: string[] = [];

  for (const [index, url] of pdfFileUrls.entries()) {
    const filePath = uploadedFileUrlToPath(url);
    const text = await extractPdfText(filePath);
    const filename = url.split("/").pop() ?? `pdf-${index + 1}`;

    if (!text) {
      sections.push(`【PDF资料${index + 1}：${filename}】未成功提取文字。`);
      continue;
    }

    sections.push(`【PDF资料${index + 1}：${filename}】\n${text}`);
  }

  return [
    "你是一位专门为短视频营销服务的品牌资料解析专家。",
    "你的任务不是直接写视频，而是先把 PDF 品牌资料拆成结构化品牌情报，供后续品牌画像和提示词生成使用。",
    description ? `【商家补充说明】\n${description}` : "",
    `【待解析的PDF文字】\n${sections.join("\n\n")}`,
    `请只输出严格 JSON。\n${PDF_BRAND_DIGEST_SCHEMA}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export const pdfBrandDigesterSkill: SkillDefinition = {
  name: "pdf-brand-digester",
  description:
    "Digest uploaded brand PDFs into a structured marketing-oriented brand brief for downstream video strategy and prompt generation.",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      description: {
        type: SchemaType.STRING,
        description: "Optional extra merchant description to help disambiguate the PDF content.",
      },
      pdfFileUrls: {
        type: SchemaType.STRING,
        description: "JSON array of uploaded PDF file URLs.",
      },
    },
    required: ["pdfFileUrls"],
  },
  handler: async (params) => {
    const model = getGeminiModel({ model: getDefaultGeminiAnalysisModelName() });
    const description = ((params.description as string) || "").trim();
    const urls = JSON.parse((params.pdfFileUrls as string) || "[]") as string[];
    const pdfFileUrls = urls.filter(isPdfFile);

    if (pdfFileUrls.length === 0) {
      return null;
    }

    const prompt = await buildPdfDigestPrompt(pdfFileUrls, description);
    const result = await withGeminiRetry("pdf brand digest", () =>
      model.generateContent(prompt)
    );
    const text = result.response.text();
    const jsonMatch = text.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      throw new Error("PDF 品牌资料解析未返回有效 JSON");
    }

    return JSON.parse(jsonMatch[0]) as PdfBrandDigest;
  },
};
