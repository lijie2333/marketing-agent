import { SchemaType } from "@google/generative-ai";
import type { SkillDefinition } from "./registry";

const VIOLATION_PATTERNS = [
  /[a-zA-Z\u4e00-\u9fa5]+(?:先生|女士|总统|主席)/,
  /iPhone|Samsung|Nike|Adidas|Louis Vuitton|Gucci/i,
  /钢铁侠|蜘蛛侠|蝙蝠侠|超人|孙悟空|哪吒/,
];

export const complianceCheckerSkill: SkillDefinition = {
  name: "compliance-checker",
  description:
    "Check prompts for compliance issues. Flags prompts with real names, copyrighted IPs, or brand trademarks.",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      prompts: {
        type: SchemaType.STRING,
        description: "JSON array of prompt objects with content field",
      },
    },
    required: ["prompts"],
  },
  handler: async (params) => {
    const prompts = JSON.parse(params.prompts as string) as Array<{
      content: string;
      [key: string]: unknown;
    }>;

    return prompts.map((p) => {
      const hasViolation = VIOLATION_PATTERNS.some((pattern) =>
        pattern.test(p.content)
      );
      return {
        ...p,
        complianceStatus: hasViolation ? "NEEDS_REVIEW" : "APPROVED",
      };
    });
  },
};
