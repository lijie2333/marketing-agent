import { SchemaType, Part } from "@google/generative-ai";
import {
  createGeminiFileManager,
  getDefaultGeminiAnalysisModelName,
  getGeminiModel,
  withGeminiRetry,
} from "@/lib/gemini";
import type { SkillDefinition } from "./registry";
import { readFile } from "fs/promises";
import { normalizeBrandAnalyzerResult } from "@/lib/brand-profile";
import {
  extractPdfText,
  getUploadedFileMimeType,
  isPdfFile,
  uploadedFileUrlToPath,
} from "@/lib/uploaded-assets";
import type { PdfBrandDigest } from "@/types/pdf-digest";
import { pdfBrandDigesterSkill } from "./pdf-brand-digester";

const MAX_INLINE_IMAGE_BYTES = 4 * 1024 * 1024;

const BRAND_PROFILE_SCHEMA = `
请返回严格的 JSON 格式，不要有任何其他文字：
{
  "summary": {
    "brandName": "品牌名称",
    "industry": "所属行业（如：美妆、食品、3C数码、服装、家居、教育、健康等）",
    "productDescription": "核心产品或服务的简要描述（50-100字）",
    "brandPersonality": "2-4个形容词描述品牌个性，例如：年轻、活力、专业、克制",
    "coreSellingPoints": ["核心卖点1", "核心卖点2", "核心卖点3"],
    "targetAudience": "详细描述目标用户群体（年龄、性别、职业、消费习惯等）",
    "recommendedStyles": ["从以下选择2-3个最合适的风格：产品/电商/广告、生活/治愈/Vlog、短剧/对白/情感、舞蹈/MV/卡点、变身/变装/转场、动作/战斗/追逐、仙侠/奇幻/史诗、科幻/机甲/末日"],
    "videoTone": "视频整体基调（如：温暖治愈、高端大气、活力青春、专业可信等）",
    "complianceNotes": ["该行业需要注意的合规事项或内容禁忌"]
  },
  "detailedProfile": {
    "overview": {
      "brandEssence": "一句话概括品牌底层价值",
      "brandStory": "品牌故事或品牌成立逻辑",
      "positioningStatement": "定位句",
      "valueProposition": "核心价值主张",
      "personalityTraits": ["人格特征"],
      "emotionalKeywords": ["情绪关键词"],
      "trustSignals": ["信任信号，比如认证、口碑、工艺、研发等"],
      "differentiation": ["差异化优势"]
    },
    "audienceInsights": {
      "primarySegments": [
        {
          "name": "核心细分人群名称",
          "profile": "这类人的画像描述",
          "painPoints": ["痛点"],
          "motivations": ["购买动机"],
          "triggers": ["触发成交的原因"],
          "objections": ["成交顾虑"],
          "preferredPlatforms": ["偏好平台"]
        }
      ],
      "secondarySegments": ["次级客群"],
      "purchaseJourney": ["从认知到转化的关键步骤"]
    },
    "productStrategy": {
      "heroOffers": [
        {
          "name": "主推产品/服务名",
          "role": "在品牌中的角色",
          "targetSegment": "面向谁",
          "keyFeatures": ["关键特征"],
          "coreBenefits": ["用户收益"],
          "useScenarios": ["适用场景"]
        }
      ],
      "pricePerception": "用户对价格带的感知",
      "reasonsToBelieve": ["用户为什么会信"],
      "bundleIdeas": ["可延展的组合售卖/加购想法"]
    },
    "contentPlaybook": {
      "communicationPillars": ["传播支柱"],
      "hookAngles": ["前3秒钩子角度"],
      "storyAngles": ["适合扩写成视频的叙事方向"],
      "recommendedScenes": ["高频拍摄场景"],
      "visualSignals": ["视觉符号和镜头要点"],
      "forbiddenElements": ["内容中不建议出现的元素"],
      "callToActionAngles": ["适合的行动号召方式"]
    },
    "operationsInsight": {
      "competitorAngles": ["可借鉴但需区隔的竞对切角"],
      "channelStrategy": ["平台策略建议"],
      "seasonalOpportunities": ["季节/节点机会"],
      "growthOpportunities": ["内容增长机会"]
    },
    "complianceAndRisk": {
      "hardConstraints": ["硬性约束"],
      "sensitiveClaims": ["容易踩线的敏感说法"],
      "reviewChecklist": ["内部审核清单"]
    },
    "evidence": [
      {
        "insight": "你从资料中提炼出的结论",
        "sources": ["结论来自的描述、图片或PDF线索"]
      }
    ],
    "strategyPromptNotes": {
      "planningFocus": ["视频策略规划必须抓住的重点"],
      "promptWritingFocus": ["写提示词时必须保持的重点"],
      "mustMention": ["建议在内容中明确点出的元素"],
      "mustAvoid": ["写视频内容时必须避开的表达"]
    }
  }
}

注意：
- 必须先输出 summary，再输出 detailedProfile
- brandName 必须填写，如果资料中没有明确品牌名，请从描述中提取最可能的品牌/产品名
- industry 必须是具体行业，不要写"综合"
- productDescription 要具体说明是什么产品/服务，不要泛泛而谈
- coreSellingPoints 要提炼出差异化卖点，适合在15秒短视频中快速传达
- detailedProfile 必须站在资深品牌运营和内容操盘手视角，尽可能把可执行信息补全，信息不足时做审慎推断，不要只重复原文
- evidence 必须尽量写，说明每条重要判断基于哪些资料线索`;

const FALLBACK_ANALYSIS_PROMPT = `你是一位资深的品牌策略师和短视频营销专家。
请基于商家描述、PDF提取文字和上传图片内容，生成一份可执行的品牌画像。
如果资料不完整，请做审慎推断，但不要编造明显不存在的事实。
请只返回严格 JSON，不要输出任何解释文字。`;

function formatPdfDigest(pdfDigest: PdfBrandDigest) {
  return JSON.stringify(pdfDigest, null, 2);
}

async function buildFallbackFileParts(fileUrls: string[]): Promise<Part[]> {
  const parts: Part[] = [];

  for (const [index, url] of fileUrls.entries()) {
    const filePath = uploadedFileUrlToPath(url);
    const filename = url.split("/").pop() ?? url;
    const mimeType = getUploadedFileMimeType(url);

    if (mimeType === "application/pdf") {
      const pdfText = await extractPdfText(filePath);
      if (pdfText) {
        parts.push({
          text: `\n【PDF资料${index + 1}：${filename}】\n${pdfText}`,
        });
      } else {
        parts.push({
          text: `\n【PDF资料${index + 1}：${filename}】\nPDF 已上传，但本地未能成功提取文字，请仅根据其他资料谨慎推断。`,
        });
      }
      continue;
    }

    try {
      const buffer = await readFile(filePath);
      parts.push({
        text: `\n【图片资料${index + 1}：${filename}】请结合这张品牌资料图片理解视觉风格、产品卖点、包装和使用场景。`,
      });

      if (buffer.length <= MAX_INLINE_IMAGE_BYTES) {
        parts.push({
          inlineData: {
            data: buffer.toString("base64"),
            mimeType,
          },
        });
      } else {
        parts.push({
          text: `图片文件较大（${Math.round(buffer.length / 1024 / 1024)}MB），请根据已有描述与其他资料继续分析。`,
        });
      }
    } catch (error) {
      console.error(`[brand-analyzer] 读取图片资料失败: ${filename}`, error);
    }
  }

  return parts;
}

async function buildFileParts(fileUrls: string[]): Promise<Part[]> {
  const parts: Part[] = [];
  let fileManager: ReturnType<typeof createGeminiFileManager> | null = null;

  for (const url of fileUrls) {
    const filePath = uploadedFileUrlToPath(url);
    const filename = url.split("/").pop() ?? url;
    const mimeType = getUploadedFileMimeType(url);

    if (mimeType === "application/pdf") {
      const pdfText = await extractPdfText(filePath);
      if (pdfText) {
        parts.push({
          text: `\n【PDF资料${filename}】\n${pdfText}`,
        });
        console.log(`[brand-analyzer] 已提取 PDF 文字: ${filename}`);
      } else {
        console.warn(`[brand-analyzer] PDF 未提取到有效文字: ${filename}`);
      }
      continue;
    }

    try {
      fileManager ||= createGeminiFileManager();
      const uploadResult = await withGeminiRetry(
        `upload file ${filename}`,
        () =>
          fileManager!.uploadFile(filePath, {
            mimeType,
            displayName: filename,
          }),
        2
      );
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

function buildPrimaryPromptParts(
  description: string,
  fileUrls: string[],
  pdfDigest: PdfBrandDigest | null
) {
  const contentParts: Part[] = [];

  contentParts.push({
    text: `你是一位资深的品牌策略师和短视频营销专家。
你的任务是基于商家提供的品牌信息，生成一份完整的品牌画像。
这份画像将用于批量自动生成 15秒品宣短视频广告（投放抖音、小红书、视频号等平台）。
请确保不仅提取品牌名称、行业、产品描述等核心信息，还要站在品牌运营视角补足用户洞察、内容抓手、增长机会和合规边界。`,
  });

  if (description) {
    contentParts.push({ text: `\n【商家描述】\n${description}` });
  }

  if (fileUrls.length > 0) {
    contentParts.push({
      text: `\n【品牌资料文件】以下是 ${fileUrls.length} 个品牌资料文件，请仔细提取品牌名称、产品信息、卖点等：`,
    });
  }

  if (pdfDigest) {
    contentParts.push({
      text: `\n【PDF品牌资料智能摘要】以下内容由专门的 PDF 品牌解析智能体提炼，适合作为短视频营销品牌画像的高可信输入：\n${formatPdfDigest(pdfDigest)}`,
    });
  }

  return contentParts;
}

async function buildFallbackPromptParts(
  description: string,
  fileUrls: string[],
  pdfDigest: PdfBrandDigest | null
) {
  const contentParts: Part[] = [];

  contentParts.push({ text: FALLBACK_ANALYSIS_PROMPT });

  if (description) {
    contentParts.push({ text: `\n【商家描述】\n${description}` });
  }

  if (fileUrls.length > 0) {
    contentParts.push({
      text: `\n【本地提取的品牌资料内容】以下内容由系统从 PDF 和图片中提取，用于失败兜底分析：`,
    });
    contentParts.push(...(await buildFallbackFileParts(fileUrls)));
  }

  if (pdfDigest) {
    contentParts.push({
      text: `\n【PDF品牌资料智能摘要】\n${formatPdfDigest(pdfDigest)}`,
    });
  }

  contentParts.push({
    text: `\n请综合以上所有信息，${BRAND_PROFILE_SCHEMA}`,
  });

  return contentParts;
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
      logoUrl: {
        type: SchemaType.STRING,
        description: "Optional brand logo URL",
      },
    },
    required: [],
  },
  handler: async (params) => {
    const model = getGeminiModel({ model: getDefaultGeminiAnalysisModelName() });
    const description = ((params.description as string) || "").trim();
    const fileUrls = JSON.parse((params.fileUrls as string) || "[]") as string[];
    const logoUrl = ((params.logoUrl as string) || "").trim() || null;
    const pdfFileUrls = fileUrls.filter(isPdfFile);

    if (fileUrls.length === 0 && !description) {
      throw new Error("请提供品牌描述或上传品牌资料文件");
    }

    let pdfDigest: PdfBrandDigest | null = null;
    if (pdfFileUrls.length > 0) {
      try {
        pdfDigest = await pdfBrandDigesterSkill.handler({
          description,
          pdfFileUrls: JSON.stringify(pdfFileUrls),
        }) as PdfBrandDigest | null;
      } catch (error) {
        console.warn("[brand-analyzer] PDF brand digester failed, continuing with raw PDF extraction.", error);
      }
    }

    const primaryParts = buildPrimaryPromptParts(description, fileUrls, pdfDigest);
    if (fileUrls.length > 0) {
      primaryParts.push(...(await buildFileParts(fileUrls)));
    }
    primaryParts.push({ text: `\n请综合以上所有信息，${BRAND_PROFILE_SCHEMA}` });

    let result;
    try {
      result = await withGeminiRetry("brand analysis", () =>
        model.generateContent(primaryParts)
      );
    } catch (error) {
      console.warn("[brand-analyzer] Primary multimodal analysis failed, falling back to local extracted content.", error);
      const fallbackParts = await buildFallbackPromptParts(description, fileUrls, pdfDigest);
      result = await withGeminiRetry(
        "brand analysis fallback",
        () => model.generateContent(fallbackParts),
        2
      );
    }

    const text = result.response.text();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("AI 未能生成有效的品牌画像，请重试或补充更多信息");
    const normalized = normalizeBrandAnalyzerResult(JSON.parse(jsonMatch[0]), {
      description,
      uploadedFileUrls: fileUrls,
      logoUrl,
    });

    return {
      ...normalized,
      pdfDigest,
    };
  },
};
