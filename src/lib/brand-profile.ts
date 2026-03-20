import type { PdfBrandDigest } from "@/types/pdf-digest";

const DEFAULT_STYLES = [
  "产品/电商/广告",
  "生活/治愈/Vlog",
  "短剧/对白/情感",
  "舞蹈/MV/卡点",
  "变身/变装/转场",
  "动作/战斗/追逐",
  "仙侠/奇幻/史诗",
  "科幻/机甲/末日",
] as const;

type UnknownRecord = Record<string, unknown>;

export interface BrandProfileSummary {
  brandName: string;
  industry: string;
  productDescription: string;
  brandPersonality: string;
  coreSellingPoints: string[];
  targetAudience: string;
  recommendedStyles: string[];
  videoTone: string;
  complianceNotes: string[];
}

export interface AudienceSegment {
  name: string;
  profile: string;
  painPoints: string[];
  motivations: string[];
  triggers: string[];
  objections: string[];
  preferredPlatforms: string[];
}

export interface ProductOffer {
  name: string;
  role: string;
  targetSegment: string;
  keyFeatures: string[];
  coreBenefits: string[];
  useScenarios: string[];
}

export interface DetailedBrandProfile {
  version: string;
  generatedAt: string;
  overview: {
    brandEssence: string;
    brandStory: string;
    positioningStatement: string;
    valueProposition: string;
    personalityTraits: string[];
    emotionalKeywords: string[];
    trustSignals: string[];
    differentiation: string[];
  };
  audienceInsights: {
    primarySegments: AudienceSegment[];
    secondarySegments: string[];
    purchaseJourney: string[];
  };
  productStrategy: {
    heroOffers: ProductOffer[];
    pricePerception: string;
    reasonsToBelieve: string[];
    bundleIdeas: string[];
  };
  contentPlaybook: {
    communicationPillars: string[];
    hookAngles: string[];
    storyAngles: string[];
    recommendedScenes: string[];
    visualSignals: string[];
    forbiddenElements: string[];
    callToActionAngles: string[];
  };
  operationsInsight: {
    competitorAngles: string[];
    channelStrategy: string[];
    seasonalOpportunities: string[];
    growthOpportunities: string[];
  };
  complianceAndRisk: {
    hardConstraints: string[];
    sensitiveClaims: string[];
    reviewChecklist: string[];
  };
  evidence: Array<{
    insight: string;
    sources: string[];
  }>;
  assetReferences: {
    logo?: {
      label: string;
      url: string;
      promptRef: string;
      usage: string;
    };
    uploadedFiles: Array<{
      label: string;
      url: string;
      type: "image" | "pdf" | "other";
      usage: string;
    }>;
  };
  strategyPromptNotes: {
    planningFocus: string[];
    promptWritingFocus: string[];
    mustMention: string[];
    mustAvoid: string[];
  };
  sourceDigest: {
    hasDescription: boolean;
    descriptionExcerpt: string;
    assetCount: number;
  };
}

export interface NormalizedBrandProfileResult {
  summary: BrandProfileSummary;
  detailedProfile: DetailedBrandProfile;
  brandProfileMarkdown: string;
  strategySystemPrompt: string;
  pdfDigest?: PdfBrandDigest | null;
}

interface NormalizeOptions {
  description?: string;
  uploadedFileUrls?: string[];
  logoUrl?: string | null;
}

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => asString(item))
    .filter(Boolean);
}

function pickFirstNonEmpty(...values: unknown[]): string {
  for (const value of values) {
    const text = asString(value);
    if (text) return text;
  }
  return "";
}

function dedupe(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function limit(items: string[], max: number): string[] {
  return dedupe(items).slice(0, max);
}

function guessBrandName(description: string): string {
  const fromQuote = description.match(/(?:我们是|品牌名是|叫做|品牌叫|公司叫)([^，。；\n]{2,20})/);
  return fromQuote?.[1]?.trim() || "未命名品牌";
}

function detectFileType(url: string): "image" | "pdf" | "other" {
  const lower = url.toLowerCase();
  if (/\.(png|jpe?g|webp|gif|bmp|svg)(\?|$)/.test(lower)) return "image";
  if (/\.pdf(\?|$)/.test(lower)) return "pdf";
  return "other";
}

function joinList(items: string[]): string {
  return items.filter(Boolean).join("、");
}

function buildAudienceSegments(value: unknown): AudienceSegment[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const record = asRecord(item);
      return {
        name: pickFirstNonEmpty(record.name, record.segmentName),
        profile: pickFirstNonEmpty(record.profile, record.description),
        painPoints: toStringArray(record.painPoints),
        motivations: toStringArray(record.motivations),
        triggers: toStringArray(record.triggers),
        objections: toStringArray(record.objections),
        preferredPlatforms: toStringArray(record.preferredPlatforms),
      };
    })
    .filter((segment) => segment.name || segment.profile);
}

function buildHeroOffers(value: unknown): ProductOffer[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const record = asRecord(item);
      return {
        name: pickFirstNonEmpty(record.name, record.productName),
        role: pickFirstNonEmpty(record.role, record.positioning),
        targetSegment: pickFirstNonEmpty(record.targetSegment, record.targetAudience),
        keyFeatures: toStringArray(record.keyFeatures),
        coreBenefits: toStringArray(record.coreBenefits),
        useScenarios: toStringArray(record.useScenarios),
      };
    })
    .filter((offer) => offer.name || offer.role);
}

function buildEvidence(value: unknown): Array<{ insight: string; sources: string[] }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const record = asRecord(item);
      return {
        insight: pickFirstNonEmpty(record.insight, record.finding),
        sources: toStringArray(record.sources),
      };
    })
    .filter((entry) => entry.insight);
}

function makeAssetReferences(uploadedFileUrls: string[]) {
  const uploadedFiles = uploadedFileUrls.map((url, index) => {
    const type = detectFileType(url);
    const label =
      type === "image"
        ? `资料图${index + 1}`
        : type === "pdf"
          ? `资料文档${index + 1}`
          : `资料附件${index + 1}`;

    return {
      label,
      url,
      type,
      usage:
        type === "image"
          ? "可作为产品细节、包装、空间、人物风格、材质和视觉氛围参考"
          : type === "pdf"
            ? "可作为品牌手册、介绍材料、卖点说明和话术依据"
            : "可作为品牌辅助资料参考",
    };
  });

  return { logo: undefined, uploadedFiles };
}

export function normalizeBrandAnalyzerResult(
  raw: unknown,
  options: NormalizeOptions
): NormalizedBrandProfileResult {
  const root = asRecord(raw);
  const summaryInput = asRecord(root.summary);
  const detailInput = asRecord(root.detailedProfile);
  const description = asString(options.description);
  const uploadedFileUrls = options.uploadedFileUrls ?? [];
  const fallbackBrandName = guessBrandName(description);

  const summary: BrandProfileSummary = {
    brandName: pickFirstNonEmpty(summaryInput.brandName, root.brandName) || fallbackBrandName,
    industry: pickFirstNonEmpty(summaryInput.industry, root.industry) || "待补充行业",
    productDescription:
      pickFirstNonEmpty(summaryInput.productDescription, root.productDescription) ||
      "品牌核心产品与服务信息待补充",
    brandPersonality:
      pickFirstNonEmpty(summaryInput.brandPersonality, root.brandPersonality) ||
      "专业、可信、鲜明",
    coreSellingPoints: limit(
      [
        ...toStringArray(summaryInput.coreSellingPoints),
        ...toStringArray(root.coreSellingPoints),
      ],
      6
    ),
    targetAudience:
      pickFirstNonEmpty(summaryInput.targetAudience, root.targetAudience) ||
      "目标人群信息待补充，建议结合客群年龄、消费能力和使用场景进一步细化",
    recommendedStyles: limit(
      [
        ...toStringArray(summaryInput.recommendedStyles),
        ...toStringArray(root.recommendedStyles),
      ].filter((style) => DEFAULT_STYLES.includes(style as (typeof DEFAULT_STYLES)[number])),
      3
    ),
    videoTone:
      pickFirstNonEmpty(summaryInput.videoTone, root.videoTone) || "真实可信，有购买驱动力",
    complianceNotes: limit(
      [
        ...toStringArray(summaryInput.complianceNotes),
        ...toStringArray(root.complianceNotes),
      ],
      8
    ),
  };

  if (summary.coreSellingPoints.length === 0) {
    summary.coreSellingPoints = [
      "提炼品牌最能打动用户的核心价值",
      "把产品优势转成用户能感知的利益点",
      "适合在15秒视频里快速建立记忆点",
    ];
  }

  if (summary.recommendedStyles.length === 0) {
    summary.recommendedStyles = ["产品/电商/广告", "生活/治愈/Vlog"];
  }

  const overview = asRecord(detailInput.overview);
  const audienceInsights = asRecord(detailInput.audienceInsights);
  const productStrategy = asRecord(detailInput.productStrategy);
  const contentPlaybook = asRecord(detailInput.contentPlaybook);
  const operationsInsight = asRecord(detailInput.operationsInsight);
  const complianceAndRisk = asRecord(detailInput.complianceAndRisk);
  const strategyPromptNotes = asRecord(detailInput.strategyPromptNotes);

  const detailedProfile: DetailedBrandProfile = {
    version: "v2",
    generatedAt: new Date().toISOString(),
    overview: {
      brandEssence:
        asString(overview.brandEssence) ||
        `${summary.brandName}以“${summary.coreSellingPoints[0]}”为核心，面向${summary.targetAudience}`,
      brandStory:
        asString(overview.brandStory) ||
        `${summary.brandName}聚焦${summary.industry}赛道，通过${summary.productDescription}建立差异化认知。`,
      positioningStatement:
        asString(overview.positioningStatement) ||
        `${summary.brandName}是为${summary.targetAudience}提供${summary.productDescription}的${summary.industry}品牌。`,
      valueProposition:
        asString(overview.valueProposition) ||
        joinList(summary.coreSellingPoints),
      personalityTraits: limit(
        [
          ...toStringArray(overview.personalityTraits),
          ...summary.brandPersonality.split(/[、，,]/),
        ],
        6
      ),
      emotionalKeywords: limit(
        toStringArray(overview.emotionalKeywords).concat(summary.videoTone.split(/[、，,]/)),
        6
      ),
      trustSignals: limit(toStringArray(overview.trustSignals), 6),
      differentiation: limit(
        toStringArray(overview.differentiation).concat(summary.coreSellingPoints),
        8
      ),
    },
    audienceInsights: {
      primarySegments: buildAudienceSegments(audienceInsights.primarySegments),
      secondarySegments: limit(toStringArray(audienceInsights.secondarySegments), 6),
      purchaseJourney: limit(toStringArray(audienceInsights.purchaseJourney), 6),
    },
    productStrategy: {
      heroOffers: buildHeroOffers(productStrategy.heroOffers),
      pricePerception:
        asString(productStrategy.pricePerception) || "建议在内容中明确价值感与价格合理性",
      reasonsToBelieve: limit(toStringArray(productStrategy.reasonsToBelieve), 6),
      bundleIdeas: limit(toStringArray(productStrategy.bundleIdeas), 6),
    },
    contentPlaybook: {
      communicationPillars: limit(toStringArray(contentPlaybook.communicationPillars), 8),
      hookAngles: limit(toStringArray(contentPlaybook.hookAngles), 8),
      storyAngles: limit(toStringArray(contentPlaybook.storyAngles), 8),
      recommendedScenes: limit(toStringArray(contentPlaybook.recommendedScenes), 8),
      visualSignals: limit(toStringArray(contentPlaybook.visualSignals), 8),
      forbiddenElements: limit(
        toStringArray(contentPlaybook.forbiddenElements).concat(summary.complianceNotes),
        10
      ),
      callToActionAngles: limit(toStringArray(contentPlaybook.callToActionAngles), 6),
    },
    operationsInsight: {
      competitorAngles: limit(toStringArray(operationsInsight.competitorAngles), 6),
      channelStrategy: limit(toStringArray(operationsInsight.channelStrategy), 6),
      seasonalOpportunities: limit(toStringArray(operationsInsight.seasonalOpportunities), 6),
      growthOpportunities: limit(toStringArray(operationsInsight.growthOpportunities), 6),
    },
    complianceAndRisk: {
      hardConstraints: limit(
        toStringArray(complianceAndRisk.hardConstraints).concat(summary.complianceNotes),
        10
      ),
      sensitiveClaims: limit(toStringArray(complianceAndRisk.sensitiveClaims), 8),
      reviewChecklist: limit(toStringArray(complianceAndRisk.reviewChecklist), 8),
    },
    evidence: buildEvidence(detailInput.evidence),
    assetReferences: makeAssetReferences(uploadedFileUrls),
    strategyPromptNotes: {
      planningFocus: limit(toStringArray(strategyPromptNotes.planningFocus), 8),
      promptWritingFocus: limit(toStringArray(strategyPromptNotes.promptWritingFocus), 8),
      mustMention: limit(toStringArray(strategyPromptNotes.mustMention), 8),
      mustAvoid: limit(toStringArray(strategyPromptNotes.mustAvoid), 8),
    },
    sourceDigest: {
      hasDescription: Boolean(description),
      descriptionExcerpt: description.slice(0, 180),
      assetCount: uploadedFileUrls.length,
    },
  };

  const brandProfileMarkdown = buildBrandProfileMarkdown({
    summary,
    detailedProfile,
  });
  const strategySystemPrompt = buildStrategySystemPrompt({
    summary,
    detailedProfile,
  });

  return {
    summary,
    detailedProfile,
    brandProfileMarkdown,
    strategySystemPrompt,
  };
}

function section(title: string, lines: string[]): string {
  const content = lines.filter(Boolean).join("\n");
  return `## ${title}\n${content}`;
}

function bullets(items: string[]): string[] {
  return items.filter(Boolean).map((item) => `- ${item}`);
}

function renderSegments(segments: AudienceSegment[]): string[] {
  return segments.flatMap((segment, index) => {
    const lines = [
      `### 核心人群 ${index + 1}：${segment.name || `客群${index + 1}`}`,
      segment.profile ? `- 人群概述：${segment.profile}` : "",
      ...bullets(segment.painPoints.map((item) => `痛点：${item}`)),
      ...bullets(segment.motivations.map((item) => `动机：${item}`)),
      ...bullets(segment.triggers.map((item) => `触发点：${item}`)),
      ...bullets(segment.objections.map((item) => `顾虑：${item}`)),
      ...bullets(segment.preferredPlatforms.map((item) => `偏好平台：${item}`)),
    ];
    return lines.filter(Boolean);
  });
}

function renderOffers(offers: ProductOffer[]): string[] {
  return offers.flatMap((offer, index) => {
    const lines = [
      `### 主推供给 ${index + 1}：${offer.name || `产品${index + 1}`}`,
      offer.role ? `- 定位角色：${offer.role}` : "",
      offer.targetSegment ? `- 面向人群：${offer.targetSegment}` : "",
      ...bullets(offer.keyFeatures.map((item) => `关键特征：${item}`)),
      ...bullets(offer.coreBenefits.map((item) => `用户收益：${item}`)),
      ...bullets(offer.useScenarios.map((item) => `使用场景：${item}`)),
    ];
    return lines.filter(Boolean);
  });
}

export function buildBrandProfileMarkdown(input: {
  summary: BrandProfileSummary;
  detailedProfile: DetailedBrandProfile;
}): string {
  const { summary, detailedProfile } = input;
  const assetLines = [
    ...detailedProfile.assetReferences.uploadedFiles.map((file) =>
      file.type === "image"
        ? `- ${file.label}：![${file.label}](${file.url})`
        : `- ${file.label}：[查看资料](${file.url})`
    ),
  ].filter(Boolean);

  const parts = [
    `# 品牌画像：${summary.brandName}`,
    `> 生成时间：${detailedProfile.generatedAt}`,
    section("摘要速览", [
      `- 品牌名称：${summary.brandName}`,
      `- 行业：${summary.industry}`,
      `- 品牌人格：${summary.brandPersonality}`,
      `- 视频基调：${summary.videoTone}`,
      `- 产品/服务：${summary.productDescription}`,
      `- 目标受众：${summary.targetAudience}`,
      `- 核心卖点：${joinList(summary.coreSellingPoints)}`,
      `- 推荐风格：${joinList(summary.recommendedStyles)}`,
    ]),
    section("品牌本质", [
      `- 品牌精髓：${detailedProfile.overview.brandEssence}`,
      `- 品牌故事：${detailedProfile.overview.brandStory}`,
      `- 定位句：${detailedProfile.overview.positioningStatement}`,
      `- 价值主张：${detailedProfile.overview.valueProposition}`,
      `- 人格关键词：${joinList(detailedProfile.overview.personalityTraits)}`,
      `- 情绪关键词：${joinList(detailedProfile.overview.emotionalKeywords)}`,
      ...bullets(detailedProfile.overview.trustSignals.map((item) => `信任状：${item}`)),
      ...bullets(detailedProfile.overview.differentiation.map((item) => `差异化：${item}`)),
    ]),
    section("用户画像", [
      ...renderSegments(detailedProfile.audienceInsights.primarySegments),
      ...bullets(detailedProfile.audienceInsights.secondarySegments.map((item) => `次级人群：${item}`)),
      ...bullets(detailedProfile.audienceInsights.purchaseJourney.map((item) => `购买旅程：${item}`)),
    ]),
    section("产品与供给策略", [
      ...renderOffers(detailedProfile.productStrategy.heroOffers),
      `- 价格认知：${detailedProfile.productStrategy.pricePerception}`,
      ...bullets(detailedProfile.productStrategy.reasonsToBelieve.map((item) => `信服理由：${item}`)),
      ...bullets(detailedProfile.productStrategy.bundleIdeas.map((item) => `组合/加购：${item}`)),
    ]),
    section("内容创作作战手册", [
      ...bullets(detailedProfile.contentPlaybook.communicationPillars.map((item) => `传播支柱：${item}`)),
      ...bullets(detailedProfile.contentPlaybook.hookAngles.map((item) => `开头钩子：${item}`)),
      ...bullets(detailedProfile.contentPlaybook.storyAngles.map((item) => `叙事角度：${item}`)),
      ...bullets(detailedProfile.contentPlaybook.recommendedScenes.map((item) => `推荐场景：${item}`)),
      ...bullets(detailedProfile.contentPlaybook.visualSignals.map((item) => `视觉信号：${item}`)),
      ...bullets(detailedProfile.contentPlaybook.callToActionAngles.map((item) => `转化动作：${item}`)),
      ...bullets(detailedProfile.contentPlaybook.forbiddenElements.map((item) => `避免元素：${item}`)),
    ]),
    section("运营洞察", [
      ...bullets(detailedProfile.operationsInsight.competitorAngles.map((item) => `竞对切入：${item}`)),
      ...bullets(detailedProfile.operationsInsight.channelStrategy.map((item) => `渠道策略：${item}`)),
      ...bullets(detailedProfile.operationsInsight.seasonalOpportunities.map((item) => `季节机会：${item}`)),
      ...bullets(detailedProfile.operationsInsight.growthOpportunities.map((item) => `增长机会：${item}`)),
    ]),
    section("策略与提示词约束", [
      ...bullets(detailedProfile.strategyPromptNotes.planningFocus.map((item) => `策略规划重点：${item}`)),
      ...bullets(detailedProfile.strategyPromptNotes.promptWritingFocus.map((item) => `提示词重点：${item}`)),
      ...bullets(detailedProfile.strategyPromptNotes.mustMention.map((item) => `必须提及：${item}`)),
      ...bullets(detailedProfile.strategyPromptNotes.mustAvoid.map((item) => `必须避免：${item}`)),
    ]),
    section("合规与审核清单", [
      ...bullets(detailedProfile.complianceAndRisk.hardConstraints.map((item) => `硬性约束：${item}`)),
      ...bullets(detailedProfile.complianceAndRisk.sensitiveClaims.map((item) => `敏感表述：${item}`)),
      ...bullets(detailedProfile.complianceAndRisk.reviewChecklist.map((item) => `审核检查：${item}`)),
    ]),
    section("依据与素材引用", [
      ...bullets(detailedProfile.evidence.map((item) => `${item.insight}（来源：${joinList(item.sources)}）`)),
      ...assetLines,
    ]),
  ];

  return parts.join("\n\n").trim();
}

export function buildStrategySystemPrompt(input: {
  summary: BrandProfileSummary;
  detailedProfile: DetailedBrandProfile;
}): string {
  const { summary, detailedProfile } = input;

  return [
    "你是一位资深品牌运营总监兼短视频策略负责人，负责把品牌画像转译为可量产的视频方向。",
    "你的输出不是泛泛而谈的营销建议，而是可以直接用于批量生产视频提示词的策略结构。",
    "优先级顺序：品牌画像 Markdown > 详细结构化画像 > 摘要字段 > 通用行业经验。",
    `当前品牌：${summary.brandName}，行业：${summary.industry}，视频基调：${summary.videoTone}。`,
    `品牌核心卖点：${joinList(summary.coreSellingPoints)}。`,
    `优先传播支柱：${joinList(detailedProfile.contentPlaybook.communicationPillars)}。`,
    `必须避免：${joinList([
      ...detailedProfile.contentPlaybook.forbiddenElements,
      ...detailedProfile.complianceAndRisk.hardConstraints,
    ])}。`,
    "生成视频策略时必须兼顾三点：可批量扩写、适合15秒转化、能和品牌现有资产与场景绑定。",
    "如果品牌资料不足，不要胡编品牌事实，可以补足合理的营销表达方式，但要以保守、可执行、可落地为准。",
  ].join("\n");
}
