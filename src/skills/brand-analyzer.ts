import { SchemaType, Part } from "@google/generative-ai";
import { GoogleAIFileManager } from "@google/generative-ai/server";
import { gemini } from "@/lib/gemini";
import { SkillDefinition } from "./registry";
import { readFile } from "fs/promises";
import path from "path";

const BRAND_PROFILE_SCHEMA = `
请返回严格的 JSON 格式，不要有任何其他文字：
{
  "brandName": "品牌名称",
  "industry": "所属行业（如：美妆、食品、3C数码、服装、家居、教育、健康等）",
  "productDescription": "核心产品或服务的简要描述（50-100字）",
  "brandPersonality": "2-3个形容词描述品牌个性，例如：年轻、活力、专业",
  "coreSellingPoints": ["核心卖点1", "核心卖点2", "核心卖点3"],
  "targetAudience": "详细描述目标用户群体（年龄、性别、职业、消费习惯等）",
  "recommendedStyles": ["从以下选择2-3个最合适的风格：产品/电商/广告、生活/治愈/Vlog、短剧/对白/情感、舞蹈/MV/卡点、变身/变装/转场、动作/战斗/追逐、仙侠/奇幻/史诗、科幻/机甲/末日"],
  "videoTone": "视频整体基调（如：温暖治愈、高端大气、活力青春、专业可信等）",
  "complianceNotes": ["该行业需要注意的合规事项或内容禁忌"]
}

注意：
- brandName 必须填写，如果资料中没有明确品牌名，请从描述中提取最可能的品牌/产品名
- industry 必须是具体行业，不要写"综合"
- productDescription 要具体说明是什么产品/服务，不要泛泛而谈
- coreSellingPoints 要提炼出差异化卖点，适合在15秒短视频中快速传达`;

function urlToFilePath(url: string): string {
  return path.join(process.cwd(), url);
}

function getMimeType(url: string): "image/jpeg" | "image/png" | "image/webp" | "application/pdf" {
  const ext = url.split(".").pop()?.toLowerCase();
  const map: Record<string, "image/jpeg" | "image/png" | "image/webp" | "application/pdf"> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    pdf: "application/pdf",
  };
  return map[ext ?? ""] ?? "image/jpeg";
}

async function buildFileParts(fileUrls: string[]): Promise<Part[]> {
  const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY!);
  const parts: Part[] = [];

  for (const url of fileUrls) {
    const filePath = urlToFilePath(url);
    const filename = url.split("/").pop() ?? url;
    const mimeType = getMimeType(url);

    try {
      const uploadResult = await fileManager.uploadFile(filePath, {
        mimeType,
        displayName: filename,
      });
      parts.push({
        fileData: { fileUri: uploadResult.file.uri, mimeType },
      });
      console.log(`[brand-analyzer] 已上传到 Gemini: ${filename}`);
    } catch (err) {
      console.error(`[brand-analyzer] 文件上传失败: ${filename}`, err);
      if (mimeType !== "application/pdf") {
        try {
          const buffer = await readFile(filePath);
          parts.push({
            inlineData: { data: buffer.toString("base64"), mimeType },
          });
        } catch {
          console.error(`[brand-analyzer] 读取文件失败: ${filename}`);
        }
      }
    }
  }

  return parts;
}

export const brandAnalyzerSkill: SkillDefinition = {
  name: "brand-analyzer",
  description:
    "Analyze brand materials to generate a complete brand profile for 15s promotional short video ads.",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      description: {
        type: SchemaType.STRING,
        description: "Free-text description of the brand",
      },
      fileUrls: {
        type: SchemaType.STRING,
        description: "JSON array of uploaded file URLs",
      },
    },
    required: [],
  },
  handler: async (params) => {
    const model = gemini.getGenerativeModel({ model: "gemini-2.5-flash" });
    const description = ((params.description as string) || "").trim();
    const fileUrls = JSON.parse((params.fileUrls as string) || "[]") as string[];

    const contentParts: Part[] = [];

    contentParts.push({
      text: `你是一位资深的品牌策略师和短视频营销专家。
你的任务是基于商家提供的品牌信息，生成一份完整的品牌画像。
这份画像将用于批量自动生成 15秒品宣短视频广告（投放抖音、小红书、视频号等平台）。
请确保提取出品牌名称、行业、产品描述等核心信息。`,
    });

    if (description) {
      contentParts.push({ text: `\n【商家描述】\n${description}` });
    }

    if (fileUrls.length > 0) {
      contentParts.push({
        text: `\n【品牌资料文件】以下是 ${fileUrls.length} 个品牌资料文件，请仔细提取品牌名称、产品信息、卖点等：`,
      });
      const fileParts = await buildFileParts(fileUrls);
      contentParts.push(...fileParts);
    }

    if (fileUrls.length === 0 && !description) {
      throw new Error("请提供品牌描述或上传品牌资料文件");
    }

    contentParts.push({ text: `\n请综合以上所有信息，${BRAND_PROFILE_SCHEMA}` });

    const result = await model.generateContent(contentParts);
    const text = result.response.text();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("AI 未能生成有效的品牌画像，请重试或补充更多信息");
    return JSON.parse(jsonMatch[0]);
  },
};
